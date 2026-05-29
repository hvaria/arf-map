/**
 * Wave 5 — Report generator registry.
 *
 * Each generator is a pure function: it reads from the existing storage
 * list functions (never goes to the DB directly), builds a byte payload
 * in the appropriate mime, and returns the bytes + metadata for the
 * Reports hub to persist via markReportReady().
 *
 * Six generators are implemented in this PR:
 *   - preaudit_pull           — wraps generatePreauditBundle, writes JSON
 *   - incident_summary        — listIncidents (windowed) → PDF
 *   - mar_export              — pool.query on ops_med_passes (windowed) → CSV
 *   - audit_trail             — listAuditForFacility (windowed) → CSV
 *   - monthly_trust_statement — generateMonthlyStatement → PDF
 *   - vendor_coi_matrix       — listVendors → CSV
 *
 * The remaining six (tracker_export, credentials_matrix, drill_log_export,
 * posting_verification_log, complaint_log, chart_completeness_snapshot)
 * throw a "Not implemented yet — coming in Wave 5+" so the FE can render
 * them in the kind picker but the generate path fails gracefully.
 *
 * Timeout handling is the responsibility of the caller (reportsRouter
 * wraps the generator call in a Promise.race). Generators throw on
 * malformed parameters or upstream storage failures; markReportFailed()
 * catches and writes failure_reason.
 */

import { pool } from "../db/index";
import {
  listIncidents,
  listVendors,
  listComplaints,
  listDrillLogs,
  listStaffCredentials,
} from "./opsStorage";
import { listChartCompleteness } from "./chartCompletenessStorage";
import { listPostingVerifications } from "./postingsStorage";
import { listEntries } from "../trackers/trackerStorage";
import { listAuditForFacility } from "./auditStorage";
import { generatePreauditBundle } from "./preauditPullsStorage";
import {
  generateMonthlyStatement,
  getTrustAccount,
} from "./residentTrustStorage";
import { getFacilityReportHeader } from "../trackers/reports/reportQueries";
import { renderPdf, drawPdfHeader, renderPreauditPullPdf } from "./reportPdf";
import {
  formatReportDate,
  formatStampDateTime,
  formatCsvDateTime,
  formatCsvDate,
  formatYesNoFlag,
  REPORT_TZ_LABEL,
} from "./reportFormat";
import type { ReportMimeType, ReportKind } from "@shared/reports";
import type { AuditActor } from "./auditStorage";
import type {
  PreauditPullSpec,
  PreauditSection,
} from "@shared/auditor";
import { PREAUDIT_SECTIONS } from "@shared/auditor";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface ReportGenerationContext {
  facilityNumber: string;
  generatedBy: string;
  actor: AuditActor;
  now: number;
}

export interface ReportGenerationResult {
  bytes: Buffer;
  mime: ReportMimeType;
  title: string;
  description?: string;
  parameters: Record<string, unknown>;
  sourceEntityType?: string;
  sourceEntityId?: number;
}

export type ReportGenerator = (
  ctx: ReportGenerationContext,
  params: Record<string, unknown>,
) => Promise<ReportGenerationResult>;

// ─────────────────────────────────────────────────────────────────────────────
// CSV helpers — straight string composition, no library needed.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Escape a single CSV cell per RFC 4180:
 *   - if the cell contains comma, quote, CR, or LF, wrap in double quotes
 *   - inside a quoted cell, double any internal quote
 *   - null / undefined render as empty
 */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  // Booleans always render as Yes/No so future boolean columns don't ship as
  // "true"/"false". 0/1 flag mapping needs the key context and stays in the
  // generator's row-build step.
  if (typeof v === "boolean") return v ? "Yes" : "No";
  const s = String(v);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(",");
}

