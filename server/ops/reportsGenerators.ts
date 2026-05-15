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

import PDFDocument from "pdfkit";

import { pool } from "../db/index";
import {
  listIncidents,
  listVendors,
} from "./opsStorage";
import { listAuditForFacility } from "./auditStorage";
import { generatePreauditBundle } from "./preauditPullsStorage";
import {
  generateMonthlyStatement,
  getTrustAccount,
} from "./residentTrustStorage";
import { getFacilityReportHeader } from "../trackers/reports/reportQueries";
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
// PDF helpers — shared layout primitives used by incident_summary and
// monthly_trust_statement so the report library has consistent letterhead.
// ─────────────────────────────────────────────────────────────────────────────

interface PdfHeaderArgs {
  title: string;
  subtitle?: string;
  // Letterhead — accepts the merged shape from getFacilityReportHeader (which
  // optionally includes logoPath + headerText). Older callers pass only the
  // CCLD-derived subset; the extra fields are all optional.
  facility: {
    name: string;
    number: string;
    address?: string;
    city?: string;
    zip?: string;
    phone?: string;
    logoPath?: string | null;
    headerText?: string | null;
    administrator?: string | null;
  } | null;
  generatedAt: number;
  generatedBy: string;
}

function drawPdfHeader(doc: InstanceType<typeof PDFDocument>, args: PdfHeaderArgs): void {
  const fac = args.facility;
  const top = doc.y;

  // Render the facility logo at top-left (48pt square) when available.
  // pdfkit only supports PNG/JPEG — `reportQueries.getFacilityReportHeader`
  // already filters SVG out and resolves the absolute path for us.
  let titleX = doc.page.margins.left;
  if (fac?.logoPath) {
    try {
      doc.image(fac.logoPath, doc.page.margins.left, top, { fit: [48, 48] });
      titleX = doc.page.margins.left + 60;
    } catch {
      // Bad image — fall through to text-only header.
    }
  }

  doc
    .fontSize(16)
    .fillColor("#01696f")
    .text(args.title, titleX, top, { align: "left" });
  if (args.subtitle) {
    doc.moveDown(0.2);
    doc.fontSize(10).fillColor("#64748b").text(args.subtitle, titleX, doc.y);
  }
  doc.moveDown(0.4);
  doc.fontSize(9).fillColor("#0f172a");
  if (fac) {
    const addr = [fac.address, fac.city, fac.zip].filter(Boolean).join(", ");
    doc.text(`${fac.name}  (License #${fac.number})`, titleX, doc.y);
    if (addr) doc.text(addr, titleX, doc.y);
    if (fac.phone) doc.text(fac.phone, titleX, doc.y);
    if (fac.administrator) {
      doc.text(`Administrator: ${fac.administrator}`, titleX, doc.y);
    }
  } else {
    doc.text("Facility", titleX, doc.y);
  }

  // Push past the logo if the text block was shorter than the image.
  if (fac?.logoPath) {
    const logoBottom = top + 48;
    if (doc.y < logoBottom) doc.y = logoBottom;
  }

  if (fac?.headerText) {
    doc.moveDown(0.2);
    doc
      .fontSize(9)
      .fillColor("#475569")
      .text(fac.headerText, doc.page.margins.left, doc.y);
  }

  doc.moveDown(0.4);
  doc.fontSize(8).fillColor("#64748b").text(
    `Generated ${new Date(args.generatedAt).toISOString()} by ${args.generatedBy}`,
    doc.page.margins.left,
    doc.y,
  );
  doc.moveDown(0.6);
  doc
    .strokeColor("#e2e8f0")
    .lineWidth(1)
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .stroke();
  doc.moveDown(0.6);
  doc.fillColor("#0f172a");
}

async function renderPdf(
  build: (doc: InstanceType<typeof PDFDocument>) => void,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (b: Buffer) => chunks.push(b));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      build(doc);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
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

