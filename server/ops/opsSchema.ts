/**
 * Facility Operations Module — database schema
 *
 * All ops_ tables are defined here as:
 *   1. OPS_SCHEMA_SQL  — idempotent CREATE TABLE IF NOT EXISTS SQL executed at
 *      startup by server/storage.ts (same pattern as the existing bootstrap block).
 *   2. Drizzle table objects — used for typed queries.
 *   3. Inferred TypeScript type aliases.
 *
 * Rules:
 *  - All timestamps are INTEGER (Unix epoch milliseconds).
 *  - facility_number is TEXT (not INTEGER) to match facility_accounts.facility_number.
 *  - All table names are prefixed ops_ to avoid collisions.
 */

import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// ─────────────────────────────────────────────────────────────────────────────
// OPS_SCHEMA_SQL — executed once at startup via sqlite.exec(OPS_SCHEMA_SQL)
// ─────────────────────────────────────────────────────────────────────────────

export const OPS_SCHEMA_SQL = `
  -- ── Module 1: Residents / EHR ──────────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS ops_residents (
    id                        INTEGER PRIMARY KEY AUTOINCREMENT,
    facility_number           TEXT NOT NULL,
    first_name                TEXT NOT NULL,
    last_name                 TEXT NOT NULL,
    dob                       INTEGER,
    gender                    TEXT,
    ssn_last4                 TEXT,
    admission_date            INTEGER,
    discharge_date            INTEGER,
    room_number               TEXT,
    bed_number                TEXT,
    primary_dx                TEXT,
    secondary_dx              TEXT,
    level_of_care             TEXT,
    emergency_contact_name    TEXT,
    emergency_contact_phone   TEXT,
    emergency_contact_relation TEXT,
    funding_source            TEXT,
    regional_center_id        TEXT,
    status                    TEXT NOT NULL DEFAULT 'active',
    created_at                INTEGER NOT NULL,
    updated_at                INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_residents_facility ON ops_residents(facility_number);
  CREATE INDEX IF NOT EXISTS idx_ops_residents_status   ON ops_residents(status);
  CREATE INDEX IF NOT EXISTS idx_ops_residents_adm_date ON ops_residents(admission_date);

  CREATE TABLE IF NOT EXISTS ops_resident_assessments (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    resident_id           INTEGER NOT NULL,
    facility_number       TEXT NOT NULL,
    assessment_type       TEXT NOT NULL,
    assessed_by           TEXT NOT NULL,
    assessed_at           INTEGER NOT NULL,
    bathing               INTEGER DEFAULT 0,
    dressing              INTEGER DEFAULT 0,
    grooming              INTEGER DEFAULT 0,
    toileting             INTEGER DEFAULT 0,
    continence            INTEGER DEFAULT 0,
    eating                INTEGER DEFAULT 0,
    mobility              INTEGER DEFAULT 0,
    transfers             INTEGER DEFAULT 0,
    meal_prep             INTEGER DEFAULT 0,
    housekeeping          INTEGER DEFAULT 0,
    laundry               INTEGER DEFAULT 0,
    transportation        INTEGER DEFAULT 0,
    finances              INTEGER DEFAULT 0,
    communication         INTEGER DEFAULT 0,
    cognition_score       INTEGER,
    behavior_notes        TEXT,
    fall_risk_level       TEXT,
    vision                TEXT,
    hearing               TEXT,
    speech                TEXT,
    ambulation            TEXT,
    self_administer_meds  INTEGER DEFAULT 0,
    next_due_date         INTEGER,
    lic_form_number       TEXT,
    raw_json              TEXT,
    created_at            INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_ra_resident   ON ops_resident_assessments(resident_id);
  CREATE INDEX IF NOT EXISTS idx_ops_ra_facility   ON ops_resident_assessments(facility_number);
  CREATE INDEX IF NOT EXISTS idx_ops_ra_assessed   ON ops_resident_assessments(assessed_at);

  CREATE TABLE IF NOT EXISTS ops_care_plans (
    id                         INTEGER PRIMARY KEY AUTOINCREMENT,
    resident_id                INTEGER NOT NULL,
    facility_number            TEXT NOT NULL,
    created_by                 TEXT NOT NULL,
    effective_date             INTEGER NOT NULL,
    review_date                INTEGER NOT NULL,
    goal                       TEXT NOT NULL,
    intervention               TEXT NOT NULL,
    frequency                  TEXT NOT NULL,
    responsible_staff          TEXT,
    digital_signature_resident TEXT,
    digital_signature_family   TEXT,
    signature_date             INTEGER,
    status                     TEXT NOT NULL DEFAULT 'draft',
    created_at                 INTEGER NOT NULL,
    updated_at                 INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_cp_resident ON ops_care_plans(resident_id);
  CREATE INDEX IF NOT EXISTS idx_ops_cp_status   ON ops_care_plans(status);

  CREATE TABLE IF NOT EXISTS ops_daily_tasks (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    care_plan_id     INTEGER NOT NULL,
    resident_id      INTEGER NOT NULL,
    facility_number  TEXT NOT NULL,
    task_name        TEXT NOT NULL,
    task_type        TEXT NOT NULL,
    scheduled_time   TEXT,
    shift            TEXT,
    assigned_to      TEXT,
    status           TEXT NOT NULL DEFAULT 'pending',
    completed_at     INTEGER,
    completion_notes TEXT,
    refused          INTEGER DEFAULT 0,
    refuse_reason    TEXT,
    task_date        INTEGER NOT NULL,
    created_at       INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_dt_resident  ON ops_daily_tasks(resident_id);
  CREATE INDEX IF NOT EXISTS idx_ops_dt_task_date ON ops_daily_tasks(task_date);
  CREATE INDEX IF NOT EXISTS idx_ops_dt_status    ON ops_daily_tasks(status);

  -- ── Module 2: eMAR ─────────────────────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS ops_medications (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    resident_id              INTEGER NOT NULL,
    facility_number          TEXT NOT NULL,
    drug_name                TEXT NOT NULL,
    generic_name             TEXT,
    dosage                   TEXT NOT NULL,
    route                    TEXT NOT NULL,
    frequency                TEXT NOT NULL,
    scheduled_times          TEXT,
    prescriber_name          TEXT,
    prescriber_npi           TEXT,
    rx_number                TEXT,
    pharmacy_name            TEXT,
    start_date               INTEGER,
    end_date                 INTEGER,
    is_prn                   INTEGER DEFAULT 0,
    prn_indication           TEXT,
    is_controlled            INTEGER DEFAULT 0,
    is_psychotropic          INTEGER DEFAULT 0,
    is_hazardous             INTEGER DEFAULT 0,
    classification           TEXT,
    requires_vitals_before   INTEGER DEFAULT 0,
    vital_type               TEXT,
    refill_threshold_days    INTEGER DEFAULT 7,
    auto_refill_request      INTEGER DEFAULT 0,
    status                   TEXT NOT NULL DEFAULT 'active',
    discontinued_reason      TEXT,
    discontinued_by          TEXT,
    discontinued_at          INTEGER,
    created_at               INTEGER NOT NULL,
    updated_at               INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_med_resident ON ops_medications(resident_id);
  CREATE INDEX IF NOT EXISTS idx_ops_med_facility ON ops_medications(facility_number);
  CREATE INDEX IF NOT EXISTS idx_ops_med_status   ON ops_medications(status);

  CREATE TABLE IF NOT EXISTS ops_med_passes (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    medication_id               INTEGER NOT NULL,
    resident_id                 INTEGER NOT NULL,
    facility_number             TEXT NOT NULL,
    scheduled_datetime          INTEGER NOT NULL,
    administered_datetime       INTEGER,
    administered_by             TEXT,
    witness_by                  TEXT,
    right_resident              INTEGER DEFAULT 0,
    right_medication            INTEGER DEFAULT 0,
    right_dose                  INTEGER DEFAULT 0,
    right_route                 INTEGER DEFAULT 0,
    right_time                  INTEGER DEFAULT 0,
    right_reason                INTEGER DEFAULT 0,
    right_documentation         INTEGER DEFAULT 0,
    right_to_refuse             INTEGER DEFAULT 0,
    status                      TEXT NOT NULL DEFAULT 'pending',
    refusal_reason              TEXT,
    hold_reason                 TEXT,
    notes                       TEXT,
    pre_vitals_bp               TEXT,
    pre_vitals_pulse            INTEGER,
    pre_vitals_temp             REAL,
    pre_vitals_spo2             INTEGER,
    prn_reason                  TEXT,
    prn_effectiveness_noted_at  INTEGER,
    prn_effectiveness_notes     TEXT,
    created_at                  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_mp_medication ON ops_med_passes(medication_id);
  CREATE INDEX IF NOT EXISTS idx_ops_mp_resident   ON ops_med_passes(resident_id);
  CREATE INDEX IF NOT EXISTS idx_ops_mp_scheduled  ON ops_med_passes(scheduled_datetime);
  CREATE INDEX IF NOT EXISTS idx_ops_mp_status     ON ops_med_passes(status);

  CREATE TABLE IF NOT EXISTS ops_controlled_sub_counts (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    medication_id      INTEGER NOT NULL,
    facility_number    TEXT NOT NULL,
    count_date         INTEGER NOT NULL,
    shift              TEXT NOT NULL,
    counted_by         TEXT NOT NULL,
    witnessed_by       TEXT NOT NULL,
    opening_count      INTEGER NOT NULL,
    closing_count      INTEGER NOT NULL,
    administered_count INTEGER NOT NULL DEFAULT 0,
    wasted_count       INTEGER NOT NULL DEFAULT 0,
    discrepancy        INTEGER DEFAULT 0,
    discrepancy_notes  TEXT,
    resolved           INTEGER DEFAULT 0,
    created_at         INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_csc_medication  ON ops_controlled_sub_counts(medication_id);
  CREATE INDEX IF NOT EXISTS idx_ops_csc_count_date  ON ops_controlled_sub_counts(count_date);

  CREATE TABLE IF NOT EXISTS ops_med_destruction (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    medication_id      INTEGER NOT NULL,
    facility_number    TEXT NOT NULL,
    quantity           INTEGER NOT NULL,
    unit               TEXT NOT NULL,
    destruction_method TEXT NOT NULL,
    destroyed_by       TEXT NOT NULL,
    witnessed_by       TEXT NOT NULL,
    destruction_date   INTEGER NOT NULL,
    reason             TEXT NOT NULL,
    created_at         INTEGER NOT NULL
  );

  -- ── Module 3: Incidents ────────────────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS ops_incidents (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    facility_number          TEXT NOT NULL,
    resident_id              INTEGER,
    incident_type            TEXT NOT NULL,
    incident_date            INTEGER NOT NULL,
    incident_time            TEXT,
    location                 TEXT,
    description              TEXT NOT NULL,
    immediate_action_taken   TEXT,
    injury_involved          INTEGER DEFAULT 0,
    injury_description       TEXT,
    hospitalization_required INTEGER DEFAULT 0,
    hospital_name            TEXT,
    reported_by              TEXT NOT NULL,
    supervisor_notified      INTEGER DEFAULT 0,
    supervisor_notified_at   INTEGER,
    family_notified          INTEGER DEFAULT 0,
    family_notified_at       INTEGER,
    physician_notified       INTEGER DEFAULT 0,
    physician_notified_at    INTEGER,
    lic_624_required         INTEGER DEFAULT 0,
    lic_624_submitted        INTEGER DEFAULT 0,
    lic_624_submitted_at     INTEGER,
    soc_341_required         INTEGER DEFAULT 0,
    soc_341_submitted        INTEGER DEFAULT 0,
    root_cause               TEXT,
    corrective_action        TEXT,
    follow_up_date           INTEGER,
    follow_up_completed      INTEGER DEFAULT 0,
    status                   TEXT NOT NULL DEFAULT 'open',
    created_at               INTEGER NOT NULL,
    updated_at               INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_inc_facility      ON ops_incidents(facility_number);
  CREATE INDEX IF NOT EXISTS idx_ops_inc_resident      ON ops_incidents(resident_id);
  CREATE INDEX IF NOT EXISTS idx_ops_inc_incident_date ON ops_incidents(incident_date);
  CREATE INDEX IF NOT EXISTS idx_ops_inc_status        ON ops_incidents(status);

  -- ── Module 4: CRM / Admissions ─────────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS ops_leads (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    facility_number      TEXT NOT NULL,
    contact_name         TEXT NOT NULL,
    contact_phone        TEXT,
    contact_email        TEXT,
    contact_relation     TEXT,
    prospect_name        TEXT NOT NULL,
    prospect_dob         INTEGER,
    prospect_gender      TEXT,
    care_needs_summary   TEXT,
    funding_source       TEXT,
    desired_move_in_date INTEGER,
    referral_source      TEXT,
    assigned_to          TEXT,
    stage                TEXT NOT NULL DEFAULT 'inquiry',
    lost_reason          TEXT,
    notes                TEXT,
    last_contact_date    INTEGER,
    next_follow_up_date  INTEGER,
    created_at           INTEGER NOT NULL,
    updated_at           INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_leads_facility     ON ops_leads(facility_number);
  CREATE INDEX IF NOT EXISTS idx_ops_leads_stage        ON ops_leads(stage);
  CREATE INDEX IF NOT EXISTS idx_ops_leads_follow_up    ON ops_leads(next_follow_up_date);

  CREATE TABLE IF NOT EXISTS ops_tours (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id        INTEGER NOT NULL,
    facility_number TEXT NOT NULL,
    scheduled_at   INTEGER NOT NULL,
    completed_at   INTEGER,
    conducted_by   TEXT,
    outcome        TEXT,
    notes          TEXT,
    follow_up_action TEXT,
    created_at     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ops_admissions (
    id                           INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id                      INTEGER NOT NULL,
    facility_number              TEXT NOT NULL,
    resident_id                  INTEGER,
    lic_601_completed            INTEGER DEFAULT 0,
    lic_601_date                 INTEGER,
    lic_602a_completed           INTEGER DEFAULT 0,
    lic_602a_date                INTEGER,
    lic_603_completed            INTEGER DEFAULT 0,
    lic_603_date                 INTEGER,
    lic_604a_completed           INTEGER DEFAULT 0,
    lic_604a_date                INTEGER,
    lic_605a_completed           INTEGER DEFAULT 0,
    lic_605a_date                INTEGER,
    lic_610d_completed           INTEGER DEFAULT 0,
    lic_610d_date                INTEGER,
    admission_agreement_signed    INTEGER DEFAULT 0,
    admission_agreement_signed_at INTEGER,
    admission_agreement_signed_by TEXT,
    physician_report_received    INTEGER DEFAULT 0,
    tb_test_results_received     INTEGER DEFAULT 0,
    move_in_date                 INTEGER,
    move_in_completed            INTEGER DEFAULT 0,
    assigned_room                TEXT,
    welcome_completed            INTEGER DEFAULT 0,
    notes                        TEXT,
    created_at                   INTEGER NOT NULL,
    updated_at                   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_adm_lead     ON ops_admissions(lead_id);
  CREATE INDEX IF NOT EXISTS idx_ops_adm_facility ON ops_admissions(facility_number);

  -- ── Module 5: Billing ──────────────────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS ops_billing_charges (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    facility_number      TEXT NOT NULL,
    resident_id          INTEGER NOT NULL,
    charge_type          TEXT NOT NULL,
    description          TEXT NOT NULL,
    amount               REAL NOT NULL,
    unit                 TEXT,
    quantity             REAL NOT NULL DEFAULT 1,
    billing_period_start INTEGER,
    billing_period_end   INTEGER,
    is_recurring         INTEGER DEFAULT 0,
    recurrence_interval  TEXT,
    prorated             INTEGER DEFAULT 0,
    prorate_from         INTEGER,
    prorate_to           INTEGER,
    source               TEXT NOT NULL DEFAULT 'manual',
    clinical_ref_id      INTEGER,
    created_at           INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_bc_facility  ON ops_billing_charges(facility_number);
  CREATE INDEX IF NOT EXISTS idx_ops_bc_resident  ON ops_billing_charges(resident_id);

  CREATE TABLE IF NOT EXISTS ops_invoices (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    facility_number      TEXT NOT NULL,
    resident_id          INTEGER NOT NULL,
    invoice_number       TEXT NOT NULL UNIQUE,
    billing_period_start INTEGER NOT NULL,
    billing_period_end   INTEGER NOT NULL,
    subtotal             REAL NOT NULL DEFAULT 0,
    tax                  REAL NOT NULL DEFAULT 0,
    total                REAL NOT NULL DEFAULT 0,
    amount_paid          REAL NOT NULL DEFAULT 0,
    balance_due          REAL NOT NULL DEFAULT 0,
    status               TEXT NOT NULL DEFAULT 'draft',
    due_date             INTEGER,
    sent_at              INTEGER,
    paid_at              INTEGER,
    payment_method       TEXT,
    payment_reference    TEXT,
    notes                TEXT,
    created_at           INTEGER NOT NULL,
    updated_at           INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_inv_facility ON ops_invoices(facility_number);
  CREATE INDEX IF NOT EXISTS idx_ops_inv_resident ON ops_invoices(resident_id);
  CREATE INDEX IF NOT EXISTS idx_ops_inv_status   ON ops_invoices(status);
  CREATE INDEX IF NOT EXISTS idx_ops_inv_due_date ON ops_invoices(due_date);

  CREATE TABLE IF NOT EXISTS ops_payments (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id       INTEGER NOT NULL,
    facility_number  TEXT NOT NULL,
    resident_id      INTEGER NOT NULL,
    amount           REAL NOT NULL,
    payment_date     INTEGER NOT NULL,
    payment_method   TEXT NOT NULL,
    reference_number TEXT,
    type             TEXT NOT NULL DEFAULT 'payment',
    notes            TEXT,
    recorded_by      TEXT,
    created_at       INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_pay_invoice ON ops_payments(invoice_id);

  -- ── Module 6: Staff / Scheduling ───────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS ops_staff (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    facility_number  TEXT NOT NULL,
    first_name       TEXT NOT NULL,
    last_name        TEXT NOT NULL,
    email            TEXT,
    phone            TEXT,
    role             TEXT NOT NULL,
    hire_date        INTEGER,
    termination_date INTEGER,
    license_number   TEXT,
    license_expiry   INTEGER,
    status           TEXT NOT NULL DEFAULT 'active',
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_staff_facility ON ops_staff(facility_number);
  CREATE INDEX IF NOT EXISTS idx_ops_staff_status   ON ops_staff(status);

  CREATE TABLE IF NOT EXISTS ops_shifts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    facility_number TEXT NOT NULL,
    staff_id        INTEGER NOT NULL,
    shift_date      INTEGER NOT NULL,
    shift_type      TEXT NOT NULL,
    start_time      TEXT NOT NULL,
    end_time        TEXT NOT NULL,
    is_overtime     INTEGER DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'scheduled',
    covered_by_id   INTEGER,
    notes           TEXT,
    created_at      INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_shifts_facility   ON ops_shifts(facility_number);
  CREATE INDEX IF NOT EXISTS idx_ops_shifts_staff      ON ops_shifts(staff_id);
  CREATE INDEX IF NOT EXISTS idx_ops_shifts_shift_date ON ops_shifts(shift_date);

  CREATE TABLE IF NOT EXISTS ops_facility_settings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    facility_number TEXT NOT NULL,
    setting_key     TEXT NOT NULL,
    setting_value   TEXT,
    updated_at      INTEGER NOT NULL,
    UNIQUE(facility_number, setting_key)
  );

  CREATE TABLE IF NOT EXISTS ops_compliance_calendar (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    facility_number     TEXT NOT NULL,
    item_type           TEXT NOT NULL,
    description         TEXT NOT NULL,
    due_date            INTEGER NOT NULL,
    completed_date      INTEGER,
    assigned_to         TEXT,
    status              TEXT NOT NULL DEFAULT 'pending',
    reminder_days_before INTEGER DEFAULT 30,
    created_at          INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_cc_facility ON ops_compliance_calendar(facility_number);
  CREATE INDEX IF NOT EXISTS idx_ops_cc_due_date ON ops_compliance_calendar(due_date);
  CREATE INDEX IF NOT EXISTS idx_ops_cc_status   ON ops_compliance_calendar(status);
`;

