/**
 * Wave 3 Phase 3.2 — Auditor share-link storage.
 *
 * Pattern mirrored from server/ops/obligationsStorage.ts:
 *   - Module-level async functions; shared Drizzle `db` + raw `pool`.
 *   - Tenant isolation enforced at the storage layer on every WHERE.
 *   - Every mutation emits an audit row via `recordAudit({ entityType:
 *     'ops_share_link', … })` wrapped in try/catch — an audit failure
 *     never rolls back the user-visible mutation.
 *
 * Token contract:
 *   - 24 random bytes from crypto.randomBytes → base64url (32 chars).
 *   - Collision-retry up to 3 times (the table has a UNIQUE INDEX on
 *     token), then throws a domain error so the route returns 500.
 *   - `recordShareLinkVisit` is the SINGLE source of truth for "is this
 *     token live?". The auditor middleware calls it on every request.
 *     Bumps visit_count + last_visit_at atomically when valid.
 *
 * Duration clamp:
 *   - durationDays is clamped to
 *     [MIN_SHARE_LINK_DURATION_HOURS/24, MAX_SHARE_LINK_DURATION_DAYS].
 *   - Out-of-bounds throws ShareLinkDurationError so the route can map
 *     to 400 with a human-readable message.
 */

import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql, lte, gt } from "drizzle-orm";

import { db } from "../db/index";
import { opsShareLinks } from "./opsSchema";
import type { OpsShareLink } from "./opsSchema";
import { recordAudit, type AuditActor } from "./auditStorage";
import {
  type AuditorAudience,
  type ShareLinkScope,
  AUDITOR_AUDIENCES,
  SHARE_LINK_SCOPES,
  DEFAULT_SHARE_LINK_DURATION_DAYS,
  MAX_SHARE_LINK_DURATION_DAYS,
  MIN_SHARE_LINK_DURATION_HOURS,
} from "@shared/auditor";

// ─────────────────────────────────────────────────────────────────────────────
// Public types + domain errors
// ─────────────────────────────────────────────────────────────────────────────

export class ShareLinkDurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShareLinkDurationError";
  }
}

export class ShareLinkTokenCollisionError extends Error {
  constructor() {
    super("Failed to mint a unique share-link token after 3 attempts");
    this.name = "ShareLinkTokenCollisionError";
  }
}

export interface CreateShareLinkInput {
  facilityNumber: string;
  audience: AuditorAudience;
  audienceLabel?: string;
  scope?: ShareLinkScope;
  /** Clamped to [MIN_SHARE_LINK_DURATION_HOURS/24, MAX_SHARE_LINK_DURATION_DAYS]. */
  durationDays: number;
  createdBy: string;
}

export interface ListShareLinksOpts {
  includeRevoked?: boolean;
  includeExpired?: boolean;
  page: number;
  limit: number;
}

const AUDIENCE_SET = new Set<string>(AUDITOR_AUDIENCES);
const SCOPE_SET = new Set<string>(SHARE_LINK_SCOPES);
const TOKEN_MINT_ATTEMPTS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mint a 24-byte CSPRNG token, base64url-encoded → 32 ASCII chars. Never
 * call Math.random — share-link tokens are auth secrets and must come
 * from a cryptographically-secure RNG.
 */
function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Clamp a caller-supplied durationDays to the spec window, throwing on
 * absurd values (NaN, negative, > MAX). We do NOT silently clamp out-of-
 * range values — the FE can show "max is 30 days" rather than mint a
 * link the admin didn't ask for.
 */
function clampDurationDays(input: number): number {
  const min = MIN_SHARE_LINK_DURATION_HOURS / 24;
  if (!Number.isFinite(input)) {
    throw new ShareLinkDurationError("durationDays must be a finite number");
  }
  if (input < min) {
    throw new ShareLinkDurationError(
      `durationDays must be at least ${MIN_SHARE_LINK_DURATION_HOURS} hour(s)`,
    );
  }
  if (input > MAX_SHARE_LINK_DURATION_DAYS) {
    throw new ShareLinkDurationError(
      `durationDays must not exceed ${MAX_SHARE_LINK_DURATION_DAYS}`,
    );
  }
  return input;
}

