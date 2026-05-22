/**
 * Phase 4 — Account / data-subject-rights routes.
 *
 * Three flows, all under `/api/account/*`. All require an authenticated
 * session (either facility Passport.js OR job seeker session — the router
 * sniffs which one). Anonymous requests return 401.
 *
 *   POST /api/account/data-export        — CCPA right-to-know.    Operator fulfills.
 *   POST /api/account/delete-request     — CCPA right-to-delete.  Operator fulfills.
 *   POST /api/account/email-change/initiate
 *                                         — Send dual-email OTP to current + new.
 *   POST /api/account/email-change/verify — Confirm OTP, swap account email.
 *
 * The email-change flow holds the in-flight new email + OTP hash in
 * `account_data_requests.payload_json` so we never write a half-changed
 * email onto the live `facility_accounts` / `job_seeker_accounts` row.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { pool } from "../db/index";
import { authRateLimiter } from "../middleware/rateLimiter";
import { sendVerificationEmail, sendEmail } from "../email";

export const accountRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const CCPA_FULFILLMENT_DAYS = 45;

function hashOtp(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function safeCompareOtp(storedHash: string, rawToken: string): boolean {
  if (storedHash.length !== 64) return false; // not a SHA-256 hex hash — reject
  const stored = Buffer.from(storedHash, "hex");
  const provided = Buffer.from(hashOtp(rawToken), "hex");
  if (stored.length !== provided.length) return false;
  return timingSafeEqual(stored, provided);
}

function generateOtp(): string {
  return randomInt(100000, 999999).toString();
}

interface ResolvedAccount {
  kind: "facility" | "job_seeker";
  id: number;
}

/**
 * Resolves the authenticated account. Returns null if the caller is
 * anonymous — the route handler then surfaces a canonical 401.
 *
 * Prefers facility (Passport) over job seeker so an unusual session that
 * somehow has both flags doesn't silently route to the wrong account.
 */
function resolveAccount(req: Request): ResolvedAccount | null {
  const user = req.user as { id?: number } | undefined;
  if (user?.id != null) return { kind: "facility", id: user.id };
  if (req.session?.jobSeekerId != null) {
    return { kind: "job_seeker", id: req.session.jobSeekerId };
  }
  return null;
}

function requireAccount(req: Request, res: Response): ResolvedAccount | null {
  const acct = resolveAccount(req);
  if (!acct) {
    res.status(401).json({ message: "Authentication required." });
    return null;
  }
  return acct;
}

async function insertDataRequest(args: {
  account: ResolvedAccount;
  kind: "export" | "delete" | "email_change";
  requestedIp: string | null;
  payloadJson?: unknown;
  notes?: string;
}): Promise<{ id: number }> {
  const { account, kind, requestedIp, payloadJson, notes } = args;
  const now = Date.now();
  const r = await pool.query<{ id: number }>(
    `INSERT INTO account_data_requests
       (account_kind, account_id, kind, status, requested_at, requested_ip,
        payload_json, notes, created_at, updated_at)
     VALUES ($1, $2, $3, 'pending', $4, $5, $6::jsonb, $7, $4, $4)
     RETURNING id`,
    [
      account.kind,
      account.id,
      kind,
      now,
      requestedIp,
      payloadJson == null ? null : JSON.stringify(payloadJson),
      notes ?? null,
    ],
  );
  return { id: Number(r.rows[0].id) };
}

async function lookupAccountEmail(account: ResolvedAccount): Promise<string | null> {
  const table = account.kind === "facility" ? "facility_accounts" : "job_seeker_accounts";
  const r = await pool.query<{ email: string | null }>(
    `SELECT email FROM ${table} WHERE id = $1`,
    [account.id],
  );
  return r.rows[0]?.email ?? null;
}