// ─────────────────────────────────────────────────────────────────────────────
// Drizzle table definitions
// ─────────────────────────────────────────────────────────────────────────────

// ── Module 1: Residents / EHR ─────────────────────────────────────────────

export const opsResidents = sqliteTable("ops_residents", {
  id:                       integer("id").primaryKey({ autoIncrement: true }),
  facilityNumber:           text("facility_number").notNull(),
  firstName:                text("first_name").notNull(),
  lastName:                 text("last_name").notNull(),
  dob:                      integer("dob"),
  gender:                   text("gender"),
  ssnLast4:                 text("ssn_last4"),
  admissionDate:            integer("admission_date"),
  dischargeDate:            integer("discharge_date"),
  roomNumber:               text("room_number"),
  bedNumber:                text("bed_number"),
  primaryDx:                text("primary_dx"),
  secondaryDx:              text("secondary_dx"),
  levelOfCare:              text("level_of_care"),
  emergencyContactName:     text("emergency_contact_name"),
  emergencyContactPhone:    text("emergency_contact_phone"),
  emergencyContactRelation: text("emergency_contact_relation"),
  fundingSource:            text("funding_source"),
  regionalCenterId:         text("regional_center_id"),
  status:                   text("status").notNull().default("active"),
  createdAt:                integer("created_at").notNull(),
  updatedAt:                integer("updated_at").notNull(),
});