function csvBytes(header: string[], rows: unknown[][]): Buffer {
  const lines = [csvRow(header), ...rows.map(csvRow)];
  // RFC 4180 prescribes CRLF; many spreadsheet apps accept LF. We pick CRLF
  // so Windows Excel opens the file without prompting for an import wizard.
  return Buffer.from(lines.join("\r\n") + "\r\n", "utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// Param helpers — every generator validates its own params and coerces
// to numbers/strings. We don't pull a Zod dep into the generator layer;
// each generator does the minimum check needed before reading storage.
// ─────────────────────────────────────────────────────────────────────────────

function readWindow(
  params: Record<string, unknown>,
): { windowStartAt: number; windowEndAt: number } {
  const start = Number(params.windowStartAt);
  const end = Number(params.windowEndAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error("windowStartAt and windowEndAt are required (ms)");
  }
  if (!(start < end)) {
    throw new Error("windowStartAt must be < windowEndAt");
  }
  return { windowStartAt: start, windowEndAt: end };
}


// ─────────────────────────────────────────────────────────────────────────────
// Generators — implemented
// ─────────────────────────────────────────────────────────────────────────────

/** preaudit_pull — human-readable PDF of every requested section. */
const preauditPullGenerator: ReportGenerator = async (ctx, params) => {
  const { windowStartAt, windowEndAt } = readWindow(params);
  const sectionsParam = Array.isArray(params.sections)
    ? (params.sections as unknown[]).filter((s): s is string => typeof s === "string")
    : PREAUDIT_SECTIONS.slice();
  const sections = sectionsParam.filter((s): s is PreauditSection =>
    (PREAUDIT_SECTIONS as readonly string[]).includes(s),
  );
  if (sections.length === 0) {
    throw new Error("at least one valid section is required");
  }
  const audience =
    typeof params.audience === "string" ? params.audience : "internal";
  const audienceLabel =
    typeof params.audienceLabel === "string" ? params.audienceLabel : undefined;

  const spec: PreauditPullSpec = {
    audience: audience as PreauditPullSpec["audience"],
    audienceLabel,
    windowStartAt,
    windowEndAt,
    sections,
    deliveryMethod: "download",
  };

  const { bundle, totals } = await generatePreauditBundle(
    ctx.facilityNumber,
    spec,
  );

  const bytes = await renderPreauditPullPdf({
    facilityNumber: ctx.facilityNumber,
    generatedAt: ctx.now,
    generatedBy: ctx.generatedBy,
    audience,
    audienceLabel,
    windowStartAt,
    windowEndAt,
    sections,
    totals,
    bundle,
  });

  return {
    bytes,
    mime: "application/pdf",
    title:
      typeof params.title === "string" && params.title
        ? params.title
        : `Pre-audit pull (${new Date(windowStartAt).toISOString().slice(0, 10)} → ${new Date(windowEndAt).toISOString().slice(0, 10)})`,
    description: `Pre-audit bundle for ${audience}; ${sections.length} section(s)`,
    parameters: {
      audience,
      windowStartAt,
      windowEndAt,
      sections,
    },
  };
};

/** incident_summary — PDF list of incidents in window. */
const incidentSummaryGenerator: ReportGenerator = async (ctx, params) => {
  const { windowStartAt, windowEndAt } = readWindow(params);

  // listIncidents has no window filter — pull a generous page and filter
  // in-memory, matching the preaudit incidents pattern. Hard cap at 5000
  // so a runaway query can't OOM the server.
  const { incidents } = await listIncidents(ctx.facilityNumber, {
    page: 1,
    limit: 5000,
  });
  const filtered = incidents.filter(
    (i) => i.incidentDate >= windowStartAt && i.incidentDate < windowEndAt,
  );

  const facility = await getFacilityReportHeader(ctx.facilityNumber).catch(
    () => null,
  );

  const footerLeft = facility
    ? `${facility.name} · License #${facility.number}`
    : undefined;

  const bytes = await renderPdf((doc) => {
    drawPdfHeader(doc, {
      title: "Incident summary",
      subtitle: `${filtered.length} incident${filtered.length === 1 ? "" : "s"}`,
      facility,
      generatedAt: ctx.now,
      generatedBy: ctx.generatedBy,
      reportPeriod: { startAt: windowStartAt, endAt: windowEndAt },
    });

    if (filtered.length === 0) {
      doc.fontSize(11).fillColor("#64748b").text(
        "No incidents recorded in this period.",
      );
      return;
    }

    doc.fontSize(10).fillColor("#0f172a");
    for (const inc of filtered) {
      doc
        .fontSize(11)
        .fillColor("#01696f")
        .text(
          `${formatReportDate(inc.incidentDate)}  ·  ${inc.incidentType}  ·  ${inc.status}`,
        );
      doc.fontSize(9).fillColor("#0f172a");
      if (inc.location) doc.text(`Location: ${inc.location}`);
      doc.text(`Reported by: ${inc.reportedBy}`);
      if (inc.eventSeverity) doc.text(`Severity: ${inc.eventSeverity}`);
      doc.text(`Description: ${inc.description}`, { width: 500 });
      if (inc.correctiveAction) {
        doc.text(`Corrective action: ${inc.correctiveAction}`, { width: 500 });
      }
      doc.moveDown(0.5);
    }
  }, { footerLeft });

  return {
    bytes,
    mime: "application/pdf",
    title:
      typeof params.title === "string" && params.title
        ? params.title
        : `Incident summary (${filtered.length} incident${filtered.length === 1 ? "" : "s"})`,
    description: `Incidents between ${formatReportDate(windowStartAt)} and ${formatReportDate(windowEndAt)}`,
    parameters: { windowStartAt, windowEndAt, rowCount: filtered.length },
  };
};

/** mar_export — CSV of med passes in window. */
const marExportGenerator: ReportGenerator = async (ctx, params) => {
  const { windowStartAt, windowEndAt } = readWindow(params);

  // Tight scoped SELECT joining medications + residents so the CSV is
  // useful without N+1 lookups. Capped at 100k rows — same protective
  // ceiling the pre-audit pull uses.
  const res = await pool.query<{
    id: number;
    scheduled_datetime: number;
    administered_datetime: number | null;
    administered_by: string | null;
    status: string;
    refusal_reason: string | null;
    hold_reason: string | null;
    notes: string | null;
    drug_name: string;
    dosage: string;
    route: string | null;
    prescriber_name: string | null;
    resident_first_name: string;
    resident_last_name: string;
    room_number: string | null;
  }>(
    `SELECT mp.id, mp.scheduled_datetime, mp.administered_datetime,
            mp.administered_by, mp.status, mp.refusal_reason,
            mp.hold_reason, mp.notes,
            m.drug_name, m.dosage, m.route, m.prescriber_name,
            r.first_name AS resident_first_name,
            r.last_name  AS resident_last_name,
            r.room_number
       FROM ops_med_passes mp
       JOIN ops_medications m ON mp.medication_id = m.id
       JOIN ops_residents   r ON mp.resident_id   = r.id
      WHERE mp.facility_number = $1
        AND mp.scheduled_datetime >= $2
        AND mp.scheduled_datetime <  $3
      ORDER BY mp.scheduled_datetime ASC
      LIMIT 100000`,
    [ctx.facilityNumber, windowStartAt, windowEndAt],
  );

  const header = [
    "ID",
    `Scheduled (${REPORT_TZ_LABEL})`,
    `Administered (${REPORT_TZ_LABEL})`,
    "Administered By",
    "Status",
    "Refusal Reason",
    "Hold Reason",
    "Medication",
    "Dose",
    "Route",
    "Prescriber",
    "Resident First Name",
    "Resident Last Name",
    "Room",
    "Notes",
  ];
  const rows = res.rows.map((r) => [
    r.id,
    formatCsvDateTime(r.scheduled_datetime),
    formatCsvDateTime(r.administered_datetime),
    r.administered_by ?? "",
    r.status,
    r.refusal_reason ?? "",
    r.hold_reason ?? "",
    r.drug_name,
    r.dosage,
    r.route ?? "",
    r.prescriber_name ?? "",
    r.resident_first_name,
    r.resident_last_name,
    r.room_number ?? "",
    r.notes ?? "",
  ]);

  return {
    bytes: csvBytes(header, rows),
    mime: "text/csv",
    title:
      typeof params.title === "string" && params.title
        ? params.title
        : `MAR export (${res.rows.length} passes)`,
    description: `Medication passes scheduled between ${formatReportDate(windowStartAt)} and ${formatReportDate(windowEndAt)}`,
    parameters: { windowStartAt, windowEndAt, rowCount: res.rows.length },
  };
};

// Humanize an audit row's before/after JSON blobs into a readable change
// summary so the CSV opens cleanly in Excel instead of dumping raw JSON into
// a cell. Updates render as "Field: old → new"; creates/deletes render a
// short label.
function humanizeAuditKey(key: string): string {
  const spaced = key
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Audit rows store the raw DB table name (e.g. "ops_med_passes") and a
// lowercase verb ("create"). Auditors should see plain English, so map the
// common ones and fall back to a title-cased version of the slug.
const AUDIT_ENTITY_LABELS: Record<string, string> = {
  ops_residents: "Resident",
  ops_medications: "Medication",
  ops_med_passes: "Medication Pass",
  ops_med_destruction: "Medication Destruction",
  ops_controlled_sub_counts: "Controlled Substance Count",
  ops_incidents: "Incident",
  ops_invoices: "Invoice",
  ops_billing_charges: "Billing Charge",
  ops_payments: "Payment",
  ops_care_plans: "Care Plan",
  ops_staff: "Staff Member",
  ops_staff_credentials: "Staff Credential",
  ops_vendors: "Vendor",
  ops_complaints: "Complaint",
  ops_inspections: "Inspection",
  ops_drill_logs: "Drill Log",
  ops_obligations: "Obligation",
  ops_temperature_logs: "Temperature Log",
  ops_temperature_fixtures: "Temperature Fixture",
  ops_leads: "Lead",
  ops_admissions: "Admission",
  ops_share_links: "Share Link",
  ops_preaudit_pull: "Pre-Audit Pull",
  ops_reports: "Report",
  ops_resident_trust_accounts: "Trust Account",
  ops_resident_trust_ledger: "Trust Ledger Entry",
  ops_resident_trust_statements: "Trust Statement",
  ops_notes: "Note",
  ops_posting_catalog: "Posting",
  ops_posting_verifications: "Posting Verification",
  tracker_entries: "Tracker Entry",
};

const AUDIT_ACTION_LABELS: Record<string, string> = {
  create: "Created",
  update: "Updated",
  delete: "Deleted",
  close: "Closed",
  resolve: "Resolved",
  reopen: "Reopened",
  void: "Voided",
  revoke: "Revoked",
  archive: "Archived",
  restore: "Restored",
};

function humanizeEntityType(entityType: string): string {
  if (AUDIT_ENTITY_LABELS[entityType]) return AUDIT_ENTITY_LABELS[entityType];
  return humanizeAuditKey(
    entityType.replace(/^ops_/, "").replace(/^tracker_/, ""),
  );
}

function humanizeAction(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? humanizeAuditKey(action);
}

function parseAuditJson(s: string | null | undefined): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function auditValueToString(v: unknown, key: string): string {
  if (v === null || v === undefined) return "(none)";
  if (typeof v === "object") return JSON.stringify(v);
  const yn = formatYesNoFlag(key, v);
  if (yn !== undefined) return yn;
  return String(v);
}

function summarizeAuditChange(
  beforeJson: string | null | undefined,
  afterJson: string | null | undefined,
): string {
  const before = parseAuditJson(beforeJson);
  const after = parseAuditJson(afterJson);

  if (before && after) {
    const keys = Array.from(
      new Set([...Object.keys(before), ...Object.keys(after)]),
    );
    const changes: string[] = [];
    for (const k of keys) {
      if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
        changes.push(
          `${humanizeAuditKey(k)}: ${auditValueToString(before[k], k)} → ${auditValueToString(after[k], k)}`,
        );
      }
    }
    return changes.length > 0 ? changes.join("; ") : "No field changes";
  }

  if (after && !before) {
    const summary = Object.entries(after)
      .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
      .slice(0, 8)
      .map(([k, v]) => `${humanizeAuditKey(k)}: ${auditValueToString(v, k)}`)
      .join("; ");
    return summary ? `Created — ${summary}` : "Created";
  }

  if (before && !after) {
    return "Deleted";
  }

  return "";
}

/** audit_trail — CSV of facility audit rows in window. */
const auditTrailGenerator: ReportGenerator = async (ctx, params) => {
  const { windowStartAt, windowEndAt } = readWindow(params);
  const { rows } = await listAuditForFacility(ctx.facilityNumber, {
    sinceMs: windowStartAt,
    untilMs: windowEndAt,
    page: 1,
    limit: 100000,
  });
  const header = [
    "ID",
    `Date / Time (${REPORT_TZ_LABEL})`,
    "Performed By",
    "Role",
    "Action",
    "Record Type",
    "Record ID",
    "Changes",
  ];
  const data = rows.map((r) => [
    r.id,
    formatCsvDateTime(r.occurredAt),
    r.actorId,
    r.actorRole,
    humanizeAction(r.action),
    humanizeEntityType(r.entityType),
    r.entityId,
    summarizeAuditChange(r.beforeJson, r.afterJson),
  ]);
  return {
    bytes: csvBytes(header, data),
    mime: "text/csv",
    title:
      typeof params.title === "string" && params.title
        ? params.title
        : `Audit trail (${rows.length} events)`,
    description: `Audit-trail events between ${formatReportDate(windowStartAt)} and ${formatReportDate(windowEndAt)}`,
    parameters: { windowStartAt, windowEndAt, rowCount: rows.length },
  };
};

/** monthly_trust_statement — PDF rendering of generateMonthlyStatement(). */
const monthlyTrustStatementGenerator: ReportGenerator = async (ctx, params) => {
  const accountId = Number(params.accountId);
  if (!Number.isFinite(accountId) || accountId <= 0) {
    throw new Error("Trust account ID is required");
  }
  // Accept either (year + month) — what the Reports dialog sends — or
  // explicit (periodStartAt + periodEndAt). Year+month is converted to a
  // UTC-anchored month window.
  let periodStartAt = Number(params.periodStartAt);
  let periodEndAt = Number(params.periodEndAt);
  if (!Number.isFinite(periodStartAt) || !Number.isFinite(periodEndAt)) {
    const year = Number(params.year);
    const month = Number(params.month);
    if (
      Number.isFinite(year) &&
      Number.isFinite(month) &&
      month >= 1 &&
      month <= 12
    ) {
      periodStartAt = Date.UTC(year, month - 1, 1);
      periodEndAt = Date.UTC(year, month, 1);
    } else {
      throw new Error(
        "Statement period is required (provide year + month, or periodStartAt + periodEndAt)",
      );
    }
  }
  if (!(periodStartAt < periodEndAt)) {
    throw new Error("Period start must be before period end");
  }

  // generateMonthlyStatement is idempotent — re-running it returns the
  // existing row if the period already snapshotted. We rely on that here
  // so PDF re-generation does not double-write the statements table.
  const stmt = await generateMonthlyStatement(
    ctx.facilityNumber,
    accountId,
    periodStartAt,
    periodEndAt,
    ctx.generatedBy,
    ctx.actor,
  );
  const account = await getTrustAccount(accountId, ctx.facilityNumber);

  const facility = await getFacilityReportHeader(ctx.facilityNumber).catch(
    () => null,
  );

  const footerLeft = facility
    ? `${facility.name} · License #${facility.number}`
    : undefined;

  const bytes = await renderPdf((doc) => {
    drawPdfHeader(doc, {
      title: "Monthly resident trust statement",
      subtitle: `Account #${accountId}`,
      facility,
      generatedAt: ctx.now,
      generatedBy: ctx.generatedBy,
      reportPeriod: { startAt: periodStartAt, endAt: periodEndAt },
    });

    doc.fontSize(11).fillColor("#0f172a");
    doc.text(`Resident ID:           ${stmt.residentId}`);
    if (account) {
      doc.text(`Account status:        ${account.status}`);
    }
    doc.moveDown(0.5);

    const fmtCents = (c: number): string =>
      `$${(c / 100).toFixed(2)}`;

    doc.fontSize(12).fillColor("#01696f").text("Summary");
    doc.fontSize(11).fillColor("#0f172a");
    doc.text(`Opening balance:       ${fmtCents(stmt.openingBalanceCents)}`);
    doc.text(`Credits (deposits):    ${fmtCents(stmt.creditTotalCents)}`);
    doc.text(`Debits (withdrawals):  ${fmtCents(stmt.debitTotalCents)}`);
    doc.text(`Closing balance:       ${fmtCents(stmt.closingBalanceCents)}`);
    doc.text(`Entries in period:     ${stmt.entryCount}`);
    doc.moveDown(0.6);
    doc.fontSize(8).fillColor("#64748b").text(
      `Statement #${stmt.id}  ·  generated ${formatStampDateTime(stmt.generatedAt)}`,
    );
  }, { footerLeft });

  return {
    bytes,
    mime: "application/pdf",
    title:
      typeof params.title === "string" && params.title
        ? params.title
        : `Monthly trust statement #${stmt.id}`,
    description: `Account ${accountId} for ${formatReportDate(periodStartAt)} – ${formatReportDate(periodEndAt)}`,
    parameters: { accountId, periodStartAt, periodEndAt, statementId: stmt.id },
    sourceEntityType: "ops_resident_trust_statement",
    sourceEntityId: stmt.id,
  };
};

/** vendor_coi_matrix — CSV of vendors with COI/license expiry dates. */
const vendorCoiMatrixGenerator: ReportGenerator = async (ctx, params) => {
  const { vendors } = await listVendors(ctx.facilityNumber, {
    page: 1,
    limit: 10000,
  });

  const header = [
    "ID",
    "Vendor",
    "Service Type",
    "Status",
    "Contact Name",
    "Contact Phone",
    "Contact Email",
    "COI Expires",
    "License Expires",
    "Notes",
  ];
  const rows = vendors.map((v) => [
    v.id,
    v.vendorName,
    v.vendorType,
    v.status,
    v.contactName ?? "",
    v.contactPhone ?? "",
    v.contactEmail ?? "",
    formatCsvDate(v.coiExpiresAt),
    formatCsvDate(v.licenseExpiresAt),
    v.notes ?? "",
  ]);
  return {
    bytes: csvBytes(header, rows),
    mime: "text/csv",
    title:
      typeof params.title === "string" && params.title
        ? params.title
        : `Vendor COI matrix (${vendors.length} vendors)`,
    description: "Active vendors with current COI + license expiry dates",
    parameters: { rowCount: vendors.length },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Remaining six generators — all CSV. They use the existing storage list
// functions, apply the standard date/timezone helpers, and Title Case their
// headers like the other CSV reports.
// ─────────────────────────────────────────────────────────────────────────────

/** chart_completeness_snapshot — CSV of chart completeness for active residents. */
const chartCompletenessSnapshotGenerator: ReportGenerator = async (ctx, params) => {
  const { rows, complete, activeResidents } = await listChartCompleteness(
    ctx.facilityNumber,
  );
  const header = [
    "Resident ID",
    "Resident Last Name",
    "Resident First Name",
    "Room",
    "Status",
    "Completed",
    "Total",
    "Missing",
    "Stale",
    "Worst Status",
  ];
  const data = rows.map((r) => [
    r.residentId,
    r.residentLastName,
    r.residentFirstName,
    r.residentRoomNumber ?? "",
    r.residentStatus,
    r.completedCount,
    r.totalCount,
    r.missing.join("; "),
    r.stale.join("; "),
    r.worst,
  ]);
  return {
    bytes: csvBytes(header, data),
    mime: "text/csv",
    title:
      typeof params.title === "string" && params.title
        ? params.title
        : `Chart completeness (${complete} of ${activeResidents} complete)`,
    description:
      "Snapshot of chart completeness for active residents at this facility.",
    parameters: { rowCount: rows.length, complete, activeResidents },
  };
};

/** complaint_log — CSV of complaints received in window. */
const complaintLogGenerator: ReportGenerator = async (ctx, params) => {
  const { windowStartAt, windowEndAt } = readWindow(params);
  // listComplaints has no window filter — pull a generous page and filter
  // in-memory, matching the preaudit pattern.
  const { complaints } = await listComplaints(ctx.facilityNumber, {
    page: 1,
    limit: 100000,
  });
  const filtered = complaints.filter(
    (c) => c.receivedAt >= windowStartAt && c.receivedAt < windowEndAt,
  );
  const header = [
    "ID",
    `Received (${REPORT_TZ_LABEL})`,
    "Complainant Type",
    "Complainant Name",
    "Relation",
    "Nature",
    "Assigned To",
    "Status",
    `Resolved (${REPORT_TZ_LABEL})`,
    `Closed (${REPORT_TZ_LABEL})`,
    "Resolution Note",
    "External Ref",
  ];
  const data = filtered.map((c) => [
    c.id,
    formatCsvDateTime(c.receivedAt),
    c.complainantType,
    c.complainantName ?? "",
    c.complainantRelation ?? "",
    c.nature,
    c.assignedTo ?? "",
    c.status,
    formatCsvDateTime(c.resolvedAt),
    formatCsvDateTime(c.closedAt),
    c.resolutionNote ?? "",
    c.externalRef ?? "",
  ]);
  return {
    bytes: csvBytes(header, data),
    mime: "text/csv",
    title:
      typeof params.title === "string" && params.title
        ? params.title
        : `Complaint log (${filtered.length} complaint${filtered.length === 1 ? "" : "s"})`,
    description: `Complaints received between ${formatReportDate(windowStartAt)} and ${formatReportDate(windowEndAt)}`,
    parameters: { windowStartAt, windowEndAt, rowCount: filtered.length },
  };
};

/** posting_verification_log — CSV of LIC624/SOC341/etc. posting verifications in window. */
const postingVerificationLogGenerator: ReportGenerator = async (ctx, params) => {
  const { windowStartAt, windowEndAt } = readWindow(params);
  const { rows } = await listPostingVerifications(ctx.facilityNumber, {
    sinceMs: windowStartAt,
    page: 1,
    limit: 100000,
  });
  const filtered = rows.filter((r) => r.verifiedAt < windowEndAt);
  const header = [
    "ID",
    `Verified (${REPORT_TZ_LABEL})`,
    "Posting",
    "Verified By",
    "Status",
    "Evidence Count",
    "Note",
  ];
  const data = filtered.map((r) => [
    r.id,
    formatCsvDateTime(r.verifiedAt),
    r.postingKey,
    r.verifiedBy,
    r.status,
    r.evidenceCount,
    r.note ?? "",
  ]);
  return {
    bytes: csvBytes(header, data),
    mime: "text/csv",
    title:
      typeof params.title === "string" && params.title
        ? params.title
        : `Posting verification log (${filtered.length} verification${filtered.length === 1 ? "" : "s"})`,
    description: `Posting verifications between ${formatReportDate(windowStartAt)} and ${formatReportDate(windowEndAt)}`,
    parameters: { windowStartAt, windowEndAt, rowCount: filtered.length },
  };
};

/** drill_log_export — CSV of fire / disaster drill logs in window. */
const drillLogExportGenerator: ReportGenerator = async (ctx, params) => {
  const { windowStartAt, windowEndAt } = readWindow(params);
  const { logs } = await listDrillLogs(ctx.facilityNumber, {
    sinceMs: windowStartAt,
    page: 1,
    limit: 100000,
  });
  const filtered = logs.filter((l) => l.executedAt < windowEndAt);
  const header = [
    "ID",
    `Executed (${REPORT_TZ_LABEL})`,
    "Drill Kind",
    "Scenario",
    "Shift",
    "Leader",
    "Participants",
    "Residents Involved",
    "Evacuation (sec)",
    "Status",
    "Debrief Notes",
    "Corrective Actions",
  ];
  const data = filtered.map((l) => [
    l.id,
    formatCsvDateTime(l.executedAt),
    l.drillKind,
    l.scenario ?? "",
    l.shift ?? "",
    l.leader ?? "",
    Array.isArray(l.participantsJson) ? l.participantsJson.join("; ") : "",
    Array.isArray(l.residentsInvolvedJson)
      ? l.residentsInvolvedJson.join("; ")
      : "",
    l.evacuationSeconds ?? "",
    l.status,
    l.debriefNotes ?? "",
    Array.isArray(l.correctiveActionsJson)
      ? l.correctiveActionsJson.join("; ")
      : "",
  ]);
  return {
    bytes: csvBytes(header, data),
    mime: "text/csv",
    title:
      typeof params.title === "string" && params.title
        ? params.title
        : `Drill log export (${filtered.length} drill${filtered.length === 1 ? "" : "s"})`,
    description: `Drill logs executed between ${formatReportDate(windowStartAt)} and ${formatReportDate(windowEndAt)}`,
    parameters: { windowStartAt, windowEndAt, rowCount: filtered.length },
  };
};

/** credentials_matrix — CSV of staff credentials with expiry dates (snapshot). */
const credentialsMatrixGenerator: ReportGenerator = async (ctx, params) => {
  const { rows } = await listStaffCredentials(ctx.facilityNumber, {
    page: 1,
    limit: 100000,
  });
  const header = [
    "ID",
    "Staff ID",
    "Credential Type",
    "Issued",
    "Expires",
    `Verified (${REPORT_TZ_LABEL})`,
    "Verified By",
    "Status",
    "Note",
  ];
  const data = rows.map((c) => [
    c.id,
    c.staffId,
    c.credentialType,
    formatCsvDate(c.issuedAt),
    formatCsvDate(c.expiresAt),
    formatCsvDateTime(c.verifiedAt),
    c.verifiedBy ?? "",
    c.status,
    c.note ?? "",
  ]);
  return {
    bytes: csvBytes(header, data),
    mime: "text/csv",
    title:
      typeof params.title === "string" && params.title
        ? params.title
        : `Staff credentials matrix (${rows.length} credential${rows.length === 1 ? "" : "s"})`,
    description:
      "Snapshot of active staff credentials with issue and expiry dates.",
    parameters: { rowCount: rows.length },
  };
};

/** tracker_export — CSV of tracker entries for one slug in window. */
const trackerExportGenerator: ReportGenerator = async (ctx, params) => {
  const slug = typeof params.slug === "string" ? params.slug : "";
  if (!slug) throw new Error("Tracker slug is required");
  const { windowStartAt, windowEndAt } = readWindow(params);

  // listEntries uses keyset pagination; loop through pages so an export
  // picks up more than the 200-row default. Hard cap at 5000 to match the
  // other large-list generators.
  const HARD_CAP = 5000;
  const PER_PAGE = 200;
  const items: Awaited<ReturnType<typeof listEntries>>["items"] = [];
  let cursor: { occurredAt: number; id: number } | undefined;
  while (items.length < HARD_CAP) {
    const page = await listEntries(ctx.facilityNumber, {
      slug,
      from: windowStartAt,
      to: windowEndAt,
      cursor,
      limit: PER_PAGE,
    });
    items.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }

  const header = [
    "ID",
    `Occurred (${REPORT_TZ_LABEL})`,
    "Tracker",
    "Resident ID",
    "Shift",
    "Reported By",
    "Role",
    "Status",
    "Is Incident",
    "Payload (JSON)",
  ];
  const data = items.map((e) => [
    e.id,
    formatCsvDateTime(e.occurredAt),
    e.trackerSlug,
    e.residentId ?? "",
    e.shift ?? "",
    e.reportedByDisplayName,
    e.reportedByRole,
    e.status,
    e.isIncident === 1 ? "Yes" : "No",
    typeof e.payload === "string" ? e.payload : JSON.stringify(e.payload),
  ]);
  return {
    bytes: csvBytes(header, data),
    mime: "text/csv",
    title:
      typeof params.title === "string" && params.title
        ? params.title
        : `Tracker export — ${slug} (${items.length} entr${items.length === 1 ? "y" : "ies"})`,
    description: `Tracker entries for ${slug} between ${formatReportDate(windowStartAt)} and ${formatReportDate(windowEndAt)}. The Payload column holds the raw tracker-specific JSON; use the dedicated tracker export for per-field columns.`,
    parameters: { slug, windowStartAt, windowEndAt, rowCount: items.length },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Registry — keyed by ReportKind so the router can dispatch by string.
// `custom` is intentionally absent: a custom report must specify its own
// generator wiring in a future ticket. The router maps "no generator" →
// 400 "unsupported kind", so the FE can guard the dropdown.
// ─────────────────────────────────────────────────────────────────────────────

export const REPORT_GENERATORS: Partial<Record<ReportKind, ReportGenerator>> = {
  preaudit_pull: preauditPullGenerator,
  incident_summary: incidentSummaryGenerator,
  mar_export: marExportGenerator,
  audit_trail: auditTrailGenerator,
  monthly_trust_statement: monthlyTrustStatementGenerator,
  vendor_coi_matrix: vendorCoiMatrixGenerator,
  tracker_export: trackerExportGenerator,
  credentials_matrix: credentialsMatrixGenerator,
  drill_log_export: drillLogExportGenerator,
  posting_verification_log: postingVerificationLogGenerator,
  complaint_log: complaintLogGenerator,
  chart_completeness_snapshot: chartCompletenessSnapshotGenerator,
};

export function getReportGenerator(kind: ReportKind): ReportGenerator | undefined {
  return REPORT_GENERATORS[kind];
}