async function notifyOperatorOfRequest(args: {
  kind: "export" | "delete";
  account: ResolvedAccount;
  requestId: number;
  currentEmail: string | null;
}): Promise<void> {
  const operatorEmail = process.env.OPERATOR_NOTIFY_EMAIL;
  if (!operatorEmail) {
    console.warn(
      `[account] OPERATOR_NOTIFY_EMAIL is not set — skipping operator notification for ${args.kind} request #${args.requestId}`,
    );
    return;
  }
  const subject = `[arf-map] ${args.kind === "export" ? "Data export" : "Account deletion"} request #${args.requestId}`;
  const html = `
    <h2>New ${args.kind === "export" ? "data export" : "account deletion"} request</h2>
    <ul>
      <li><strong>Request ID:</strong> ${args.requestId}</li>
      <li><strong>Account kind:</strong> ${args.account.kind}</li>
      <li><strong>Account ID:</strong> ${args.account.id}</li>
      <li><strong>Account email:</strong> ${args.currentEmail ?? "(unknown)"}</li>
      <li><strong>Submitted:</strong> ${new Date().toISOString()}</li>
    </ul>
    <p>SLA: fulfill within ${CCPA_FULFILLMENT_DAYS} days.</p>
  `;
  try {
    await sendEmail({
      to: operatorEmail,
      subject,
      html,
      text: `${subject} — account ${args.account.kind}#${args.account.id}, request #${args.requestId}`,
    });
  } catch (err) {
    console.error(`[account] operator notification failed for request #${args.requestId}:`, err);
  }
}