async function safeAudit(args: {
  facilityNumber: string;
  actor: AuditActor;
  action: "create" | "update" | "delete" | "resolve" | "close" | "reopen";
  entityId: number;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  try {
    await recordAudit({
      facilityNumber: args.facilityNumber,
      actorId: args.actor.id,
      actorRole: args.actor.role,
      action: args.action,
      entityType: "ops_share_link",
      entityId: args.entityId,
      before: args.before,
      after: args.after,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[ops] audit emit failed for ops_share_link#${args.entityId}`,
      err,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────────────────────────────────────

export async function createShareLink(
  input: CreateShareLinkInput,
  actor: AuditActor,
): Promise<OpsShareLink> {
  if (!input.facilityNumber) {
    throw new Error("facilityNumber is required");
  }
  if (!AUDIENCE_SET.has(input.audience)) {
    throw new Error(`Invalid audience: ${input.audience}`);
  }
  const scope: ShareLinkScope = input.scope ?? "audit_readiness";
  if (!SCOPE_SET.has(scope)) {
    throw new Error(`Invalid scope: ${scope}`);
  }

  const durationDays = clampDurationDays(
    input.durationDays || DEFAULT_SHARE_LINK_DURATION_DAYS,
  );
  const now = Date.now();
  const expiresAt = now + Math.round(durationDays * DAY_MS);

  // Retry on the (very) rare token collision — 192 bits of entropy makes
  // this effectively impossible, but the UNIQUE INDEX is there for a
  // reason and we want a deterministic ceiling rather than an infinite
  // loop on a misconfigured DB.
  let lastErr: unknown;
  for (let attempt = 0; attempt < TOKEN_MINT_ATTEMPTS; attempt += 1) {
    const token = generateToken();
    try {
      const rows = await db
        .insert(opsShareLinks)
        .values({
          facilityNumber: input.facilityNumber,
          token,
          audience: input.audience,
          audienceLabel: input.audienceLabel ?? null,
          scope,
          expiresAt,
          visitCount: 0,
          lastVisitAt: null,
          revokedAt: null,
          revokedBy: null,
          createdBy: input.createdBy,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const row = rows[0] as OpsShareLink;
      await safeAudit({
        facilityNumber: row.facilityNumber,
        actor,
        action: "create",
        entityId: row.id,
        // Don't audit the raw token (it's a credential). Audit the
        // metadata that an inspector cares about.
        after: {
          id: row.id,
          audience: row.audience,
          audienceLabel: row.audienceLabel,
          scope: row.scope,
          expiresAt: row.expiresAt,
          createdBy: row.createdBy,
        },
      });
      return row;
    } catch (err) {
      lastErr = err;
      // Postgres unique violation: 23505. Bubble up anything else.
      const code = (err as { code?: string }).code;
      if (code !== "23505") throw err;
    }
  }
  // eslint-disable-next-line no-console
  console.error("[ops] share-link token collision after retries", lastErr);
  throw new ShareLinkTokenCollisionError();
}

// ─────────────────────────────────────────────────────────────────────────────
// List
// ─────────────────────────────────────────────────────────────────────────────

export async function listShareLinks(
  facilityNumber: string,
  opts: ListShareLinksOpts,
): Promise<{ rows: OpsShareLink[]; total: number }> {
  const now = Date.now();
  const conds = [eq(opsShareLinks.facilityNumber, facilityNumber)];
  if (!opts.includeRevoked) {
    conds.push(isNull(opsShareLinks.revokedAt));
  }
  if (!opts.includeExpired) {
    // "Not expired" = expires_at > now. We deliberately use strict > so
    // an exactly-expired token (rare) reports as expired.
    conds.push(gt(opsShareLinks.expiresAt, now));
  }
  const where = and(...conds);
  const offset = (opts.page - 1) * opts.limit;
  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(opsShareLinks)
      .where(where)
      .orderBy(desc(opsShareLinks.createdAt), desc(opsShareLinks.id))
      .limit(opts.limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(opsShareLinks)
      .where(where),
  ]);
  return { rows, total: countRows[0]?.count ?? 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lookup by token
// ─────────────────────────────────────────────────────────────────────────────

export async function getShareLinkByToken(
  token: string,
): Promise<OpsShareLink | undefined> {
  if (!token) return undefined;
  const rows = await db
    .select()
    .from(opsShareLinks)
    .where(eq(opsShareLinks.token, token))
    .limit(1);
  return rows[0] as OpsShareLink | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Revoke
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Idempotent — calling on an already-revoked link is a no-op success
 * (returns true). Returns false only when the row does not exist or
 * belongs to a different tenant.
 */
export async function revokeShareLink(
  id: number,
  facilityNumber: string,
  by: string,
  actor: AuditActor,
): Promise<boolean> {
  const before = await db
    .select()
    .from(opsShareLinks)
    .where(
      and(
        eq(opsShareLinks.id, id),
        eq(opsShareLinks.facilityNumber, facilityNumber),
      ),
    )
    .limit(1);
  const row = before[0] as OpsShareLink | undefined;
  if (!row) return false;
  if (row.revokedAt !== null && row.revokedAt !== undefined) {
    // Already revoked — idempotent success.
    return true;
  }
  const now = Date.now();
  const rows = await db
    .update(opsShareLinks)
    .set({ revokedAt: now, revokedBy: by, updatedAt: now })
    .where(
      and(
        eq(opsShareLinks.id, id),
        eq(opsShareLinks.facilityNumber, facilityNumber),
      ),
    )
    .returning();
  const after = rows[0] as OpsShareLink | undefined;
  if (after) {
    await safeAudit({
      facilityNumber,
      actor,
      action: "delete",
      entityId: after.id,
      before: { id: row.id, revokedAt: row.revokedAt },
      after: { id: after.id, revokedAt: after.revokedAt, revokedBy: after.revokedBy },
    });
  }
  return after !== undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Visit (auditor-middleware single source of truth)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bumps visit_count + last_visit_at on a valid (non-revoked, not-yet-
 * expired) share link. Returns the row only when the link is currently
 * usable. Returns undefined otherwise.
 *
 * This is the SINGLE source of truth for "is this token live?". The
 * auditor middleware calls it on every authenticated GET so we get
 * accurate visit counters without a separate "check then update" race.
 */
export async function recordShareLinkVisit(
  token: string,
  now: number = Date.now(),
): Promise<OpsShareLink | undefined> {
  if (!token) return undefined;
  // UPDATE … WHERE token=$1 AND revoked_at IS NULL AND expires_at > $2
  // RETURNING * is atomic — if the WHERE filter doesn't match the row
  // is invalid and we get back zero rows. This avoids the "select then
  // update" race + double-counts on concurrent visits.
  const rows = await db
    .update(opsShareLinks)
    .set({
      visitCount: sql`${opsShareLinks.visitCount} + 1`,
      lastVisitAt: now,
    })
    .where(
      and(
        eq(opsShareLinks.token, token),
        isNull(opsShareLinks.revokedAt),
        gt(opsShareLinks.expiresAt, now),
      ),
    )
    .returning();
  return rows[0] as OpsShareLink | undefined;
}