export const opsResidentAssessments = sqliteTable("ops_resident_assessments", {
  id:                 integer("id").primaryKey({ autoIncrement: true }),
  residentId:         integer("resident_id").notNull(),
  facilityNumber:     text("facility_number").notNull(),
  assessmentType:     text("assessment_type").notNull(),
  assessedBy:         text("assessed_by").notNull(),
  assessedAt:         integer("assessed_at").notNull(),
  bathing:            integer("bathing").default(0),
  dressing:           integer("dressing").default(0),
  grooming:           integer("grooming").default(0),
  toileting:          integer("toileting").default(0),
  continence:         integer("continence").default(0),
  eating:             integer("eating").default(0),
  mobility:           integer("mobility").default(0),
  transfers:          integer("transfers").default(0),
  mealPrep:           integer("meal_prep").default(0),
  housekeeping:       integer("housekeeping").default(0),
  laundry:            integer("laundry").default(0),
  transportation:     integer("transportation").default(0),
  finances:           integer("finances").default(0),
  communication:      integer("communication").default(0),
  cognitionScore:     integer("cognition_score"),
  behaviorNotes:      text("behavior_notes"),
  fallRiskLevel:      text("fall_risk_level"),
  vision:             text("vision"),
  hearing:            text("hearing"),
  speech:             text("speech"),
  ambulation:         text("ambulation"),
  selfAdministerMeds: integer("self_administer_meds").default(0),
  nextDueDate:        integer("next_due_date"),
  licFormNumber:      text("lic_form_number"),
  rawJson:            text("raw_json"),
  createdAt:          integer("created_at").notNull(),
});

export const opsCarePlans = sqliteTable("ops_care_plans", {
  id:                        integer("id").primaryKey({ autoIncrement: true }),
  residentId:                integer("resident_id").notNull(),
  facilityNumber:            text("facility_number").notNull(),
  createdBy:                 text("created_by").notNull(),
  effectiveDate:             integer("effective_date").notNull(),
  reviewDate:                integer("review_date").notNull(),
  goal:                      text("goal").notNull(),
  intervention:              text("intervention").notNull(),
  frequency:                 text("frequency").notNull(),
  responsibleStaff:          text("responsible_staff"),
  digitalSignatureResident:  text("digital_signature_resident"),
  digitalSignatureFamily:    text("digital_signature_family"),
  signatureDate:             integer("signature_date"),
  status:                    text("status").notNull().default("draft"),
  createdAt:                 integer("created_at").notNull(),
  updatedAt:                 integer("updated_at").notNull(),
});

