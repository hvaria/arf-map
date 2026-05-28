# Phase 4 — Engineering Plan (Wave 0 + Wave 1)

> **Status:** DRAFT — awaiting Phase 4 gate review.
> **Scope:** Wave 0 (F1–F4) + Wave 1 (W11, W7, W5, W9, W10, W13).
> **Binding constraint:** Phase 3 §2.5 Implementation Contract.
> Every schema, route, and component below cites the existing pattern
> it extends. Any deviation is called out explicitly and requires
> approval; otherwise reject during code review.

---

## 0. How to read this doc

1. **§1 Migration philosophy** — what we do and do not touch.
2. **§2 Schema additions** — full SQL DDL, snake_case, additive only,
   `CREATE TABLE IF NOT EXISTS` via the existing
   [`bootstrapOpsSchema()`](server/ops/opsStorage.ts).
3. **§3 Drizzle + types** — `pgTable` definitions, mirror the existing
   `opsSchema.ts` style.
4. **§4 Storage layer** — function signatures added to
   `server/ops/opsStorage.ts` and one new sibling file for evidence /
   audit-trail concerns.
5. **§5 Permission model** — Auditor scaffold without altering
   `facility_accounts`.
6. **§6 Audit-trail middleware** — emit on every mutation in §7.
7. **§7 API contracts** — per resource, mounted on the existing
   `opsRouter` at `/api/ops/...`.
8. **§8 Evidence storage adapter** — Fly volume v0.
9. **§9 Out-of-range hook** — wired into the temperature-log insert
   path; how it survives until Wave 2's obligation engine.
10. **§10 Frontend implementation map** — every Wave 1 screen → file
    location + reused components.
11. **§11 Ticket breakdown** — epics → stories.
12. **§12 Test plan** — what each ticket must include.
13. **§13 Deployment, rollout, rollback.**
14. **§14 Risks, open items, dependencies on Phase 5.**

---

## 1. Migration philosophy

- **Additive only.** No `ALTER TABLE` on existing `ops_*` tables in
  Wave 0 / Wave 1.
- **Reuse `ops_facility_settings`** (existing key/value table) as the
  home for F1 reg keys. No new `facility_reg_settings` table.
- **Do NOT touch `ops_compliance_calendar` in Wave 1.** Wave 2 owns
  its migration to the generic `obligation` engine. Wave 1 follow-up
  state lives inline on the source row (temperature_log,
  ops_complaint, etc.).
- **Do NOT touch `ops_staff` / `ops_shifts` in Wave 1.** Wave 2 W3
  adds `staff_credential` and the shift-block logic.
- **Do NOT touch `facility_accounts`** (auth table). Auditor role
  scaffolding (F4) lives in helpers only, not in DDL, until Wave 3.
- **Bootstrap on startup.** Append to `OPS_PG_SCHEMA_SQL` in
  [`server/ops/opsSchema.ts`](server/ops/opsSchema.ts); no separate
  migration runner.

---

## 2. Schema additions (DDL — append to `OPS_PG_SCHEMA_SQL`)

All SQL below extends the existing template literal in
`server/ops/opsSchema.ts:7`. Conventions: `BIGSERIAL` PK, `TEXT`
enums, `INTEGER DEFAULT 0` for booleans, `BIGINT` epoch-ms
timestamps, `facility_number TEXT NOT NULL` for tenancy, indexes
follow the `idx_ops_<short>_<col>` naming used everywhere else.

### 2.1 Wave 0 — F2 Evidence attachments

```sql
CREATE TABLE IF NOT EXISTS ops_evidence_attachments (
  id              BIGSERIAL PRIMARY KEY,
  facility_number TEXT NOT NULL,
  entity_type     TEXT NOT NULL,    -- e.g. 'ops_temperature_log', 'ops_drill_log', 'ops_vendor', 'ops_complaint', 'ops_inspection', 'ops_controlled_sub_count', 'ops_facility_setting'
  entity_id       BIGINT NOT NULL,
  kind            TEXT NOT NULL,    -- 'file' | 'photo' | 'external_link'
  filename        TEXT,
  mime            TEXT,
  byte_size       INTEGER,
  storage_uri     TEXT NOT NULL,    -- 'local:///<id>/<filename>' v0; 's3://...' future; 'https://...' for external_link
  sha256          TEXT,
  uploaded_by     TEXT NOT NULL,
  uploaded_at     BIGINT NOT NULL,
  deleted_at      BIGINT            -- soft-delete; null = active
);
CREATE INDEX IF NOT EXISTS idx_ops_evidence_facility ON ops_evidence_attachments(facility_number);
CREATE INDEX IF NOT EXISTS idx_ops_evidence_entity   ON ops_evidence_attachments(entity_type, entity_id);
```

### 2.2 Wave 0 — F3 Audit trail (immutable, append-only)

```sql
CREATE TABLE IF NOT EXISTS ops_audit_trail (
  id              BIGSERIAL PRIMARY KEY,
  facility_number TEXT NOT NULL,
  actor_id        TEXT NOT NULL,         -- session principal username/email
  actor_role      TEXT NOT NULL,         -- 'admin' (default in Wave 0) | future 'auditor', 'don', 'med_tech', ...
  action          TEXT NOT NULL,         -- 'create' | 'update' | 'delete' | 'attach_evidence' | 'detach_evidence' | 'resolve' | 'close' | 'reopen'
  entity_type     TEXT NOT NULL,
  entity_id       BIGINT NOT NULL,
  before_json     TEXT,                  -- null on create
  after_json      TEXT,                  -- null on hard delete
  occurred_at     BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ops_audit_facility ON ops_audit_trail(facility_number, occurred_at);
CREATE INDEX IF NOT EXISTS idx_ops_audit_entity   ON ops_audit_trail(entity_type, entity_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_ops_audit_actor    ON ops_audit_trail(actor_id, occurred_at);
```

No `UPDATE` or `DELETE` is permitted on this table at the
application layer; enforced by the storage layer (insert-only API).

### 2.3 Wave 0 — F1 Reg-settings seeding

Reuse existing `ops_facility_settings` (id, facility_number,
setting_key, setting_value, updated_at, UNIQUE(facility_number,
setting_key)). No DDL change. Add a canonical key catalogue and
seeder; see §4.1.

### 2.4 Wave 1 — W7 Temperature fixtures + logs

