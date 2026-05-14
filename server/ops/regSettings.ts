/**
 * F1 — Regulatory settings catalogue + seeder.
 *
 * Pattern reused: read/write goes through the existing
 * `ops_facility_settings` key/value table (DDL in
 * `server/ops/opsSchema.ts:439-446`). No new table. Storage shape mirrors
 * `server/ops/opsStorage.ts` Module 7 — one file per cohesive feature
 * area, async module-level functions, shared `db` from `server/db/index.ts`.
 *
 * Phase 3 §6.6 contract: every Wave 0 reg-setting value that hasn't been
 * validated shows a `[V]` chip; removing the chip requires a non-empty
 * `Source note`. We store the chip state in a parallel key:
 *   <KEY>             — the value itself
 *   <KEY>__source_note — admin-supplied provenance text
 *   <KEY>__validated   — '1' or '0' (presence of source note removes [V])
 *
 * Audit-trail emission: every `setRegSetting` invocation records an
 * `update` event against entity_type 'ops_reg_setting' with the prior
 * value (or undefined on first write) as `before` and the new value as
 * `after`. Inspectors can trace who changed a threshold and when.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../db/index";
import { opsFacilitySettings } from "./opsSchema";
import { recordAudit } from "./auditStorage";

// ─────────────────────────────────────────────────────────────────────────────
// Catalogue — 17 base keys (16 settings + 1 default-flag set used by tests)
// per §4.1 of the engineering plan.
// ─────────────────────────────────────────────────────────────────────────────

export const REG_SETTING_KEYS = {
  HOT_WATER_MAX_F:                     { default: "110",          placeholder: true },
  FRIDGE_MIN_F:                        { default: "32",           placeholder: true },
  FRIDGE_MAX_F:                        { default: "40",           placeholder: true },
  FREEZER_MAX_F:                       { default: "0",            placeholder: true },
  INCIDENT_VERBAL_SERIOUS_HOURS:       { default: "2",            placeholder: true },
  INCIDENT_VERBAL_NON_EMERGENT_HOURS:  { default: "24",           placeholder: true },
  LIC_624_WRITTEN_DAYS:                { default: "7",            placeholder: true },
  SOC_341_VERBAL_HOURS:                { default: "2",            placeholder: true },
  FIRE_DRILLS_PER_SHIFT_PER_QUARTER:   { default: "1",            placeholder: true },
  DISASTER_DRILL_INTERVAL_MONTHS:      { default: "6",            placeholder: true },
  TB_INITIAL_DAYS:                     { default: "7",            placeholder: true },
  TB_RENEWAL_MONTHS:                   { default: "12",           placeholder: true },
  FINGERPRINT_BEFORE_RESIDENT_CONTACT: { default: "true",         placeholder: true },
  CPR_FIRST_AID_RENEWAL_MONTHS:        { default: "24",           placeholder: true },
  RECORD_RETENTION_YEARS_DEFAULT:      { default: "3",            placeholder: true },
  POSTING_BILINGUAL_THRESHOLD:         { default: "english_only", placeholder: true },
  VENDOR_COI_EXPIRING_DAYS:            { default: "60",           placeholder: true },
  // Wave 2 W3 — facility-tunable "warn me N days before a staff credential
  // expires." Not a regulation-derived placeholder (no statutory N here);
  // 60 is a sensible default. `placeholder: false` suppresses the [V] chip.
  CREDENTIAL_WARNING_DAYS:             { default: "60",           placeholder: false },
  // Wave 2 W8 — annual physician's report cadence (Phase 1 §11 B14).
  // The actual statutory cadence has not yet been validated against a
  // primary source, so the value is marked `placeholder: true` and the
  // FE [V] chip surfaces until an admin attaches a source note.
  ANNUAL_PHYSICIAN_REPORT_DAYS:        { default: "365",          placeholder: true },
} as const;

export type RegSettingKey = keyof typeof REG_SETTING_KEYS;

export interface RegSettingRow {
  key: RegSettingKey;
  value: string;
  placeholder: boolean;   // catalogue says this is a `[V]` default
  sourceNote: string | null;
  validated: boolean;     // admin has cleared the [V] chip
  updatedAt: number | null;
}

// Parallel-key helpers — kept private so the suffix scheme is one
// implementation detail in one place.
function sourceNoteKey(k: RegSettingKey): string {
  return `${k}__source_note`;
}
function validatedKey(k: RegSettingKey): string {
  return `${k}__validated`;
}

// Sentinel used to know whether a given key has ever been set in the DB
// vs falling back to the catalogue default. Tests assert this distinction.
const ALL_KEYS = Object.keys(REG_SETTING_KEYS) as RegSettingKey[];

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read a single reg setting. Returns the catalogue default if the row
 * doesn't exist for this facility (avoids the FE having to seed before
 * reading). Tenant-scoped at the storage layer — facilityNumber is in
 * every WHERE clause for defense in depth.
 */