export const opsDailyTasks = sqliteTable("ops_daily_tasks", {
  id:              integer("id").primaryKey({ autoIncrement: true }),
  carePlanId:      integer("care_plan_id").notNull(),
  residentId:      integer("resident_id").notNull(),
  facilityNumber:  text("facility_number").notNull(),
  taskName:        text("task_name").notNull(),
  taskType:        text("task_type").notNull(),
  scheduledTime:   text("scheduled_time"),
  shift:           text("shift"),
  assignedTo:      text("assigned_to"),
  status:          text("status").notNull().default("pending"),
  completedAt:     integer("completed_at"),
  completionNotes: text("completion_notes"),
  refused:         integer("refused").default(0),
  refuseReason:    text("refuse_reason"),
  taskDate:        integer("task_date").notNull(),
  createdAt:       integer("created_at").notNull(),
});

// ── Module 2: eMAR ────────────────────────────────────────────────────────

export const opsMedications = sqliteTable("ops_medications", {
  id:                    integer("id").primaryKey({ autoIncrement: true }),
  residentId:            integer("resident_id").notNull(),
  facilityNumber:        text("facility_number").notNull(),
  drugName:              text("drug_name").notNull(),
  genericName:           text("generic_name"),
  dosage:                text("dosage").notNull(),
  route:                 text("route").notNull(),
  frequency:             text("frequency").notNull(),
  scheduledTimes:        text("scheduled_times"),
  prescriberName:        text("prescriber_name"),
  prescriberNpi:         text("prescriber_npi"),
  rxNumber:              text("rx_number"),
  pharmacyName:          text("pharmacy_name"),
  startDate:             integer("start_date"),
  endDate:               integer("end_date"),
  isPrn:                 integer("is_prn").default(0),
  prnIndication:         text("prn_indication"),
  isControlled:          integer("is_controlled").default(0),
  isPsychotropic:        integer("is_psychotropic").default(0),
  isHazardous:           integer("is_hazardous").default(0),
  classification:        text("classification"),
  requiresVitalsBefore:  integer("requires_vitals_before").default(0),
  vitalType:             text("vital_type"),
  refillThresholdDays:   integer("refill_threshold_days").default(7),
  autoRefillRequest:     integer("auto_refill_request").default(0),
  status:                text("status").notNull().default("active"),
  discontinuedReason:    text("discontinued_reason"),
  discontinuedBy:        text("discontinued_by"),
  discontinuedAt:        integer("discontinued_at"),
  createdAt:             integer("created_at").notNull(),
  updatedAt:             integer("updated_at").notNull(),
});

export const opsMedPasses = sqliteTable("ops_med_passes", {
  id:                        integer("id").primaryKey({ autoIncrement: true }),
  medicationId:              integer("medication_id").notNull(),
  residentId:                integer("resident_id").notNull(),
  facilityNumber:            text("facility_number").notNull(),
  scheduledDatetime:         integer("scheduled_datetime").notNull(),
  administeredDatetime:      integer("administered_datetime"),
  administeredBy:            text("administered_by"),
  witnessBy:                 text("witness_by"),
  rightResident:             integer("right_resident").default(0),
  rightMedication:           integer("right_medication").default(0),
  rightDose:                 integer("right_dose").default(0),
  rightRoute:                integer("right_route").default(0),
  rightTime:                 integer("right_time").default(0),
  rightReason:               integer("right_reason").default(0),
  rightDocumentation:        integer("right_documentation").default(0),
  rightToRefuse:             integer("right_to_refuse").default(0),
  status:                    text("status").notNull().default("pending"),
  refusalReason:             text("refusal_reason"),
  holdReason:                text("hold_reason"),
  notes:                     text("notes"),
  preVitalsBp:               text("pre_vitals_bp"),
  preVitalsPulse:            integer("pre_vitals_pulse"),
  preVitalsTemp:             real("pre_vitals_temp"),
  preVitalsSpo2:             integer("pre_vitals_spo2"),
  prnReason:                 text("prn_reason"),
  prnEffectivenessNotedAt:   integer("prn_effectiveness_noted_at"),
  prnEffectivenessNotes:     text("prn_effectiveness_notes"),
  createdAt:                 integer("created_at").notNull(),
});

export const opsControlledSubCounts = sqliteTable("ops_controlled_sub_counts", {
  id:                integer("id").primaryKey({ autoIncrement: true }),
  medicationId:      integer("medication_id").notNull(),
  facilityNumber:    text("facility_number").notNull(),
  countDate:         integer("count_date").notNull(),
  shift:             text("shift").notNull(),
  countedBy:         text("counted_by").notNull(),
  witnessedBy:       text("witnessed_by").notNull(),
  openingCount:      integer("opening_count").notNull(),
  closingCount:      integer("closing_count").notNull(),
  administeredCount: integer("administered_count").notNull().default(0),
  wastedCount:       integer("wasted_count").notNull().default(0),
  discrepancy:       integer("discrepancy").default(0),
  discrepancyNotes:  text("discrepancy_notes"),
  resolved:          integer("resolved").default(0),
  createdAt:         integer("created_at").notNull(),
});

export const opsMedDestruction = sqliteTable("ops_med_destruction", {
  id:                integer("id").primaryKey({ autoIncrement: true }),
  medicationId:      integer("medication_id").notNull(),
  facilityNumber:    text("facility_number").notNull(),
  quantity:          integer("quantity").notNull(),
  unit:              text("unit").notNull(),
  destructionMethod: text("destruction_method").notNull(),
  destroyedBy:       text("destroyed_by").notNull(),
  witnessedBy:       text("witnessed_by").notNull(),
  destructionDate:   integer("destruction_date").notNull(),
  reason:            text("reason").notNull(),
  createdAt:         integer("created_at").notNull(),
});

// ── Module 3: Incidents ───────────────────────────────────────────────────

export const opsIncidents = sqliteTable("ops_incidents", {
  id:                     integer("id").primaryKey({ autoIncrement: true }),
  facilityNumber:         text("facility_number").notNull(),
  residentId:             integer("resident_id"),
  incidentType:           text("incident_type").notNull(),
  incidentDate:           integer("incident_date").notNull(),
  incidentTime:           text("incident_time"),
  location:               text("location"),
  description:            text("description").notNull(),
  immediateActionTaken:   text("immediate_action_taken"),
  injuryInvolved:         integer("injury_involved").default(0),
  injuryDescription:      text("injury_description"),
  hospitalizationRequired:integer("hospitalization_required").default(0),
  hospitalName:           text("hospital_name"),
  reportedBy:             text("reported_by").notNull(),
  supervisorNotified:     integer("supervisor_notified").default(0),
  supervisorNotifiedAt:   integer("supervisor_notified_at"),
  familyNotified:         integer("family_notified").default(0),
  familyNotifiedAt:       integer("family_notified_at"),
  physicianNotified:      integer("physician_notified").default(0),
  physicianNotifiedAt:    integer("physician_notified_at"),
  lic624Required:         integer("lic_624_required").default(0),
  lic624Submitted:        integer("lic_624_submitted").default(0),
  lic624SubmittedAt:      integer("lic_624_submitted_at"),
  soc341Required:         integer("soc_341_required").default(0),
  soc341Submitted:        integer("soc_341_submitted").default(0),
  rootCause:              text("root_cause"),
  correctiveAction:       text("corrective_action"),
  followUpDate:           integer("follow_up_date"),
  followUpCompleted:      integer("follow_up_completed").default(0),
  status:                 text("status").notNull().default("open"),
  createdAt:              integer("created_at").notNull(),
  updatedAt:              integer("updated_at").notNull(),
});

// ── Module 4: CRM / Admissions ────────────────────────────────────────────