```sql
CREATE TABLE IF NOT EXISTS ops_temperature_fixtures (
  id              BIGSERIAL PRIMARY KEY,
  facility_number TEXT NOT NULL,
  fixture_key     TEXT NOT NULL,         -- 'fridge_kitchen_1', 'hot_water_room_3', ...
  fixture_label   TEXT NOT NULL,         -- user-visible name
  kind            TEXT NOT NULL,         -- 'fridge' | 'freezer' | 'hot_water' | 'dish_machine' | 'other'
  required_min    DOUBLE PRECISION,      -- null = no min threshold
  required_max    DOUBLE PRECISION,      -- null = no max threshold
  unit            TEXT NOT NULL DEFAULT 'F',
  status          TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'inactive'
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL,
  UNIQUE(facility_number, fixture_key)
);
CREATE INDEX IF NOT EXISTS idx_ops_tempfx_facility ON ops_temperature_fixtures(facility_number);

CREATE TABLE IF NOT EXISTS ops_temperature_logs (
  id                          BIGSERIAL PRIMARY KEY,
  facility_number             TEXT NOT NULL,
  fixture_id                  BIGINT NOT NULL,
  fixture_key                 TEXT NOT NULL,                 -- denormalized for cheap reads
  reading_value               DOUBLE PRECISION NOT NULL,
  unit                        TEXT NOT NULL DEFAULT 'F',
  threshold_min               DOUBLE PRECISION,              -- copied at insert time from fixtures, for evidentiary stability
  threshold_max               DOUBLE PRECISION,
  out_of_range                INTEGER NOT NULL DEFAULT 0,
  reading_at                  BIGINT NOT NULL,
  recorded_by                 TEXT NOT NULL,
  note                        TEXT,
  -- Inline follow-up state (avoids touching ops_compliance_calendar in Wave 1):
  follow_up_due_at            BIGINT,
  follow_up_resolved_at       BIGINT,
  follow_up_resolved_by       TEXT,
  follow_up_resolution_note   TEXT,
  created_at                  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ops_temp_facility ON ops_temperature_logs(facility_number, reading_at);
CREATE INDEX IF NOT EXISTS idx_ops_temp_fixture  ON ops_temperature_logs(fixture_id, reading_at);
CREATE INDEX IF NOT EXISTS idx_ops_temp_oor      ON ops_temperature_logs(out_of_range, follow_up_resolved_at);
```

### 2.5 Wave 1 — W5 Drill log

```sql
CREATE TABLE IF NOT EXISTS ops_drill_logs (
  id                      BIGSERIAL PRIMARY KEY,
  facility_number         TEXT NOT NULL,
  drill_kind              TEXT NOT NULL,     -- 'fire' | 'disaster' | 'active_threat' | 'other'
  scenario                TEXT,
  shift                   TEXT,               -- 'AM' | 'PM' | 'NOC' | null
  executed_at             BIGINT NOT NULL,
  leader                  TEXT,
  participants_json       TEXT,               -- JSON-encoded array (per existing pattern of *_json TEXT columns)
  residents_involved_json TEXT,
  evacuation_seconds      INTEGER,
  debrief_notes           TEXT,
  corrective_actions_json TEXT,
  status                  TEXT NOT NULL DEFAULT 'executed', -- 'scheduled' | 'executed' | 'reviewed' | 'closed'
  created_by              TEXT NOT NULL,
  created_at              BIGINT NOT NULL,
  updated_at              BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ops_drill_facility ON ops_drill_logs(facility_number, executed_at);
CREATE INDEX IF NOT EXISTS idx_ops_drill_kind     ON ops_drill_logs(drill_kind);
```

### 2.6 Wave 1 — W9 Vendors

```sql
CREATE TABLE IF NOT EXISTS ops_vendors (
  id                BIGSERIAL PRIMARY KEY,
  facility_number   TEXT NOT NULL,
  vendor_name       TEXT NOT NULL,
  vendor_type       TEXT NOT NULL,    -- 'pharmacy' | 'food' | 'pest' | 'medical' | 'maintenance' | 'linen' | 'other'
  contact_name      TEXT,
  contact_phone     TEXT,
  contact_email     TEXT,
  coi_expires_at    BIGINT,
  license_expires_at BIGINT,
  notes             TEXT,
  status            TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'archived'
  created_at        BIGINT NOT NULL,
  updated_at        BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ops_vendor_facility ON ops_vendors(facility_number);
CREATE INDEX IF NOT EXISTS idx_ops_vendor_coi      ON ops_vendors(coi_expires_at);
```

### 2.7 Wave 1 — W10 Complaints

```sql
CREATE TABLE IF NOT EXISTS ops_complaints (
  id                    BIGSERIAL PRIMARY KEY,
  facility_number       TEXT NOT NULL,
  received_at           BIGINT NOT NULL,
  complainant_type      TEXT NOT NULL,    -- 'resident' | 'family' | 'staff' | 'ombudsman' | 'anonymous' | 'other'
  complainant_name      TEXT,
  complainant_relation  TEXT,
  nature                TEXT NOT NULL,
  intake_notes          TEXT,
  assigned_to           TEXT,
  status                TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'investigating' | 'resolved' | 'closed'
  resolution_note       TEXT,
  resolved_at           BIGINT,
  closed_at             BIGINT,
  created_by            TEXT NOT NULL,
  created_at            BIGINT NOT NULL,
  updated_at            BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ops_complaint_facility ON ops_complaints(facility_number, received_at);
CREATE INDEX IF NOT EXISTS idx_ops_complaint_status   ON ops_complaints(status);

CREATE TABLE IF NOT EXISTS ops_complaint_investigation_notes (
  id              BIGSERIAL PRIMARY KEY,
  complaint_id    BIGINT NOT NULL,
  facility_number TEXT NOT NULL,
  noted_at        BIGINT NOT NULL,
  noted_by        TEXT NOT NULL,
  note            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ops_comp_notes_complaint ON ops_complaint_investigation_notes(complaint_id, noted_at);
```

### 2.8 Wave 1 — W13 Inspections + citations

```sql
CREATE TABLE IF NOT EXISTS ops_inspections (
  id              BIGSERIAL PRIMARY KEY,
  facility_number TEXT NOT NULL,
  inspector_org   TEXT NOT NULL,           -- 'CDSS_CCLD' | 'LTC_Ombudsman' | 'Fire_Marshal' | 'Health_Dept' | 'Internal' | 'Other'
  inspector_name  TEXT,
  purpose         TEXT NOT NULL,           -- 'annual' | 'complaint' | 'follow_up' | 'other'
  visit_at        BIGINT NOT NULL,
  findings_json   TEXT,                    -- JSON array of free-text findings
  status          TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'cited' | 'remediating' | 'closed'
  closed_at       BIGINT,
  created_by      TEXT NOT NULL,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ops_insp_facility ON ops_inspections(facility_number, visit_at);
CREATE INDEX IF NOT EXISTS idx_ops_insp_status   ON ops_inspections(status);

CREATE TABLE IF NOT EXISTS ops_inspection_citations (
  id              BIGSERIAL PRIMARY KEY,
  inspection_id   BIGINT NOT NULL,
  facility_number TEXT NOT NULL,
  citation_title  TEXT NOT NULL,
  detail          TEXT,
  due_at          BIGINT,
  status          TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'remediating' | 'closed'
  closed_at       BIGINT,
  closed_by       TEXT,
  closure_note    TEXT,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ops_cite_inspection ON ops_inspection_citations(inspection_id);
CREATE INDEX IF NOT EXISTS idx_ops_cite_status     ON ops_inspection_citations(status);
```