export async function getRegSetting(
  facilityNumber: string,
  key: RegSettingKey,
): Promise<string> {
  if (!REG_SETTING_KEYS[key]) throw new Error(`Unknown reg setting key: ${key}`);
  const rows = await db
    .select({ value: opsFacilitySettings.settingValue })
    .from(opsFacilitySettings)
    .where(
      and(
        eq(opsFacilitySettings.facilityNumber, facilityNumber),
        eq(opsFacilitySettings.settingKey, key),
      ),
    )
    .limit(1);
  if (rows.length === 0 || rows[0].value === null) {
    return REG_SETTING_KEYS[key].default;
  }
  return rows[0].value as string;
}

/**
 * List every catalogue key for a facility. Returns one row per key —
 * even keys never written. `value` falls back to the catalogue default
 * when the row is missing. Validated flag toggles the `[V]` chip on the
 * FE.
 */
export async function listRegSettings(
  facilityNumber: string,
): Promise<RegSettingRow[]> {
  // We need three logical keys per setting (value, source-note,
  // validated). Pull them all in one query, then project into one row
  // per catalogue key.
  const wantedKeys: string[] = [];
  for (const k of ALL_KEYS) {
    wantedKeys.push(k, sourceNoteKey(k), validatedKey(k));
  }
  const rows = await db
    .select({
      key: opsFacilitySettings.settingKey,
      value: opsFacilitySettings.settingValue,
      updatedAt: opsFacilitySettings.updatedAt,
    })
    .from(opsFacilitySettings)
    .where(
      and(
        eq(opsFacilitySettings.facilityNumber, facilityNumber),
        inArray(opsFacilitySettings.settingKey, wantedKeys),
      ),
    );

  // Build a lookup once.
  const byKey = new Map<string, { value: string | null; updatedAt: number }>();
  for (const r of rows) {
    byKey.set(r.key, { value: r.value, updatedAt: r.updatedAt });
  }

  return ALL_KEYS.map<RegSettingRow>((k) => {
    const valRow = byKey.get(k);
    const srcRow = byKey.get(sourceNoteKey(k));
    const valRowFlag = byKey.get(validatedKey(k));
    const value =
      valRow && valRow.value !== null ? valRow.value : REG_SETTING_KEYS[k].default;
    return {
      key: k,
      value,
      placeholder: REG_SETTING_KEYS[k].placeholder,
      sourceNote: srcRow?.value ?? null,
      validated: valRowFlag?.value === "1",
      updatedAt: valRow?.updatedAt ?? null,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set a single reg setting. Optionally records a source-note (provenance)
 * and a validated flag. Emits an audit-trail row tagged
 * `entity_type='ops_reg_setting'` and `entity_id=0` (no numeric PK in the
 * key/value table — entity_id is a placeholder for inspectors who filter
 * by entity_type). Tenant scope enforced via facility_number in every
 * WHERE clause.
 */
export async function setRegSetting(
  facilityNumber: string,
  key: RegSettingKey,
  value: string,
  opts: {
    sourceNote?: string | null;
    validated?: boolean;
    actorId: string;
    actorRole: string;
  },
): Promise<void> {
  if (!REG_SETTING_KEYS[key]) throw new Error(`Unknown reg setting key: ${key}`);
  if (typeof value !== "string") {
    throw new Error("Reg-setting value must be a string");
  }

  const prior = await getRegSetting(facilityNumber, key).catch(() => undefined);
  const now = Date.now();

  // Use raw SQL for the three writes — Drizzle's PG upsert is more
  // verbose for a `ON CONFLICT … DO UPDATE` against a composite unique.
  // The composite UNIQUE(facility_number, setting_key) on
  // ops_facility_settings makes ON CONFLICT cheap and correct.
  await pool.query(
    `INSERT INTO ops_facility_settings (facility_number, setting_key, setting_value, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (facility_number, setting_key) DO UPDATE
        SET setting_value = EXCLUDED.setting_value,
            updated_at    = EXCLUDED.updated_at`,
    [facilityNumber, key, value, now],
  );

  if (opts.sourceNote !== undefined) {
    await pool.query(
      `INSERT INTO ops_facility_settings (facility_number, setting_key, setting_value, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (facility_number, setting_key) DO UPDATE
          SET setting_value = EXCLUDED.setting_value,
              updated_at    = EXCLUDED.updated_at`,
      [facilityNumber, sourceNoteKey(key), opts.sourceNote, now],
    );
  }

  if (opts.validated !== undefined) {
    await pool.query(
      `INSERT INTO ops_facility_settings (facility_number, setting_key, setting_value, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (facility_number, setting_key) DO UPDATE
          SET setting_value = EXCLUDED.setting_value,
              updated_at    = EXCLUDED.updated_at`,
      [facilityNumber, validatedKey(key), opts.validated ? "1" : "0", now],
    );
  }

  // Audit-trail emission — wrap so an audit failure does not roll back
  // the user-visible mutation (the user mutation already committed).
  try {
    await recordAudit({
      facilityNumber,
      actorId: opts.actorId,
      actorRole: opts.actorRole,
      action: "update",
      entityType: "ops_reg_setting",
      entityId: 0,
      before: prior !== undefined ? { key, value: prior } : undefined,
      after: {
        key,
        value,
        sourceNote: opts.sourceNote,
        validated: opts.validated,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[regSettings] audit emit failed", err);
  }
}

/**
 * Seed every catalogue key with its placeholder default if the row
 * doesn't exist. Idempotent — repeat calls are no-ops once seeded.
 * Used by the POST /seed route and also by automated provisioning flows
 * (future).
 */
export async function seedDefaultsForFacility(
  facilityNumber: string,
): Promise<{ inserted: number }> {
  const now = Date.now();
  let inserted = 0;
  for (const k of ALL_KEYS) {
    const def = REG_SETTING_KEYS[k].default;
    // ON CONFLICT DO NOTHING is the idempotency guarantee — the row
    // stays whatever the admin had set. RETURNING is used to count
    // genuine inserts vs no-ops so tests can assert idempotency.
    const r = await pool.query<{ id: number }>(
      `INSERT INTO ops_facility_settings (facility_number, setting_key, setting_value, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (facility_number, setting_key) DO NOTHING
       RETURNING id`,
      [facilityNumber, k, def, now],
    );
    inserted += r.rowCount ?? 0;
  }
  return { inserted };
}

/**
 * Validate that an arbitrary string is a known catalogue key. Used by
 * the PUT route's path-param validator. Returns a type-narrowed key on
 * success.
 */
export function isKnownRegSettingKey(s: string): s is RegSettingKey {
  return Object.prototype.hasOwnProperty.call(REG_SETTING_KEYS, s);
}