export const opsLeads = sqliteTable("ops_leads", {
  id:                integer("id").primaryKey({ autoIncrement: true }),
  facilityNumber:    text("facility_number").notNull(),
  contactName:       text("contact_name").notNull(),
  contactPhone:      text("contact_phone"),
  contactEmail:      text("contact_email"),
  contactRelation:   text("contact_relation"),
  prospectName:      text("prospect_name").notNull(),
  prospectDob:       integer("prospect_dob"),
  prospectGender:    text("prospect_gender"),
  careNeedsSummary:  text("care_needs_summary"),
  fundingSource:     text("funding_source"),
  desiredMoveInDate: integer("desired_move_in_date"),
  referralSource:    text("referral_source"),
  assignedTo:        text("assigned_to"),
  stage:             text("stage").notNull().default("inquiry"),
  lostReason:        text("lost_reason"),
  notes:             text("notes"),
  lastContactDate:   integer("last_contact_date"),
  nextFollowUpDate:  integer("next_follow_up_date"),
  createdAt:         integer("created_at").notNull(),
  updatedAt:         integer("updated_at").notNull(),
});

export const opsTours = sqliteTable("ops_tours", {
  id:             integer("id").primaryKey({ autoIncrement: true }),
  leadId:         integer("lead_id").notNull(),
  facilityNumber: text("facility_number").notNull(),
  scheduledAt:    integer("scheduled_at").notNull(),
  completedAt:    integer("completed_at"),
  conductedBy:    text("conducted_by"),
  outcome:        text("outcome"),
  notes:          text("notes"),
  followUpAction: text("follow_up_action"),
  createdAt:      integer("created_at").notNull(),
});

export const opsAdmissions = sqliteTable("ops_admissions", {
  id:                         integer("id").primaryKey({ autoIncrement: true }),
  leadId:                     integer("lead_id").notNull(),
  facilityNumber:             text("facility_number").notNull(),
  residentId:                 integer("resident_id"),
  lic601Completed:            integer("lic_601_completed").default(0),
  lic601Date:                 integer("lic_601_date"),
  lic602aCompleted:           integer("lic_602a_completed").default(0),
  lic602aDate:                integer("lic_602a_date"),
  lic603Completed:            integer("lic_603_completed").default(0),
  lic603Date:                 integer("lic_603_date"),
  lic604aCompleted:           integer("lic_604a_completed").default(0),
  lic604aDate:                integer("lic_604a_date"),
  lic605aCompleted:           integer("lic_605a_completed").default(0),
  lic605aDate:                integer("lic_605a_date"),
  lic610dCompleted:           integer("lic_610d_completed").default(0),
  lic610dDate:                integer("lic_610d_date"),
  admissionAgreementSigned:   integer("admission_agreement_signed").default(0),
  admissionAgreementSignedAt: integer("admission_agreement_signed_at"),
  admissionAgreementSignedBy: text("admission_agreement_signed_by"),
  physicianReportReceived:    integer("physician_report_received").default(0),
  tbTestResultsReceived:      integer("tb_test_results_received").default(0),
  moveInDate:                 integer("move_in_date"),
  moveInCompleted:            integer("move_in_completed").default(0),
  assignedRoom:               text("assigned_room"),
  welcomeCompleted:           integer("welcome_completed").default(0),
  notes:                      text("notes"),
  createdAt:                  integer("created_at").notNull(),
  updatedAt:                  integer("updated_at").notNull(),
});

// ── Module 5: Billing ─────────────────────────────────────────────────────

export const opsBillingCharges = sqliteTable("ops_billing_charges", {
  id:                 integer("id").primaryKey({ autoIncrement: true }),
  facilityNumber:     text("facility_number").notNull(),
  residentId:         integer("resident_id").notNull(),
  chargeType:         text("charge_type").notNull(),
  description:        text("description").notNull(),
  amount:             real("amount").notNull(),
  unit:               text("unit"),
  quantity:           real("quantity").notNull().default(1),
  billingPeriodStart: integer("billing_period_start"),
  billingPeriodEnd:   integer("billing_period_end"),
  isRecurring:        integer("is_recurring").default(0),
  recurrenceInterval: text("recurrence_interval"),
  prorated:           integer("prorated").default(0),
  prorateFrom:        integer("prorate_from"),
  prorateTo:          integer("prorate_to"),
  source:             text("source").notNull().default("manual"),
  clinicalRefId:      integer("clinical_ref_id"),
  createdAt:          integer("created_at").notNull(),
});

export const opsInvoices = sqliteTable("ops_invoices", {
  id:                 integer("id").primaryKey({ autoIncrement: true }),
  facilityNumber:     text("facility_number").notNull(),
  residentId:         integer("resident_id").notNull(),
  invoiceNumber:      text("invoice_number").notNull().unique(),
  billingPeriodStart: integer("billing_period_start").notNull(),
  billingPeriodEnd:   integer("billing_period_end").notNull(),
  subtotal:           real("subtotal").notNull().default(0),
  tax:                real("tax").notNull().default(0),
  total:              real("total").notNull().default(0),
  amountPaid:         real("amount_paid").notNull().default(0),
  balanceDue:         real("balance_due").notNull().default(0),
  status:             text("status").notNull().default("draft"),
  dueDate:            integer("due_date"),
  sentAt:             integer("sent_at"),
  paidAt:             integer("paid_at"),
  paymentMethod:      text("payment_method"),
  paymentReference:   text("payment_reference"),
  notes:              text("notes"),
  createdAt:          integer("created_at").notNull(),
  updatedAt:          integer("updated_at").notNull(),
});

export const opsPayments = sqliteTable("ops_payments", {
  id:              integer("id").primaryKey({ autoIncrement: true }),
  invoiceId:       integer("invoice_id").notNull(),
  facilityNumber:  text("facility_number").notNull(),
  residentId:      integer("resident_id").notNull(),
  amount:          real("amount").notNull(),
  paymentDate:     integer("payment_date").notNull(),
  paymentMethod:   text("payment_method").notNull(),
  referenceNumber: text("reference_number"),
  type:            text("type").notNull().default("payment"),
  notes:           text("notes"),
  recordedBy:      text("recorded_by"),
  createdAt:       integer("created_at").notNull(),
});

// ── Module 6: Staff / Scheduling ──────────────────────────────────────────

export const opsStaff = sqliteTable("ops_staff", {
  id:              integer("id").primaryKey({ autoIncrement: true }),
  facilityNumber:  text("facility_number").notNull(),
  firstName:       text("first_name").notNull(),
  lastName:        text("last_name").notNull(),
  email:           text("email"),
  phone:           text("phone"),
  role:            text("role").notNull(),
  hireDate:        integer("hire_date"),
  terminationDate: integer("termination_date"),
  licenseNumber:   text("license_number"),
  licenseExpiry:   integer("license_expiry"),
  status:          text("status").notNull().default("active"),
  createdAt:       integer("created_at").notNull(),
  updatedAt:       integer("updated_at").notNull(),
});

export const opsShifts = sqliteTable("ops_shifts", {
  id:             integer("id").primaryKey({ autoIncrement: true }),
  facilityNumber: text("facility_number").notNull(),
  staffId:        integer("staff_id").notNull(),
  shiftDate:      integer("shift_date").notNull(),
  shiftType:      text("shift_type").notNull(),
  startTime:      text("start_time").notNull(),
  endTime:        text("end_time").notNull(),
  isOvertime:     integer("is_overtime").default(0),
  status:         text("status").notNull().default("scheduled"),
  coveredById:    integer("covered_by_id"),
  notes:          text("notes"),
  createdAt:      integer("created_at").notNull(),
});

export const opsFacilitySettings = sqliteTable("ops_facility_settings", {
  id:             integer("id").primaryKey({ autoIncrement: true }),
  facilityNumber: text("facility_number").notNull(),
  settingKey:     text("setting_key").notNull(),
  settingValue:   text("setting_value"),
  updatedAt:      integer("updated_at").notNull(),
});

export const opsComplianceCalendar = sqliteTable("ops_compliance_calendar", {
  id:                integer("id").primaryKey({ autoIncrement: true }),
  facilityNumber:    text("facility_number").notNull(),
  itemType:          text("item_type").notNull(),
  description:       text("description").notNull(),
  dueDate:           integer("due_date").notNull(),
  completedDate:     integer("completed_date"),
  assignedTo:        text("assigned_to"),
  status:            text("status").notNull().default("pending"),
  reminderDaysBefore:integer("reminder_days_before").default(30),
  createdAt:         integer("created_at").notNull(),
});