### 2.9 W11 — Controlled-substance reconciliation

**No new tables.** Reads `ops_controlled_sub_counts` (already exists,
[`opsSchema.ts:190-208`](server/ops/opsSchema.ts)). New endpoints
expose unresolved-discrepancy aggregation + a `resolve` mutation that
writes back `resolved = 1`, `discrepancy_notes`, and links to a
`ops_evidence_attachment` row.

---

## 3. Drizzle definitions + types (append to `opsSchema.ts`)

Pattern: mirror existing definitions in `server/ops/opsSchema.ts`.

```ts
// ── F2 Evidence attachments ───────────────────────────────────────────────
export const opsEvidenceAttachments = pgTable("ops_evidence_attachments", {
  id:             serial("id").primaryKey(),
  facilityNumber: text("facility_number").notNull(),
  entityType:     text("entity_type").notNull(),
  entityId:       bigint("entity_id", { mode: "number" }).notNull(),
  kind:           text("kind").notNull(),
  filename:       text("filename"),
  mime:           text("mime"),
  byteSize:       integer("byte_size"),
  storageUri:     text("storage_uri").notNull(),
  sha256:         text("sha256"),
  uploadedBy:     text("uploaded_by").notNull(),
  uploadedAt:     ts("uploaded_at").notNull(),
  deletedAt:      ts("deleted_at"),
});

// ── F3 Audit trail ────────────────────────────────────────────────────────
export const opsAuditTrail = pgTable("ops_audit_trail", {
  id:             serial("id").primaryKey(),
  facilityNumber: text("facility_number").notNull(),
  actorId:        text("actor_id").notNull(),
  actorRole:      text("actor_role").notNull(),
  action:         text("action").notNull(),
  entityType:     text("entity_type").notNull(),
  entityId:       bigint("entity_id", { mode: "number" }).notNull(),
  beforeJson:     text("before_json"),
  afterJson:      text("after_json"),
  occurredAt:     ts("occurred_at").notNull(),
});

// ── W7 Temperature fixtures + logs ────────────────────────────────────────
export const opsTemperatureFixtures = pgTable("ops_temperature_fixtures", { /* fields from §2.4 */ });
export const opsTemperatureLogs     = pgTable("ops_temperature_logs",     { /* fields from §2.4 */ });

// ── W5 Drill logs ─────────────────────────────────────────────────────────
export const opsDrillLogs = pgTable("ops_drill_logs", { /* fields from §2.5 */ });

// ── W9 Vendors ────────────────────────────────────────────────────────────
export const opsVendors = pgTable("ops_vendors", { /* fields from §2.6 */ });

// ── W10 Complaints + investigation notes ──────────────────────────────────
export const opsComplaints                    = pgTable("ops_complaints",                    { /* §2.7 */ });
export const opsComplaintInvestigationNotes   = pgTable("ops_complaint_investigation_notes", { /* §2.7 */ });

// ── W13 Inspections + citations ───────────────────────────────────────────
export const opsInspections           = pgTable("ops_inspections",           { /* §2.8 */ });
export const opsInspectionCitations   = pgTable("ops_inspection_citations",  { /* §2.8 */ });

// $inferSelect / $inferInsert exports follow the same pattern as
// existing types in opsSchema.ts:897-952.
```

---

## 4. Storage layer

### 4.1 Reg-settings catalogue + seeder (F1)

New file `server/ops/regSettings.ts`:

```ts
// Canonical reg-setting keys with placeholder defaults marked [V].
// Read/write via getRegSetting / setRegSetting helpers.
// Phase 5 validation replaces [V] values per facility.

export const REG_SETTING_KEYS = {
  HOT_WATER_MAX_F:                          { default: "110", placeholder: true },
  FRIDGE_MIN_F:                             { default: "32",  placeholder: true },
  FRIDGE_MAX_F:                             { default: "40",  placeholder: true },
  FREEZER_MAX_F:                            { default: "0",   placeholder: true },
  INCIDENT_VERBAL_SERIOUS_HOURS:            { default: "2",   placeholder: true },
  INCIDENT_VERBAL_NON_EMERGENT_HOURS:       { default: "24",  placeholder: true },
  LIC_624_WRITTEN_DAYS:                     { default: "7",   placeholder: true },
  SOC_341_VERBAL_HOURS:                     { default: "2",   placeholder: true },
  FIRE_DRILLS_PER_SHIFT_PER_QUARTER:        { default: "1",   placeholder: true },
  DISASTER_DRILL_INTERVAL_MONTHS:           { default: "6",   placeholder: true },
  TB_INITIAL_DAYS:                          { default: "7",   placeholder: true },
  TB_RENEWAL_MONTHS:                        { default: "12",  placeholder: true },
  FINGERPRINT_BEFORE_RESIDENT_CONTACT:      { default: "true",placeholder: true },
  CPR_FIRST_AID_RENEWAL_MONTHS:             { default: "24",  placeholder: true },
  RECORD_RETENTION_YEARS_DEFAULT:           { default: "3",   placeholder: true },
  POSTING_BILINGUAL_THRESHOLD:              { default: "english_only", placeholder: true },
  // Source-note keys parallel each setting:  <KEY>__source_note  →  text
  // Validated flag:                          <KEY>__validated    →  '1'|'0'
} as const;

export type RegSettingKey = keyof typeof REG_SETTING_KEYS;

export async function getRegSetting(facilityNumber: string, key: RegSettingKey): Promise<string>;
export async function setRegSetting(facilityNumber: string, key: RegSettingKey, value: string, sourceNote?: string, actor?: string): Promise<void>;
export async function listRegSettings(facilityNumber: string): Promise<Array<{ key: RegSettingKey; value: string; placeholder: boolean; sourceNote?: string; validated: boolean }>>;
export async function seedDefaultsForFacility(facilityNumber: string): Promise<void>; // INSERT ON CONFLICT DO NOTHING
```

Reuses [`ops_facility_settings`](server/ops/opsSchema.ts:439-446) — no
new table.

### 4.2 Evidence storage (F2)

New file `server/ops/evidenceStorage.ts`:

```ts
export interface StorageAdapter {
  put(facilityNumber: string, entityType: string, entityId: number,
      filename: string, mime: string, bytes: Buffer): Promise<{ uri: string; sha256: string; byteSize: number }>;
  get(uri: string): Promise<{ stream: NodeJS.ReadableStream; mime: string; byteSize: number }>;
  remove(uri: string): Promise<void>;
}

// v0: FlyVolumeAdapter — stores at /data/evidence/<facility>/<entity_type>/<entity_id>/<sha8>-<filename>
export class FlyVolumeAdapter implements StorageAdapter { /* … */ }

// Storage layer fns (writes to ops_evidence_attachments):
export async function attachEvidence(input: {
  facilityNumber: string;
  entityType: string;
  entityId: number;
  kind: "file" | "photo" | "external_link";
  filename?: string;
  mime?: string;
  bytes?: Buffer;
  externalUri?: string;
  uploadedBy: string;
}): Promise<number>; // returns evidence id; also writes audit_trail action='attach_evidence'

export async function listEvidence(facilityNumber: string, entityType: string, entityId: number): Promise<Evidence[]>;
export async function softDeleteEvidence(facilityNumber: string, evidenceId: number, actor: string): Promise<boolean>;
export async function readEvidenceStream(facilityNumber: string, evidenceId: number): Promise<{ stream; mime; byteSize; filename }>;
```

Constraints (v0):
- Allowed MIME: `application/pdf`, `image/jpeg`, `image/png` — strict allow-list.
- Size cap: 5 MB / file.
- AV: deferred to Wave 0.5; v0 uses mime sniff (`file-type`) + extension cross-check.
- Backup: relies on Fly volume snapshot policy; documented in §13.

### 4.3 Audit-trail storage (F3)

New file `server/ops/auditStorage.ts`:

```ts
export interface AuditEvent {
  facilityNumber: string;
  actorId: string;
  actorRole: string;
  action: "create" | "update" | "delete" | "attach_evidence" | "detach_evidence" | "resolve" | "close" | "reopen";
  entityType: string;
  entityId: number;
  before?: unknown;
  after?: unknown;
}

export async function recordAudit(ev: AuditEvent): Promise<void>; // insert-only
export async function listAuditForEntity(facilityNumber: string, entityType: string, entityId: number): Promise<AuditRow[]>;
// No update/delete API. Tamper-evidence v0 = "the table has no mutation surface in code." Wave 2 considers hash chaining.
```

### 4.4 Domain storage (Wave 1)

Append to `server/ops/opsStorage.ts` following the existing function
shape (one section per module, mirroring "Module 1 — Residents"
etc.):

```ts
// ── Module 7 — Audit Readiness ──────────────────────────────────────────

// Temperature fixtures
export async function listTemperatureFixtures(facilityNumber: string): Promise<OpsTempFixture[]>;
export async function createTemperatureFixture(data: InsertOpsTempFixture): Promise<OpsTempFixture>;
export async function updateTemperatureFixture(id, facilityNumber, data): Promise<OpsTempFixture | undefined>;
export async function softInactivateTemperatureFixture(id, facilityNumber): Promise<boolean>;

// Temperature logs
export async function listTemperatureLogs(facilityNumber, opts: { fixtureKey?: string; sinceMs?: number; outOfRangeOnly?: boolean; page; limit }): Promise<{ logs; total }>;
export async function createTemperatureLog(data: InsertOpsTempLog): Promise<OpsTempLog>;
//   ↳ side-effect: if reading violates threshold, set out_of_range=1 and follow_up_due_at = +24h. See §9.
export async function resolveTemperatureFollowUp(id, facilityNumber, actor, note): Promise<OpsTempLog | undefined>;

// Drill logs
export async function listDrillLogs(facilityNumber, opts: { kind?; sinceMs?; page; limit }): Promise<{ logs; total }>;
export async function createDrillLog(data: InsertOpsDrillLog): Promise<OpsDrillLog>;
export async function updateDrillLog(id, facilityNumber, data): Promise<OpsDrillLog | undefined>;
export async function softDeleteDrillLog(id, facilityNumber): Promise<boolean>;

// Vendors
export async function listVendors(facilityNumber, opts: { expiringWithinDays?; page; limit }): Promise<{ vendors; total }>;
export async function createVendor / updateVendor / archiveVendor

// Complaints + investigation notes
export async function listComplaints(facilityNumber, opts: { status?; page; limit }): Promise<{ complaints; total }>;
export async function getComplaint(id, facilityNumber): Promise<{ complaint; investigationNotes; evidence } | undefined>;
export async function createComplaint(data: InsertOpsComplaint): Promise<OpsComplaint>;
export async function updateComplaint(id, facilityNumber, data): Promise<OpsComplaint | undefined>;
export async function addInvestigationNote(complaintId, facilityNumber, by, note): Promise<void>;
export async function resolveComplaint(id, facilityNumber, by, resolutionNote): Promise<OpsComplaint | undefined>;
export async function closeComplaint(id, facilityNumber, by): Promise<OpsComplaint | undefined>;

// Inspections + citations
export async function listInspections(facilityNumber, opts: { sinceMs?; page; limit }): Promise<{ inspections; total }>;
export async function getInspection(id, facilityNumber): Promise<{ inspection; citations; evidence } | undefined>;
export async function createInspection / updateInspection / closeInspection
export async function addCitation(inspectionId, facilityNumber, data): Promise<OpsInspectionCitation>;
export async function closeCitation(citationId, facilityNumber, by, note): Promise<OpsInspectionCitation | undefined>;

// W11 Controlled-sub reconciliation surface
export async function listControlledSubDiscrepancies(facilityNumber, opts: { resolved?: boolean; page; limit }): Promise<{ rows; total }>;
export async function resolveControlledSubDiscrepancy(countId, facilityNumber, actor, note): Promise<OpsControlledSubCount | undefined>;
```

Every mutation function calls `recordAudit({...})` after the row
mutation succeeds (before commit if we wrap in transactions; in
practice opsStorage uses single statements, so call after the
`returning()` resolves).

---

## 5. Permission model

### 5.1 Wave 0 scaffold (no DDL change to `facility_accounts`)

Create `server/ops/permissions.ts`:

```ts
export type OpsRole = "admin" | "auditor" | "don" | "med_tech" | "schedule_lead" | "office_manager";

// Wave 0: every authenticated facility session is 'admin' until role
// modeling lands in Wave 3. This function is the seam.
export function resolveRole(req: Request): OpsRole {
  // Wave 3 will replace this with token-bound role lookup.
  return "admin";
}

export interface Permission {
  resource: string;
  actions: Array<"read" | "create" | "update" | "delete" | "resolve" | "close" | "manage_settings">;
}

// Wave 0 matrix: admin → all; auditor → read-only on Wave 1 resources;
// other roles defined but unused in v0.
export const ROLE_PERMISSIONS: Record<OpsRole, Permission[]> = {
  admin:           [/* full grant on all Wave 1 resources + reg-settings + evidence + audit-trail */],
  auditor:         [/* read on temperature_log, drill_log, vendor, complaint, inspection, controlled_sub, evidence, audit_trail, reg_setting */],
  don:             [/* deferred — Wave 2+ */],
  med_tech:        [/* deferred — Wave 2+ */],
  schedule_lead:   [/* deferred — Wave 2+ */],
  office_manager:  [/* deferred — Wave 2+ */],
};

export function requireOpsPermission(resource: string, action: Permission["actions"][number]) {
  return (req, res, next) => {
    const role = resolveRole(req);
    const allowed = ROLE_PERMISSIONS[role].some(
      (p) => p.resource === resource && p.actions.includes(action),
    );
    if (!allowed) return res.status(403).json({ success: false, error: "Forbidden" });
    next();
  };
}
```