function fmtDate(ms: number | null | undefined): string {
  if (!ms) return "";
  try {
    return new Date(ms).toISOString();
  } catch {
    return "";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Generators — implemented
// ─────────────────────────────────────────────────────────────────────────────

/** preaudit_pull — JSON bundle of every requested section. */
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

  const spec: PreauditPullSpec = {
    audience: audience as PreauditPullSpec["audience"],
    audienceLabel:
      typeof params.audienceLabel === "string" ? params.audienceLabel : undefined,
    windowStartAt,
    windowEndAt,
    sections,
    deliveryMethod: "download",
  };

  const { bundle, totals } = await generatePreauditBundle(
    ctx.facilityNumber,
    spec,
  );

  const payload = {
    facilityNumber: ctx.facilityNumber,
    generatedAt: ctx.now,
    generatedBy: ctx.generatedBy,
    spec: {
      audience: spec.audience,
      audienceLabel: spec.audienceLabel,
      windowStartAt,
      windowEndAt,
      sections,
    },
    totals,
    bundle,
  };

  return {
    bytes: Buffer.from(JSON.stringify(payload, null, 2), "utf8"),
    mime: "application/json",
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

  const bytes = await renderPdf((doc) => {
    drawPdfHeader(doc, {
      title: "Incident summary",
      subtitle: `${new Date(windowStartAt).toISOString().slice(0, 10)} → ${new Date(windowEndAt).toISOString().slice(0, 10)} · ${filtered.length} incident(s)`,
      facility,
      generatedAt: ctx.now,
      generatedBy: ctx.generatedBy,
    });

    if (filtered.length === 0) {
      doc.fontSize(11).fillColor("#64748b").text(
        "No incidents recorded in this window.",
      );
      return;
    }

    doc.fontSize(10).fillColor("#0f172a");
    for (const inc of filtered) {
      doc
        .fontSize(11)
        .fillColor("#01696f")
        .text(
          `${new Date(inc.incidentDate).toISOString().slice(0, 10)}  ·  ${inc.incidentType}  ·  ${inc.status}`,
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
  });

  return {
    bytes,
    mime: "application/pdf",
    title:
      typeof params.title === "string" && params.title
        ? params.title
        : `Incident summary (${filtered.length} incident${filtered.length === 1 ? "" : "s"})`,
    description: `Incidents between ${fmtDate(windowStartAt)} and ${fmtDate(windowEndAt)}`,
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
    "id",
    "scheduled_at",
    "administered_at",
    "administered_by",
    "status",
    "refusal_reason",
    "hold_reason",
    "drug_name",
    "dosage",
    "route",
    "prescriber",
    "resident_first_name",
    "resident_last_name",
    "room_number",
    "notes",
  ];
  const rows = res.rows.map((r) => [
    r.id,
    fmtDate(r.scheduled_datetime),
    fmtDate(r.administered_datetime),
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
    description: `Medication passes scheduled between ${fmtDate(windowStartAt)} and ${fmtDate(windowEndAt)}`,
    parameters: { windowStartAt, windowEndAt, rowCount: res.rows.length },
  };
};

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
    "id",
    "occurred_at",
    "actor_id",
    "actor_role",
    "action",
    "entity_type",
    "entity_id",
    "before_json",
    "after_json",
  ];
  const data = rows.map((r) => [
    r.id,
    fmtDate(r.occurredAt),
    r.actorId,
    r.actorRole,
    r.action,
    r.entityType,
    r.entityId,
    r.beforeJson ?? "",
    r.afterJson ?? "",
  ]);
  return {
    bytes: csvBytes(header, data),
    mime: "text/csv",
    title:
      typeof params.title === "string" && params.title
        ? params.title
        : `Audit trail (${rows.length} events)`,
    description: `Audit-trail events between ${fmtDate(windowStartAt)} and ${fmtDate(windowEndAt)}`,
    parameters: { windowStartAt, windowEndAt, rowCount: rows.length },
  };
};

/** monthly_trust_statement — PDF rendering of generateMonthlyStatement(). */
const monthlyTrustStatementGenerator: ReportGenerator = async (ctx, params) => {
  const accountId = Number(params.accountId);
  if (!Number.isFinite(accountId) || accountId <= 0) {
    throw new Error("accountId is required");
  }
  const periodStartAt = Number(params.periodStartAt);
  const periodEndAt = Number(params.periodEndAt);
  if (
    !Number.isFinite(periodStartAt) ||
    !Number.isFinite(periodEndAt) ||
    !(periodStartAt < periodEndAt)
  ) {
    throw new Error("periodStartAt and periodEndAt are required");
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

  const bytes = await renderPdf((doc) => {
    drawPdfHeader(doc, {
      title: "Monthly resident trust statement",
      subtitle: `Account #${accountId}  ·  ${new Date(periodStartAt).toISOString().slice(0, 10)} → ${new Date(periodEndAt).toISOString().slice(0, 10)}`,
      facility,
      generatedAt: ctx.now,
      generatedBy: ctx.generatedBy,
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
      `Statement id #${stmt.id}  ·  generated ${new Date(stmt.generatedAt).toISOString()}`,
    );
  });

  return {
    bytes,
    mime: "application/pdf",
    title:
      typeof params.title === "string" && params.title
        ? params.title
        : `Monthly trust statement #${stmt.id}`,
    description: `Account ${accountId} for ${fmtDate(periodStartAt)} → ${fmtDate(periodEndAt)}`,
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
    "id",
    "vendor_name",
    "vendor_type",
    "status",
    "contact_name",
    "contact_phone",
    "contact_email",
    "coi_expires_at",
    "license_expires_at",
    "notes",
  ];
  const rows = vendors.map((v) => [
    v.id,
    v.vendorName,
    v.vendorType,
    v.status,
    v.contactName ?? "",
    v.contactPhone ?? "",
    v.contactEmail ?? "",
    fmtDate(v.coiExpiresAt),
    fmtDate(v.licenseExpiresAt),
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
// Stubs — registered so the FE kind picker lists them, but generate fails
// with a clear "coming soon" message until the next wave wires the logic.
// ─────────────────────────────────────────────────────────────────────────────

const NOT_IMPLEMENTED = "Not implemented yet — coming in Wave 5+";

function notImplemented(kindLabel: string): ReportGenerator {
  return async () => {
    throw new Error(`${NOT_IMPLEMENTED}: ${kindLabel}`);
  };
}

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
  // Stubs — Wave 5+ work.
  tracker_export: notImplemented("Tracker export"),
  credentials_matrix: notImplemented("Staff credentials matrix"),
  drill_log_export: notImplemented("Drill log export"),
  posting_verification_log: notImplemented("Posting verification log"),
  complaint_log: notImplemented("Complaint log"),
  chart_completeness_snapshot: notImplemented("Chart completeness snapshot"),
};

export function getReportGenerator(kind: ReportKind): ReportGenerator | undefined {
  return REPORT_GENERATORS[kind];
}