// ─────────────────────────────────────────────────────────────────────────────
// PostgreSQL DDL — created at startup via bootstrapOpsSchema() in opsStorage.ts
// ─────────────────────────────────────────────────────────────────────────────

export const OPS_PG_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS ops_residents (
    id                        BIGSERIAL PRIMARY KEY,
    facility_number           TEXT NOT NULL,
    first_name                TEXT NOT NULL,
    last_name                 TEXT NOT NULL,
    dob                       BIGINT,
    gender                    TEXT,
    ssn_last4                 TEXT,
    admission_date            BIGINT,
    discharge_date            BIGINT,
    room_number               TEXT,
    bed_number                TEXT,
    primary_dx                TEXT,
    secondary_dx              TEXT,
    level_of_care             TEXT,
    emergency_contact_name    TEXT,
    emergency_contact_phone   TEXT,
    emergency_contact_relation TEXT,
    funding_source            TEXT,
    regional_center_id        TEXT,
    status                    TEXT NOT NULL DEFAULT 'active',
    created_at                BIGINT NOT NULL,
    updated_at                BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_residents_facility ON ops_residents(facility_number);
  CREATE INDEX IF NOT EXISTS idx_ops_residents_status   ON ops_residents(status);
  CREATE INDEX IF NOT EXISTS idx_ops_residents_adm_date ON ops_residents(admission_date);

  CREATE TABLE IF NOT EXISTS ops_resident_assessments (
    id                    BIGSERIAL PRIMARY KEY,
    resident_id           BIGINT NOT NULL,
    facility_number       TEXT NOT NULL,
    assessment_type       TEXT NOT NULL,
    assessed_by           TEXT NOT NULL,
    assessed_at           BIGINT NOT NULL,
    bathing               INTEGER DEFAULT 0,
    dressing              INTEGER DEFAULT 0,
    grooming              INTEGER DEFAULT 0,
    toileting             INTEGER DEFAULT 0,
    continence            INTEGER DEFAULT 0,
    eating                INTEGER DEFAULT 0,
    mobility              INTEGER DEFAULT 0,
    transfers             INTEGER DEFAULT 0,
    meal_prep             INTEGER DEFAULT 0,
    housekeeping          INTEGER DEFAULT 0,
    laundry               INTEGER DEFAULT 0,
    transportation        INTEGER DEFAULT 0,
    finances              INTEGER DEFAULT 0,
    communication         INTEGER DEFAULT 0,
    cognition_score       INTEGER,
    behavior_notes        TEXT,
    fall_risk_level       TEXT,
    vision                TEXT,
    hearing               TEXT,
    speech                TEXT,
    ambulation            TEXT,
    self_administer_meds  INTEGER DEFAULT 0,
    next_due_date         BIGINT,
    lic_form_number       TEXT,
    raw_json              TEXT,
    created_at            BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_ra_resident   ON ops_resident_assessments(resident_id);
  CREATE INDEX IF NOT EXISTS idx_ops_ra_facility   ON ops_resident_assessments(facility_number);
  CREATE INDEX IF NOT EXISTS idx_ops_ra_assessed   ON ops_resident_assessments(assessed_at);

  CREATE TABLE IF NOT EXISTS ops_care_plans (
    id                         BIGSERIAL PRIMARY KEY,
    resident_id                BIGINT NOT NULL,
    facility_number            TEXT NOT NULL,
    created_by                 TEXT NOT NULL,
    effective_date             BIGINT NOT NULL,
    review_date                BIGINT NOT NULL,
    goal                       TEXT NOT NULL,
    intervention               TEXT NOT NULL,
    frequency                  TEXT NOT NULL,
    responsible_staff          TEXT,
    digital_signature_resident TEXT,
    digital_signature_family   TEXT,
    signature_date             BIGINT,
    status                     TEXT NOT NULL DEFAULT 'draft',
    created_at                 BIGINT NOT NULL,
    updated_at                 BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_cp_resident ON ops_care_plans(resident_id);
  CREATE INDEX IF NOT EXISTS idx_ops_cp_status   ON ops_care_plans(status);

  CREATE TABLE IF NOT EXISTS ops_daily_tasks (
    id               BIGSERIAL PRIMARY KEY,
    care_plan_id     BIGINT NOT NULL,
    resident_id      BIGINT NOT NULL,
    facility_number  TEXT NOT NULL,
    task_name        TEXT NOT NULL,
    task_type        TEXT NOT NULL,
    scheduled_time   TEXT,
    shift            TEXT,
    assigned_to      TEXT,
    status           TEXT NOT NULL DEFAULT 'pending',
    completed_at     BIGINT,
    completion_notes TEXT,
    refused          INTEGER DEFAULT 0,
    refuse_reason    TEXT,
    task_date        BIGINT NOT NULL,
    created_at       BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_dt_resident  ON ops_daily_tasks(resident_id);
  CREATE INDEX IF NOT EXISTS idx_ops_dt_task_date ON ops_daily_tasks(task_date);
  CREATE INDEX IF NOT EXISTS idx_ops_dt_status    ON ops_daily_tasks(status);

  CREATE TABLE IF NOT EXISTS ops_medications (
    id                       BIGSERIAL PRIMARY KEY,
    resident_id              BIGINT NOT NULL,
    facility_number          TEXT NOT NULL,
    drug_name                TEXT NOT NULL,
    generic_name             TEXT,
    dosage                   TEXT NOT NULL,
    route                    TEXT NOT NULL,
    frequency                TEXT NOT NULL,
    scheduled_times          TEXT,
    prescriber_name          TEXT,
    prescriber_npi           TEXT,
    rx_number                TEXT,
    pharmacy_name            TEXT,
    start_date               BIGINT,
    end_date                 BIGINT,
    is_prn                   INTEGER DEFAULT 0,
    prn_indication           TEXT,
    is_controlled            INTEGER DEFAULT 0,
    is_psychotropic          INTEGER DEFAULT 0,
    is_hazardous             INTEGER DEFAULT 0,
    classification           TEXT,
    requires_vitals_before   INTEGER DEFAULT 0,
    vital_type               TEXT,
    refill_threshold_days    INTEGER DEFAULT 7,
    auto_refill_request      INTEGER DEFAULT 0,
    status                   TEXT NOT NULL DEFAULT 'active',
    discontinued_reason      TEXT,
    discontinued_by          TEXT,
    discontinued_at          BIGINT,
    created_at               BIGINT NOT NULL,
    updated_at               BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_med_resident ON ops_medications(resident_id);
  CREATE INDEX IF NOT EXISTS idx_ops_med_facility ON ops_medications(facility_number);
  CREATE INDEX IF NOT EXISTS idx_ops_med_status   ON ops_medications(status);

  CREATE TABLE IF NOT EXISTS ops_med_passes (
    id                          BIGSERIAL PRIMARY KEY,
    medication_id               BIGINT NOT NULL,
    resident_id                 BIGINT NOT NULL,
    facility_number             TEXT NOT NULL,
    scheduled_datetime          BIGINT NOT NULL,
    administered_datetime       BIGINT,
    administered_by             TEXT,
    witness_by                  TEXT,
    right_resident              INTEGER DEFAULT 0,
    right_medication            INTEGER DEFAULT 0,
    right_dose                  INTEGER DEFAULT 0,
    right_route                 INTEGER DEFAULT 0,
    right_time                  INTEGER DEFAULT 0,
    right_reason                INTEGER DEFAULT 0,
    right_documentation         INTEGER DEFAULT 0,
    right_to_refuse             INTEGER DEFAULT 0,
    status                      TEXT NOT NULL DEFAULT 'pending',
    refusal_reason              TEXT,
    hold_reason                 TEXT,
    notes                       TEXT,
    pre_vitals_bp               TEXT,
    pre_vitals_pulse            INTEGER,
    pre_vitals_temp             DOUBLE PRECISION,
    pre_vitals_spo2             INTEGER,
    prn_reason                  TEXT,
    prn_effectiveness_noted_at  BIGINT,
    prn_effectiveness_notes     TEXT,
    created_at                  BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_mp_medication ON ops_med_passes(medication_id);
  CREATE INDEX IF NOT EXISTS idx_ops_mp_resident   ON ops_med_passes(resident_id);
  CREATE INDEX IF NOT EXISTS idx_ops_mp_scheduled  ON ops_med_passes(scheduled_datetime);
  CREATE INDEX IF NOT EXISTS idx_ops_mp_status     ON ops_med_passes(status);

  CREATE TABLE IF NOT EXISTS ops_controlled_sub_counts (
    id                 BIGSERIAL PRIMARY KEY,
    medication_id      BIGINT NOT NULL,
    facility_number    TEXT NOT NULL,
    count_date         BIGINT NOT NULL,
    shift              TEXT NOT NULL,
    counted_by         TEXT NOT NULL,
    witnessed_by       TEXT NOT NULL,
    opening_count      INTEGER NOT NULL,
    closing_count      INTEGER NOT NULL,
    administered_count INTEGER NOT NULL DEFAULT 0,
    wasted_count       INTEGER NOT NULL DEFAULT 0,
    discrepancy        INTEGER DEFAULT 0,
    discrepancy_notes  TEXT,
    resolved           INTEGER DEFAULT 0,
    created_at         BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_csc_medication  ON ops_controlled_sub_counts(medication_id);
  CREATE INDEX IF NOT EXISTS idx_ops_csc_count_date  ON ops_controlled_sub_counts(count_date);

  CREATE TABLE IF NOT EXISTS ops_med_destruction (
    id                 BIGSERIAL PRIMARY KEY,
    medication_id      BIGINT NOT NULL,
    facility_number    TEXT NOT NULL,
    quantity           INTEGER NOT NULL,
    unit               TEXT NOT NULL,
    destruction_method TEXT NOT NULL,
    destroyed_by       TEXT NOT NULL,
    witnessed_by       TEXT NOT NULL,
    destruction_date   BIGINT NOT NULL,
    reason             TEXT NOT NULL,
    created_at         BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ops_incidents (
    id                       BIGSERIAL PRIMARY KEY,
    facility_number          TEXT NOT NULL,
    resident_id              BIGINT,
    incident_type            TEXT NOT NULL,
    incident_date            BIGINT NOT NULL,
    incident_time            TEXT,
    location                 TEXT,
    description              TEXT NOT NULL,
    immediate_action_taken   TEXT,
    injury_involved          INTEGER DEFAULT 0,
    injury_description       TEXT,
    hospitalization_required INTEGER DEFAULT 0,
    hospital_name            TEXT,
    reported_by              TEXT NOT NULL,
    supervisor_notified      INTEGER DEFAULT 0,
    supervisor_notified_at   BIGINT,
    family_notified          INTEGER DEFAULT 0,
    family_notified_at       BIGINT,
    physician_notified       INTEGER DEFAULT 0,
    physician_notified_at    BIGINT,
    lic_624_required         INTEGER DEFAULT 0,
    lic_624_submitted        INTEGER DEFAULT 0,
    lic_624_submitted_at     BIGINT,
    soc_341_required         INTEGER DEFAULT 0,
    soc_341_submitted        INTEGER DEFAULT 0,
    root_cause               TEXT,
    corrective_action        TEXT,
    follow_up_date           BIGINT,
    follow_up_completed      INTEGER DEFAULT 0,
    status                   TEXT NOT NULL DEFAULT 'open',
    created_at               BIGINT NOT NULL,
    updated_at               BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_inc_facility      ON ops_incidents(facility_number);
  CREATE INDEX IF NOT EXISTS idx_ops_inc_resident      ON ops_incidents(resident_id);
  CREATE INDEX IF NOT EXISTS idx_ops_inc_incident_date ON ops_incidents(incident_date);
  CREATE INDEX IF NOT EXISTS idx_ops_inc_status        ON ops_incidents(status);

  CREATE TABLE IF NOT EXISTS ops_leads (
    id                   BIGSERIAL PRIMARY KEY,
    facility_number      TEXT NOT NULL,
    contact_name         TEXT NOT NULL,
    contact_phone        TEXT,
    contact_email        TEXT,
    contact_relation     TEXT,
    prospect_name        TEXT NOT NULL,
    prospect_dob         BIGINT,
    prospect_gender      TEXT,
    care_needs_summary   TEXT,
    funding_source       TEXT,
    desired_move_in_date BIGINT,
    referral_source      TEXT,
    assigned_to          TEXT,
    stage                TEXT NOT NULL DEFAULT 'inquiry',
    lost_reason          TEXT,
    notes                TEXT,
    last_contact_date    BIGINT,
    next_follow_up_date  BIGINT,
    created_at           BIGINT NOT NULL,
    updated_at           BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_leads_facility     ON ops_leads(facility_number);
  CREATE INDEX IF NOT EXISTS idx_ops_leads_stage        ON ops_leads(stage);
  CREATE INDEX IF NOT EXISTS idx_ops_leads_follow_up    ON ops_leads(next_follow_up_date);

  CREATE TABLE IF NOT EXISTS ops_tours (
    id               BIGSERIAL PRIMARY KEY,
    lead_id          BIGINT NOT NULL,
    facility_number  TEXT NOT NULL,
    scheduled_at     BIGINT NOT NULL,
    completed_at     BIGINT,
    conducted_by     TEXT,
    outcome          TEXT,
    notes            TEXT,
    follow_up_action TEXT,
    created_at       BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ops_admissions (
    id                             BIGSERIAL PRIMARY KEY,
    lead_id                        BIGINT NOT NULL,
    facility_number                TEXT NOT NULL,
    resident_id                    BIGINT,
    lic_601_completed              INTEGER DEFAULT 0,
    lic_601_date                   BIGINT,
    lic_602a_completed             INTEGER DEFAULT 0,
    lic_602a_date                  BIGINT,
    lic_603_completed              INTEGER DEFAULT 0,
    lic_603_date                   BIGINT,
    lic_604a_completed             INTEGER DEFAULT 0,
    lic_604a_date                  BIGINT,
    lic_605a_completed             INTEGER DEFAULT 0,
    lic_605a_date                  BIGINT,
    lic_610d_completed             INTEGER DEFAULT 0,
    lic_610d_date                  BIGINT,
    admission_agreement_signed     INTEGER DEFAULT 0,
    admission_agreement_signed_at  BIGINT,
    admission_agreement_signed_by  TEXT,
    physician_report_received      INTEGER DEFAULT 0,
    tb_test_results_received       INTEGER DEFAULT 0,
    move_in_date                   BIGINT,
    move_in_completed              INTEGER DEFAULT 0,
    assigned_room                  TEXT,
    welcome_completed              INTEGER DEFAULT 0,
    notes                          TEXT,
    created_at                     BIGINT NOT NULL,
    updated_at                     BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_adm_lead     ON ops_admissions(lead_id);
  CREATE INDEX IF NOT EXISTS idx_ops_adm_facility ON ops_admissions(facility_number);

  CREATE TABLE IF NOT EXISTS ops_billing_charges (
    id                   BIGSERIAL PRIMARY KEY,
    facility_number      TEXT NOT NULL,
    resident_id          BIGINT NOT NULL,
    charge_type          TEXT NOT NULL,
    description          TEXT NOT NULL,
    amount               DOUBLE PRECISION NOT NULL,
    unit                 TEXT,
    quantity             DOUBLE PRECISION NOT NULL DEFAULT 1,
    billing_period_start BIGINT,
    billing_period_end   BIGINT,
    is_recurring         INTEGER DEFAULT 0,
    recurrence_interval  TEXT,
    prorated             INTEGER DEFAULT 0,
    prorate_from         BIGINT,
    prorate_to           BIGINT,
    source               TEXT NOT NULL DEFAULT 'manual',
    clinical_ref_id      BIGINT,
    created_at           BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_bc_facility  ON ops_billing_charges(facility_number);
  CREATE INDEX IF NOT EXISTS idx_ops_bc_resident  ON ops_billing_charges(resident_id);

  CREATE TABLE IF NOT EXISTS ops_invoices (
    id                   BIGSERIAL PRIMARY KEY,
    facility_number      TEXT NOT NULL,
    resident_id          BIGINT NOT NULL,
    invoice_number       TEXT NOT NULL UNIQUE,
    billing_period_start BIGINT NOT NULL,
    billing_period_end   BIGINT NOT NULL,
    subtotal             DOUBLE PRECISION NOT NULL DEFAULT 0,
    tax                  DOUBLE PRECISION NOT NULL DEFAULT 0,
    total                DOUBLE PRECISION NOT NULL DEFAULT 0,
    amount_paid          DOUBLE PRECISION NOT NULL DEFAULT 0,
    balance_due          DOUBLE PRECISION NOT NULL DEFAULT 0,
    status               TEXT NOT NULL DEFAULT 'draft',
    due_date             BIGINT,
    sent_at              BIGINT,
    paid_at              BIGINT,
    payment_method       TEXT,
    payment_reference    TEXT,
    notes                TEXT,
    created_at           BIGINT NOT NULL,
    updated_at           BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_inv_facility ON ops_invoices(facility_number);
  CREATE INDEX IF NOT EXISTS idx_ops_inv_resident ON ops_invoices(resident_id);
  CREATE INDEX IF NOT EXISTS idx_ops_inv_status   ON ops_invoices(status);
  CREATE INDEX IF NOT EXISTS idx_ops_inv_due_date ON ops_invoices(due_date);

  CREATE TABLE IF NOT EXISTS ops_payments (
    id               BIGSERIAL PRIMARY KEY,
    invoice_id       BIGINT NOT NULL,
    facility_number  TEXT NOT NULL,
    resident_id      BIGINT NOT NULL,
    amount           DOUBLE PRECISION NOT NULL,
    payment_date     BIGINT NOT NULL,
    payment_method   TEXT NOT NULL,
    reference_number TEXT,
    type             TEXT NOT NULL DEFAULT 'payment',
    notes            TEXT,
    recorded_by      TEXT,
    created_at       BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_pay_invoice ON ops_payments(invoice_id);

  CREATE TABLE IF NOT EXISTS ops_staff (
    id               BIGSERIAL PRIMARY KEY,
    facility_number  TEXT NOT NULL,
    first_name       TEXT NOT NULL,
    last_name        TEXT NOT NULL,
    email            TEXT,
    phone            TEXT,
    role             TEXT NOT NULL,
    hire_date        BIGINT,
    termination_date BIGINT,
    license_number   TEXT,
    license_expiry   BIGINT,
    status           TEXT NOT NULL DEFAULT 'active',
    created_at       BIGINT NOT NULL,
    updated_at       BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_staff_facility ON ops_staff(facility_number);
  CREATE INDEX IF NOT EXISTS idx_ops_staff_status   ON ops_staff(status);

  CREATE TABLE IF NOT EXISTS ops_shifts (
    id               BIGSERIAL PRIMARY KEY,
    facility_number  TEXT NOT NULL,
    staff_id         BIGINT NOT NULL,
    shift_date       BIGINT NOT NULL,
    shift_type       TEXT NOT NULL,
    start_time       TEXT NOT NULL,
    end_time         TEXT NOT NULL,
    is_overtime      INTEGER DEFAULT 0,
    status           TEXT NOT NULL DEFAULT 'scheduled',
    covered_by_id    BIGINT,
    notes            TEXT,
    created_at       BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_shifts_facility   ON ops_shifts(facility_number);
  CREATE INDEX IF NOT EXISTS idx_ops_shifts_staff      ON ops_shifts(staff_id);
  CREATE INDEX IF NOT EXISTS idx_ops_shifts_shift_date ON ops_shifts(shift_date);

  CREATE TABLE IF NOT EXISTS ops_facility_settings (
    id              BIGSERIAL PRIMARY KEY,
    facility_number TEXT NOT NULL,
    setting_key     TEXT NOT NULL,
    setting_value   TEXT,
    updated_at      BIGINT NOT NULL,
    UNIQUE(facility_number, setting_key)
  );

  CREATE TABLE IF NOT EXISTS ops_compliance_calendar (
    id                   BIGSERIAL PRIMARY KEY,
    facility_number      TEXT NOT NULL,
    item_type            TEXT NOT NULL,
    description          TEXT NOT NULL,
    due_date             BIGINT NOT NULL,
    completed_date       BIGINT,
    assigned_to          TEXT,
    status               TEXT NOT NULL DEFAULT 'pending',
    reminder_days_before INTEGER DEFAULT 30,
    created_at           BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_cc_facility ON ops_compliance_calendar(facility_number);
  CREATE INDEX IF NOT EXISTS idx_ops_cc_due_date ON ops_compliance_calendar(due_date);
  CREATE INDEX IF NOT EXISTS idx_ops_cc_status   ON ops_compliance_calendar(status);
`;

// ─────────────────────────────────────────────────────────────────────────────
// Inferred TypeScript types
// ─────────────────────────────────────────────────────────────────────────────

export type OpsResident             = typeof opsResidents.$inferSelect;
export type InsertOpsResident       = typeof opsResidents.$inferInsert;

export type OpsResidentAssessment   = typeof opsResidentAssessments.$inferSelect;
export type InsertOpsResidentAssessment = typeof opsResidentAssessments.$inferInsert;

export type OpsCarePlan             = typeof opsCarePlans.$inferSelect;
export type InsertOpsCarePlan       = typeof opsCarePlans.$inferInsert;

export type OpsDailyTask            = typeof opsDailyTasks.$inferSelect;
export type InsertOpsDailyTask      = typeof opsDailyTasks.$inferInsert;

export type OpsMedication           = typeof opsMedications.$inferSelect;
export type InsertOpsMedication     = typeof opsMedications.$inferInsert;

export type OpsMedPass              = typeof opsMedPasses.$inferSelect;
export type InsertOpsMedPass        = typeof opsMedPasses.$inferInsert;

export type OpsControlledSubCount   = typeof opsControlledSubCounts.$inferSelect;
export type InsertOpsControlledSubCount = typeof opsControlledSubCounts.$inferInsert;

export type OpsMedDestruction       = typeof opsMedDestruction.$inferSelect;
export type InsertOpsMedDestruction = typeof opsMedDestruction.$inferInsert;

export type OpsIncident             = typeof opsIncidents.$inferSelect;
export type InsertOpsIncident       = typeof opsIncidents.$inferInsert;

export type OpsLead                 = typeof opsLeads.$inferSelect;
export type InsertOpsLead           = typeof opsLeads.$inferInsert;

export type OpsTour                 = typeof opsTours.$inferSelect;
export type InsertOpsTour           = typeof opsTours.$inferInsert;

export type OpsAdmission            = typeof opsAdmissions.$inferSelect;
export type InsertOpsAdmission      = typeof opsAdmissions.$inferInsert;

export type OpsBillingCharge        = typeof opsBillingCharges.$inferSelect;
export type InsertOpsBillingCharge  = typeof opsBillingCharges.$inferInsert;

export type OpsInvoice              = typeof opsInvoices.$inferSelect;
export type InsertOpsInvoice        = typeof opsInvoices.$inferInsert;

export type OpsPayment              = typeof opsPayments.$inferSelect;
export type InsertOpsPayment        = typeof opsPayments.$inferInsert;

export type OpsStaffMember          = typeof opsStaff.$inferSelect;
export type InsertOpsStaffMember    = typeof opsStaff.$inferInsert;

export type OpsShift                = typeof opsShifts.$inferSelect;
export type InsertOpsShift          = typeof opsShifts.$inferInsert;

export type OpsFacilitySetting      = typeof opsFacilitySettings.$inferSelect;
export type InsertOpsFacilitySetting = typeof opsFacilitySettings.$inferInsert;

export type OpsComplianceItem       = typeof opsComplianceCalendar.$inferSelect;
export type InsertOpsComplianceItem = typeof opsComplianceCalendar.$inferInsert;