Mounted in §7 routes per-endpoint. Wave 0 keeps the helper present
so Wave 3 only has to change `resolveRole()`.

### 5.2 IDOR reuse

Existing `opsRouter.param("facilityNumber", …)` at
[opsRouter.ts:63-69](server/ops/opsRouter.ts) covers IDOR for every
new route using the `:facilityNumber` URL form. New routes that don't
take `:facilityNumber` derive it from `req.user.facilityNumber` via
the existing `getFacilityNumber(req)` helper at
[opsRouter.ts:81-85](server/ops/opsRouter.ts).

---

## 6. Audit-trail middleware

Two integration modes:

### 6.1 Storage-layer call (preferred for Wave 0/1)

Mutation functions in `opsStorage.ts` call `recordAudit()`
explicitly. This gives full before/after JSON access and avoids
Express middleware coupling.

Pattern (illustrative):

```ts
export async function createVendor(data: InsertOpsVendor, actor: string): Promise<OpsVendor> {
  const now = Date.now();
  const rows = await db.insert(opsVendors).values({ ...data, createdAt: now, updatedAt: now }).returning();
  const row = rows[0] as OpsVendor;
  await recordAudit({
    facilityNumber: data.facilityNumber,
    actorId: actor,
    actorRole: "admin",
    action: "create",
    entityType: "ops_vendor",
    entityId: row.id,
    after: row,
  });
  return row;
}
```

### 6.2 Route-level wrapper (for read-only audit, future)

Not required in Wave 1. Documented for Wave 2 W15.

---

## 7. API contracts

All routes mount on the existing `opsRouter`
([server/ops/opsRouter.ts](server/ops/opsRouter.ts)) and inherit:
`requireFacilityAuth` + `requireActiveSubscription` + IDOR guard.
Envelope: `{ success: boolean, data?: T, error?: string }`.
Pagination: `parsePagination()` helper from
[opsRouter.ts:75-79](server/ops/opsRouter.ts).

### 7.1 Reg settings (F1)

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| `GET` | `/api/ops/facilities/:facilityNumber/reg-settings` | — | `{ success, data: RegSettingRow[] }` |
| `PUT` | `/api/ops/reg-settings/:key` | `{ value, sourceNote?, validated? }` | `{ success, data: RegSettingRow }` |
| `POST` | `/api/ops/facilities/:facilityNumber/reg-settings/seed` | — | seeds missing keys with placeholder defaults; idempotent |

Permission: read = any role; write = `manage_settings` (admin only).