function resolveIp(req: Request): string | null {
  return (req.ip ?? null) as string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/account/data-export  — CCPA right to know
// ─────────────────────────────────────────────────────────────────────────────

accountRouter.post("/data-export", async (req, res, next) => {
  try {
    const account = requireAccount(req, res);
    if (!account) return;

    const currentEmail = await lookupAccountEmail(account);
    const { id: requestId } = await insertDataRequest({
      account,
      kind: "export",
      requestedIp: resolveIp(req),
    });

    // Fire-and-forget — operator notification is best-effort.
    notifyOperatorOfRequest({ kind: "export", account, requestId, currentEmail }).catch(
      (err) => console.error("[account] notify failed", err),
    );

    res.status(201).json({
      requestId,
      estimatedFulfillmentDays: CCPA_FULFILLMENT_DAYS,
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/account/delete-request  — CCPA right to delete
// ─────────────────────────────────────────────────────────────────────────────

accountRouter.post("/delete-request", async (req, res, next) => {
  try {
    const account = requireAccount(req, res);
    if (!account) return;

    const currentEmail = await lookupAccountEmail(account);
    const { id: requestId } = await insertDataRequest({
      account,
      kind: "delete",
      requestedIp: resolveIp(req),
    });

    notifyOperatorOfRequest({ kind: "delete", account, requestId, currentEmail }).catch(
      (err) => console.error("[account] notify failed", err),
    );

    res.status(201).json({
      requestId,
      estimatedFulfillmentDays: CCPA_FULFILLMENT_DAYS,
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Email-change flow
// ─────────────────────────────────────────────────────────────────────────────

const emailChangeInitiateSchema = z.object({
  newEmail: z
    .string({ required_error: "newEmail is required" })
    .email("A valid email address is required"),
});

const emailChangeVerifySchema = z.object({
  requestId: z.number().int().positive(),
  otp: z.string().regex(/^\d{6}$/, "OTP must be 6 digits"),
});

interface EmailChangePayload {
  newEmail: string;
  otpHash: string;
  otpExpiry: number;
}

function parseEmailChangePayload(raw: unknown): EmailChangePayload | null {
  if (!raw || typeof raw !== "object") return null;
  // node-postgres returns JSONB as a parsed object, not a string. Belt-and-
  // braces: handle either.
  const obj =
    typeof raw === "string"
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : raw;
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (
    typeof o.newEmail !== "string" ||
    typeof o.otpHash !== "string" ||
    typeof o.otpExpiry !== "number"
  ) {
    return null;
  }
  return { newEmail: o.newEmail, otpHash: o.otpHash, otpExpiry: o.otpExpiry };
}

accountRouter.post("/email-change/initiate", authRateLimiter, async (req, res, next) => {
  try {
    const account = requireAccount(req, res);
    if (!account) return;

    const parsed = emailChangeInitiateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0].message });
    }
    const newEmail = parsed.data.newEmail.trim().toLowerCase();

    const currentEmail = await lookupAccountEmail(account);
    if (currentEmail && currentEmail.toLowerCase() === newEmail) {
      return res
        .status(400)
        .json({ message: "New email matches the current address." });
    }

    // Block changes to an email already in use on the same account-kind table.
    const dupTable =
      account.kind === "facility" ? "facility_accounts" : "job_seeker_accounts";
    const dup = await pool.query<{ id: number }>(
      `SELECT id FROM ${dupTable} WHERE LOWER(email) = $1 AND id <> $2 LIMIT 1`,
      [newEmail, account.id],
    );
    if (dup.rows.length > 0) {
      // Generic message — don't leak whether the email is registered.
      return res
        .status(400)
        .json({ message: "This email cannot be used for this account." });
    }

    const otp = generateOtp();
    const otpHash = hashOtp(otp);
    const otpExpiry = Date.now() + 15 * 60 * 1000; // 15 minutes
    const payload: EmailChangePayload = { newEmail, otpHash, otpExpiry };

    const { id: requestId } = await insertDataRequest({
      account,
      kind: "email_change",
      requestedIp: resolveIp(req),
      payloadJson: payload,
    });

    // Dual-email notification. We send the RAW OTP to both addresses:
    //   - Current email: tells the user a change is pending so a thief
    //     using a stolen session sees a warning sign in the existing inbox.
    //   - New email:     completes the confirmation loop (proves the user
    //     controls the new address).
    // Both messages currently reuse sendVerificationEmail's "your code is X"
    // template — good enough for v1; a future polish pass can split the
    // copy so the current-email message is more clearly a "heads up".
    try {
      if (currentEmail) {
        await sendVerificationEmail(currentEmail, otp);
      }
      await sendVerificationEmail(newEmail, otp);
    } catch (err) {
      console.error("[account/email-change/initiate] email send failed", err);
    }

    res.status(201).json({
      requestId,
      message:
        "Verification code sent to both your current and new email addresses",
    });
  } catch (err) {
    next(err);
  }
});

accountRouter.post("/email-change/verify", async (req, res, next) => {
  try {
    const account = requireAccount(req, res);
    if (!account) return;

    const parsed = emailChangeVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0].message });
    }
    const { requestId, otp } = parsed.data;

    const r = await pool.query<{
      id: number;
      account_kind: string;
      account_id: number;
      status: string;
      payload_json: unknown;
    }>(
      `SELECT id, account_kind, account_id, status, payload_json
         FROM account_data_requests
        WHERE id = $1 AND kind = 'email_change'`,
      [requestId],
    );
    const row = r.rows[0];

    // Defensive isolation — never let one account verify another's request.
    if (
      !row ||
      row.account_kind !== account.kind ||
      Number(row.account_id) !== account.id
    ) {
      return res.status(404).json({ message: "Email change request not found." });
    }
    if (row.status !== "pending") {
      return res
        .status(400)
        .json({ code: "ALREADY_FULFILLED", message: "This request is no longer pending." });
    }

    const payload = parseEmailChangePayload(row.payload_json);
    if (!payload) {
      return res
        .status(400)
        .json({ code: "INVALID_PAYLOAD", message: "Request payload is corrupt." });
    }
    if (Date.now() > payload.otpExpiry) {
      return res
        .status(400)
        .json({ code: "OTP_EXPIRED", message: "Verification code has expired. Please request a new one." });
    }
    if (!safeCompareOtp(payload.otpHash, otp)) {
      return res
        .status(400)
        .json({ code: "INVALID_OTP", message: "Invalid verification code." });
    }

    // Two writes, one transaction so we never end up with a flipped email
    // and a still-pending request row (or vice versa).
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const table =
        account.kind === "facility" ? "facility_accounts" : "job_seeker_accounts";
      await client.query(
        `UPDATE ${table} SET email = $1 WHERE id = $2`,
        [payload.newEmail, account.id],
      );
      const now = Date.now();
      await client.query(
        `UPDATE account_data_requests
            SET status = 'fulfilled', fulfilled_at = $1, fulfilled_by = $2
          WHERE id = $3`,
        [now, "self", requestId],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    res.json({
      ok: true,
      requestId,
      newEmail: payload.newEmail,
    });
  } catch (err) {
    next(err);
  }
});