### 7.2 Evidence attachments (F2)

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/api/ops/facilities/:facilityNumber/evidence?entityType=&entityId=` | — | list |
| `POST` | `/api/ops/evidence` | `multipart/form-data`: `entityType`, `entityId`, `kind`, `file` OR `externalUri` | `{ success, data: Evidence }` |
| `GET` | `/api/ops/evidence/:id/download` | — | streams file with `Content-Type` + `Content-Disposition` |
| `DELETE` | `/api/ops/evidence/:id` | — | soft-delete |

Permission per `entityType` resource (e.g., attach evidence to a
vendor requires `update` on `ops_vendor`).

### 7.3 Audit trail (F3)

| Method | Path | Query | Returns |
|---|---|---|---|
| `GET` | `/api/ops/facilities/:facilityNumber/audit-trail?entityType=&entityId=&page=&limit=` | — | paged history |

Read-only. No POST/PUT/DELETE.

### 7.4 Temperature fixtures + logs (W7)

| Method | Path | Body / Query | Notes |
|---|---|---|---|
| `GET` | `/api/ops/facilities/:facilityNumber/temp-fixtures` | — | list |
| `POST` | `/api/ops/temp-fixtures` | fixture body | create |
| `PUT` | `/api/ops/temp-fixtures/:id` | partial | update |
| `DELETE` | `/api/ops/temp-fixtures/:id` | — | soft-inactivate |
| `GET` | `/api/ops/facilities/:facilityNumber/temp-logs?fixtureKey=&sinceMs=&outOfRangeOnly=&page=&limit=` | — | list |
| `POST` | `/api/ops/temp-logs` | `{ fixtureId, readingValue, unit, readingAt, note? }` | side-effects per §9 |
| `POST` | `/api/ops/temp-logs/:id/resolve` | `{ note }` | clears out-of-range follow-up |

### 7.5 Drill logs (W5)

| Method | Path | Body | Notes |
|---|---|---|---|
| `GET` | `/api/ops/facilities/:facilityNumber/drills?kind=&sinceMs=&page=&limit=` | — | list |
| `POST` | `/api/ops/drills` | drill body | create |
| `PUT` | `/api/ops/drills/:id` | partial | update |
| `DELETE` | `/api/ops/drills/:id` | — | soft-delete |

### 7.6 Vendors (W9)

| Method | Path | Body | Notes |
|---|---|---|---|
| `GET` | `/api/ops/facilities/:facilityNumber/vendors?expiringWithinDays=&page=&limit=` | — | list |
| `POST` | `/api/ops/vendors` | vendor body | create |
| `PUT` | `/api/ops/vendors/:id` | partial | update |
| `POST` | `/api/ops/vendors/:id/archive` | — | status → archived |

### 7.7 Complaints (W10)

| Method | Path | Body | Notes |
|---|---|---|---|
| `GET` | `/api/ops/facilities/:facilityNumber/complaints?status=&page=&limit=` | — | list |
| `GET` | `/api/ops/complaints/:id` | — | detail incl. notes + evidence |
| `POST` | `/api/ops/complaints` | complaint body | create |
| `PUT` | `/api/ops/complaints/:id` | partial | update (status transitions validated) |
| `POST` | `/api/ops/complaints/:id/notes` | `{ note }` | add investigation note |
| `POST` | `/api/ops/complaints/:id/resolve` | `{ resolutionNote }` | status → resolved |
| `POST` | `/api/ops/complaints/:id/close` | — | status → closed |

### 7.8 Inspections (W13)

| Method | Path | Body | Notes |
|---|---|---|---|
| `GET` | `/api/ops/facilities/:facilityNumber/inspections?page=&limit=` | — | list |
| `GET` | `/api/ops/inspections/:id` | — | detail incl. citations + evidence |
| `POST` | `/api/ops/inspections` | inspection body | create |
| `PUT` | `/api/ops/inspections/:id` | partial | update |
| `POST` | `/api/ops/inspections/:id/close` | — | requires all citations closed |
| `POST` | `/api/ops/inspections/:id/citations` | citation body | add |
| `POST` | `/api/ops/citations/:id/close` | `{ closureNote }` | close citation |

### 7.9 Controlled-sub reconciliation (W11)

| Method | Path | Query / Body | Notes |
|---|---|---|---|
| `GET` | `/api/ops/facilities/:facilityNumber/controlled-sub/discrepancies?resolved=false&page=&limit=` | — | list — reads `ops_controlled_sub_counts` |
| `POST` | `/api/ops/controlled-sub/counts/:id/resolve` | `{ note, witnessedBy }` | sets `resolved=1`, appends to `discrepancy_notes`, optional evidence |

### 7.10 Zod schemas

All bodies are validated by zod schemas in `opsRouter.ts` per
existing pattern (e.g.,
[`residentSchema`](server/ops/opsRouter.ts:91-109),
[`signCarePlanSchema`](server/ops/opsRouter.ts:157-160)). Use
`.strict()` on every new schema so unknown fields surface as 400 (per
the comment block at
[opsRouter.ts:153-156](server/ops/opsRouter.ts)).

---

## 8. Evidence storage adapter (Fly volume v0)

- **Mount path:** `/data/evidence/` on the existing Fly volume.
- **Layout:** `/<facility_number>/<entity_type>/<entity_id>/<sha8>-<filename>`.
- **Write path:** Multer → buffer → mime sniff (`file-type`) →
  cross-check declared MIME against detected → reject mismatch →
  compute SHA256 → write to disk → record DB row → emit
  `attach_evidence` audit event.
- **Read path:** DB lookup → resolve absolute path → stream via
  `fs.createReadStream`.
- **Delete:** soft-delete in DB; physical removal deferred to a
  retention job (Wave 4).
- **Failure modes documented in §13:** volume full, file corruption,
  permission errors.
- **Limits enforced server-side:** 5 MB / file, allow-list MIME, max
  10 attachments per entity (v0 — adjustable per
  `ops_facility_setting` later).

---

## 9. Out-of-range hook (W7)

Wave 1 keeps follow-up state *inline* on `ops_temperature_logs` to
avoid touching `ops_compliance_calendar`. Pseudocode for
`createTemperatureLog`:

```ts
export async function createTemperatureLog(input: TempLogInput, actor: string): Promise<OpsTempLog> {
  const fixture = await getFixture(input.fixtureId, input.facilityNumber);
  if (!fixture) throw new Error("Fixture not found");

  const oor = isOutOfRange(input.readingValue, fixture.requiredMin, fixture.requiredMax);
  const followUpDue = oor ? Date.now() + 24 * 60 * 60 * 1000 : null;

  const row = await db.insert(opsTemperatureLogs).values({
    facilityNumber: input.facilityNumber,
    fixtureId: fixture.id,
    fixtureKey: fixture.fixtureKey,
    readingValue: input.readingValue,
    unit: fixture.unit,
    thresholdMin: fixture.requiredMin,
    thresholdMax: fixture.requiredMax,
    outOfRange: oor ? 1 : 0,
    readingAt: input.readingAt,
    recordedBy: actor,
    note: input.note ?? null,
    followUpDueAt: followUpDue,
    createdAt: Date.now(),
  }).returning();

  await recordAudit({ /* create event */ });
  return row[0];
}
```

When Wave 2's obligation engine arrives, the `ops_temperature_logs`
projection becomes a virtual obligation source — no schema change in
that table.

---

## 10. Frontend implementation map

All new client code lives under `client/src/components/operations/`
and `client/src/pages/` (no new top-level routes — sub-views render
inside `OperationsTab`).

| Wave 0/1 deliverable | New / modified file | Reuses |
|---|---|---|
| Audit Readiness sub-view shell | `client/src/components/operations/AuditReadinessContent.tsx` (NEW) | `portal-tabs`, `<Tabs>` (see [StaffContent.tsx:386-391](client/src/components/operations/StaffContent.tsx)) |
| Sidebar nav entry | `client/src/components/OperationsTab.tsx` — append `{ key: "audit_readiness", label: "Audit Readiness", icon: ShieldCheck }` to `NAV_ITEMS` ([line 178](client/src/components/OperationsTab.tsx)) | existing nav |
| `<AttachEvidence>` | `client/src/components/operations/AttachEvidence.tsx` (NEW) | `Button` (`gradient`), lucide `Paperclip`, `Skeleton`; uses `apiRequest` |
| `<AuditTrailButton>` | `client/src/components/operations/AuditTrailButton.tsx` (NEW) | shadcn `Sheet` for slide-in panel; `useQuery` |
| Reg Settings | `client/src/components/operations/RegSettingsContent.tsx` (NEW) | `<FormField>`, status badge for `[V]` |
| Drills tab | `client/src/components/operations/DrillsContent.tsx` (NEW) | `ComplianceContent` skeleton (header + summary tiles + group-by-month list + AddX dialog) |
| Logs tab (W7) | `client/src/components/operations/TemperatureLogsContent.tsx` (NEW) | same as Drills; mobile-first record dialog |
| Vendors tab | `client/src/components/operations/VendorsContent.tsx` (NEW) | `StaffContent` table pattern |
| Complaints tab + detail | `client/src/components/operations/ComplaintsContent.tsx` + `ComplaintDetail.tsx` (NEW) | `IncidentsContent` detail-pane pattern |
| Inspections tab | `client/src/components/operations/InspectionsContent.tsx` (NEW) | `ComplianceContent` skeleton |
| eMAR Controlled-Sub tab (W11) | extends `client/src/components/operations/EmarContent.tsx` — new tab via existing tabbed shell | reuse existing eMAR `Tabs` |

No new global state. All data via existing `apiRequest` / `getQueryFn`
in [`client/src/lib/queryClient.ts`](client/src/lib/queryClient.ts).
Query keys follow `[\`/api/ops/...\`]` shape.

---

## 11. Ticket breakdown (epics → stories)

### Epic A — Wave 0 foundation (2 weeks, blocking everything else)

| # | Story | Owner | Cite the reused pattern |
|---|---|---|---|
| A1 | DDL: append `ops_evidence_attachments` + `ops_audit_trail` to `OPS_PG_SCHEMA_SQL` | BE | mirrors [`ops_compliance_calendar` DDL block](server/ops/opsSchema.ts:448-462) |
| A2 | Drizzle: add `opsEvidenceAttachments` + `opsAuditTrail` + types | BE | mirrors all existing `pgTable` defs in `opsSchema.ts` |
| A3 | `server/ops/regSettings.ts` — catalogue, getters, seeder | BE | extends existing `ops_facility_settings` |
| A4 | `server/ops/evidenceStorage.ts` — `FlyVolumeAdapter` + `attachEvidence` + read/list/delete | BE | new; documented constraints in §8 |
| A5 | `server/ops/auditStorage.ts` — `recordAudit` + `listAuditForEntity` | BE | new |
| A6 | `server/ops/permissions.ts` — `OpsRole`, `ROLE_PERMISSIONS`, `requireOpsPermission`, `resolveRole` (admin-only v0) | BE | mounted alongside existing `requireFacilityAuth` |
| A7 | Routes for reg settings (§7.1), evidence (§7.2), audit trail (§7.3) | BE | mounts on `opsRouter` |
| A8 | Multer upload pipeline + mime sniff (`file-type`) | BE | new dep; size cap 5 MB |
| A9 | `<AttachEvidence>` component | FE | reuses `<Button variant="gradient">`, `Paperclip` icon |
| A10 | `<AuditTrailButton>` component | FE | reuses shadcn `Sheet` |
| A11 | `<RegSettingsContent>` page (Reg Settings UI) | FE | reuses `<FormField>` |
| A12 | Server tests for A3–A8 (Vitest project: server) | BE | `npm run test:server` |
| A13 | Client component smoke tests for A9–A11 | FE | `npm run test:client` |

### Epic B — Wave 1 (4–6 weeks, ordered)

| # | Story | Owner | Notes |
|---|---|---|---|
| B1 | W11: list + resolve controlled-sub discrepancies (BE + eMAR FE tab) | BE+FE | no new tables; reads `ops_controlled_sub_counts` |
| B2 | W7: DDL + storage + routes for `ops_temperature_fixtures`/`logs` | BE | wires §9 hook |
| B3 | W7: `<TemperatureLogsContent>` (Audit Readiness → Logs tab) | FE | desktop list + mobile-first record dialog |
| B4 | W5: DDL + storage + routes for `ops_drill_logs` | BE | |
| B5 | W5: `<DrillsContent>` | FE | |
| B6 | W9: DDL + storage + routes for `ops_vendors` | BE | |
| B7 | W9: `<VendorsContent>` | FE | |
| B8 | W10: DDL + storage + routes for `ops_complaints` + `ops_complaint_investigation_notes` | BE | |
| B9 | W10: `<ComplaintsContent>` + `<ComplaintDetail>` | FE | |
| B10 | W13: DDL + storage + routes for `ops_inspections` + `ops_inspection_citations` | BE | |
| B11 | W13: `<InspectionsContent>` | FE | |
| B12 | OperationsTab: add `audit_readiness` sub-view + `<AuditReadinessContent>` tab shell | FE | |
| B13 | OperationsTab nav entry between Compliance and CRM | FE | |
| B14 | E2E test: log temperature out-of-range → audit trail records → evidence attached → resolve flow | BE+FE | |
| B15 | Documentation: update CLAUDE.md "Operations module" section | doc-agent | |

### Epic C — Roadmap stubs (NOT in Wave 0/1 scope, documented for Phase 5 review)

Wave 2 — W3 staff credentials + obligation engine migration + W4
incident closer + W8 chart sweep + W15 audit-trail viewer.
Wave 3 — W1 triage + W14 email + Auditor share-link + W2 pre-audit
pull.
Wave 4 — W6 postings + W12 trust + drill cadence calc + audit-trail
retrofit.

---

## 12. Test plan

Every Wave 0/1 ticket must add tests per the existing
[`server/__tests__/ops/`](server/__tests__/ops/) and `client/src/`
test conventions.

| Area | Test type | Examples |
|---|---|---|
| Reg settings | Server unit | seed idempotency; `setRegSetting` records audit; non-admin role denied write |
| Evidence storage | Server unit | mime sniff rejects mismatched extension; size cap enforced; SHA256 stable; soft-delete preserves rows |
| Audit trail | Server unit | append-only (no update/delete API exposed); read by entity returns chronological; tamper detection (Wave 0 = "no mutation surface in code") |
| Temperature out-of-range | Server unit | reading below `requiredMin` triggers `out_of_range=1` and `follow_up_due_at`; resolve clears follow-up; subsequent in-range reading does not auto-resolve a prior follow-up |
| Drill log | Server unit | participants_json round-trips; soft-delete preserves audit history |
| Vendor expiry | Server unit | `expiringWithinDays` query filter correctness across COI and license |
| Complaint lifecycle | Server unit | status transitions: open → investigating → resolved → closed; reverse blocked except open→… reopen path |
| Inspection close gating | Server unit | cannot close inspection while any citation is open |
| W11 resolve | Server unit | `resolved=0` → `resolved=1`; appends to `discrepancy_notes`; audit record emitted |
| Cross-cutting permissions | Server unit | every Wave 1 route returns 401/403/404 in the right cases; IDOR guard enforced via `:facilityNumber` |
| FE smoke | Client | Audit Readiness sub-view renders all 6 tabs without crash; `<AttachEvidence>` mock upload happy path; `<AuditTrailButton>` opens panel |
| E2E (single happy path) | Manual / Playwright | log a temperature out-of-range → see follow-up → attach photo → resolve → confirm audit trail shows full sequence |

Test runner: `npm run test:server` for server, `npm run test:client`
for client; `npx vitest run path` for single files.

---

## 13. Deployment, rollout, rollback

### 13.1 Deployment

1. **Schema bootstrap** — additive DDL takes effect on next pod
   restart via `bootstrapOpsSchema()`. No migration runner needed.
2. **Fly volume** — confirm `/data/evidence/` exists and is writable
   pre-deploy (one-off `fly ssh` check; document in
   [fly.toml](fly.toml) volume mount).
3. **Multer config** — picks up via `npm install file-type multer`
   already on the dependency tree (verify).
4. **No env-var additions for Wave 0/1.** Existing `SESSION_SECRET`,
   `RESEND_API_KEY`, `STRIPE_*`, etc. are sufficient.
5. **Deploy:** `npm run deploy` (existing `fly deploy` wrapper).

### 13.2 Rollout

- Wave 0 ships behind the existing Operations Pro paywall (every new
  route goes through `requireActiveSubscription` already).
- No feature flag in Wave 0/1: the Audit Readiness sub-view simply
  appears in the sidebar on the next deploy. Empty states are
  designed to handle "no data yet" gracefully (Phase 3 §5).
- Internal dogfood: enable for the user's own facility account first;
  validate end-to-end before broader notification.

### 13.3 Rollback

- **Code:** revert the deploy.
- **Schema:** additive tables remain harmless even if code is
  reverted. No backwards-incompatible change in Wave 0/1, so
  rollback does not require schema rollback.
- **Evidence files:** on rollback, files on disk are orphaned but
  harmless. Document a manual cleanup script for re-deploy.
- **Audit trail:** insert-only; rollback never deletes rows.

### 13.4 Backups

- Sessions live in Postgres (`session` table via `connect-pg-simple`),
  so session backups follow the database backup policy — see
  `docs/runbooks/backup-restore.md` (Neon PITR / branch-from-timestamp).
  Fly volume snapshot policy (existing) covers the `/data/evidence/`
  tree only. **Open item:** confirm snapshot cadence and retention for
  the evidence volume; if absent, propose a Wave 0.5 ticket to harden.

---

## 14. Risks + open items (for Phase 5 admin validation)

| # | Risk / open item | Mitigation |
|---|---|---|
| R1 | Fly volume snapshot policy unconfirmed | §13.4 — confirm before Wave 1 ships any evidence to prod |
| R2 | No AV scan in Wave 0 | Mime sniff + size cap + restricted MIME allow-list; Wave 0.5 ticket to add clamav-as-a-service or equivalent |
| R3 | Reg-setting placeholder values shipped to prod | UI shows `[V]` chip; alert behavior based on them clearly flagged in §1 of BRD; Phase 5 validation replaces values |
| R4 | Concurrent edits on the same complaint / inspection | Wave 0 uses last-write-wins (existing pattern); document; consider optimistic locking in Wave 2 if pain emerges |
| R5 | Out-of-range hook only fires on insert, not on threshold edits | Acceptable v0 — admins rarely retune thresholds. Document. |
| R6 | Audit-trail before/after JSON could leak PII into logs if size exceeds | Cap stored JSON at 16 KB; truncate with `…(truncated)` marker |
| R7 | Auditor role exists in `permissions.ts` but no way to *be* an auditor in Wave 0 | Intentional scaffold; Wave 3 introduces share-link |
| R8 | Implementation Contract violations from third-party shadcn updates | Pin shadcn versions; review on bump |
| R9 | The Drills tab ships without cadence enforcement | UI explicitly says "Quarter cadence enforcement arrives later" — Phase 3 §4.3 |
| R10 | No mobile-first photo capture compression in `<AttachEvidence>` v0 | 5 MB cap absorbs typical phone JPEGs; revisit if storage costs spike |

### Dependencies on Phase 5 admin validation

Phase 5 must validate (or correct) these Wave 0 placeholders before
they drive any *consequential* behavior:

- `HOT_WATER_MAX_F = 110` — drives `out_of_range` flag on every hot-water reading.
- `FRIDGE_MIN_F = 32` / `FRIDGE_MAX_F = 40` — same.
- `FREEZER_MAX_F = 0` — same.
- `INCIDENT_*` SLA windows — drives Wave 2 incident closer; not behavioral in Wave 1.
- `LIC_624_WRITTEN_DAYS = 7` — same.
- `SOC_341_VERBAL_HOURS = 2` — same.
- `FIRE_DRILLS_PER_SHIFT_PER_QUARTER = 1` — drives Wave 4 cadence calc; not behavioral in Wave 1.

Wave 0/1 ships safely with placeholders because (a) the only
behavioral usage is the temperature out-of-range flag, (b) the
flagged threshold is conservative — citing a slightly low cap creates
a nuisance flag, not a missed risk, (c) the admin can edit the value
inline at any time, (d) every reading row stores the threshold at
insert time so historical data is unaffected by future edits.

---

## 15. Files touched checklist

### Server

- `server/ops/opsSchema.ts` — extend `OPS_PG_SCHEMA_SQL`; add `pgTable` + types.
- `server/ops/opsStorage.ts` — append Module 7 storage functions; call `recordAudit` from every mutation.
- `server/ops/opsRouter.ts` — append Wave 0 + Wave 1 routes; new zod schemas; `requireOpsPermission` middleware applied per-route.
- `server/ops/regSettings.ts` — NEW.
- `server/ops/evidenceStorage.ts` — NEW.
- `server/ops/auditStorage.ts` — NEW.
- `server/ops/permissions.ts` — NEW.
- `server/__tests__/ops/regSettings.test.ts` — NEW.
- `server/__tests__/ops/evidenceStorage.test.ts` — NEW.
- `server/__tests__/ops/auditTrail.test.ts` — NEW.
- `server/__tests__/ops/temperatureLogs.test.ts` — NEW.
- `server/__tests__/ops/drillLogs.test.ts` — NEW.
- `server/__tests__/ops/vendors.test.ts` — NEW.
- `server/__tests__/ops/complaints.test.ts` — NEW.
- `server/__tests__/ops/inspections.test.ts` — NEW.
- `server/__tests__/ops/controlledSubReconciliation.test.ts` — NEW.
- `server/__tests__/ops/opsRouter.audit.test.ts` — NEW (cross-cutting permissions).

### Shared

- `shared/schema.ts` — no change (ops uses its own `opsSchema.ts`).

### Client

- `client/src/components/OperationsTab.tsx` — append `audit_readiness` to `SubView` type and `NAV_ITEMS`.
- `client/src/components/operations/AuditReadinessContent.tsx` — NEW (tab shell).
- `client/src/components/operations/AttachEvidence.tsx` — NEW.
- `client/src/components/operations/AuditTrailButton.tsx` — NEW.
- `client/src/components/operations/RegSettingsContent.tsx` — NEW.
- `client/src/components/operations/DrillsContent.tsx` — NEW.
- `client/src/components/operations/TemperatureLogsContent.tsx` — NEW.
- `client/src/components/operations/VendorsContent.tsx` — NEW.
- `client/src/components/operations/ComplaintsContent.tsx` — NEW.
- `client/src/components/operations/ComplaintDetail.tsx` — NEW.
- `client/src/components/operations/InspectionsContent.tsx` — NEW.
- `client/src/components/operations/EmarContent.tsx` — extend with a "Controlled Subs" tab.
- `client/src/lib/queryClient.ts` — no change (envelope + helpers already exist).

### Docs

- `docs/operations/README.md` — update phase index.
- `CLAUDE.md` — Wave 0/1 paragraph added under the existing
  "Operations module" section once shipped (documentation-agent
  handoff).

### Deploy / infra

- `fly.toml` — confirm `/data/evidence/` mount; document snapshot policy.
- `package.json` — add `file-type` if not present (verify); `multer` already present (verify).

---

## 16. Acceptance criteria for Phase 4 sign-off

1. §1 migration philosophy approved.
2. §2 DDL approved as additive-only; no surprises in field types or
   defaults.
3. §3–§4 storage / type pattern matches existing `opsSchema.ts` /
   `opsStorage.ts` conventions (Implementation Contract §2.5).
4. §5 permission scaffold approved (Auditor role placeholder
   acceptable in Wave 0).
5. §7 API contracts approved.
6. §9 out-of-range inline-state approach (no `ops_compliance_calendar`
   touch) approved.
7. §11 ticket breakdown approved as the Phase 5 implementation queue.
8. §14 risks acknowledged; R1 (volume snapshot policy) accepted as a
   pre-Wave-1-ship gate.
