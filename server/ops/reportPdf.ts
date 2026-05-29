/**
 * Shared PDF primitives for the Reports Hub + pre-audit pull.
 *
 * `renderPdf` + `drawPdfHeader` were previously private to
 * reportsGenerators.ts. They live here now so the pre-audit pull renderer
 * (`renderPreauditPullPdf`) can reuse the same letterhead without a circular
 * import between reportsGenerators.ts ↔ preauditPullsStorage.ts.
 *
 * `renderPreauditPullPdf` turns a composed pre-audit bundle into a
 * human-readable PDF (was a raw `.json` download — useless to hand an
 * inspector). Each requested section renders a heading, a count line, and a
 * compact per-row field list. Object/array values and any `*Json` field are
 * skipped so no raw JSON leaks into the document.
 */

import PDFDocument from "pdfkit";

import { getFacilityReportHeader } from "../trackers/reports/reportQueries";
import {
  formatStampDateTime,
  formatReportDate,
  formatReportPeriod,
  formatYesNoFlag,
  REPORT_TZ_LABEL,
} from "./reportFormat";
import {
  PREAUDIT_SECTIONS,
  PREAUDIT_SECTION_LABELS,
  AUDITOR_AUDIENCE_LABELS,
  type PreauditSection,
  type AuditorAudience,
} from "@shared/auditor";

/** Footer line shown on every page — these reports carry resident PHI. */
const CONFIDENTIALITY_NOTICE =
  "Confidential — contains protected health information.";

// ─────────────────────────────────────────────────────────────────────────────
// Shared header + render helpers
// ─────────────────────────────────────────────────────────────────────────────

export interface PdfHeaderArgs {
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
  /** When the report covers a date window, render a "Report period:" line. */
  reportPeriod?: { startAt: number; endAt: number };
}

export function drawPdfHeader(
  doc: InstanceType<typeof PDFDocument>,
  args: PdfHeaderArgs,
): void {
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
  doc.fontSize(8).fillColor("#64748b");
  if (args.reportPeriod) {
    doc.text(
      `Report period: ${formatReportPeriod(args.reportPeriod.startAt, args.reportPeriod.endAt)} (${REPORT_TZ_LABEL})`,
      doc.page.margins.left,
      doc.y,
    );
  }
  doc.text(
    `Prepared ${formatStampDateTime(args.generatedAt)} by ${args.generatedBy}`,
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

/**
 * Stamp every page with a confidentiality notice + "Page X of Y", and an
 * optional left-aligned identifier (facility name + license) so a page that
 * gets separated from the packet is still attributable. Requires the document
 * to be created with `bufferPages: true`.
 */
function stampFooters(
  doc: InstanceType<typeof PDFDocument>,
  footerLeft?: string,
): void {
  const range = doc.bufferedPageRange();
  const contentWidth =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    // Drop the bottom margin so positioned footer text doesn't spill onto a
    // new page; restore it afterward.
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const noticeY = doc.page.height - 34;
    const lineY = doc.page.height - 22;
    doc.fontSize(7).fillColor("#94a3b8");
    doc.text(CONFIDENTIALITY_NOTICE, doc.page.margins.left, noticeY, {
      width: contentWidth,
      align: "center",
      lineBreak: false,
    });
    if (footerLeft) {
      doc.text(footerLeft, doc.page.margins.left, lineY, {
        width: contentWidth,
        align: "left",
        lineBreak: false,
      });
    }
    doc.text(`Page ${i + 1} of ${range.count}`, doc.page.margins.left, lineY, {
      width: contentWidth,
      align: "right",
      lineBreak: false,
    });
    doc.page.margins.bottom = savedBottom;
  }
}

export async function renderPdf(
  build: (doc: InstanceType<typeof PDFDocument>) => void,
  opts?: { footerLeft?: string },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 50, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (b: Buffer) => chunks.push(b));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      build(doc);
      stampFooters(doc, opts?.footerLeft);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-audit pull → human-readable PDF
// ─────────────────────────────────────────────────────────────────────────────

// The packet is a high-value readiness summary, not a raw data dump. Each
// section shows up to this many records; the dedicated per-section export
// (Audit trail / MAR / Vendor COI / etc.) carries the complete list when an
// auditor needs every row. The record count is always disclosed in the
// Summary and the per-section count line, so sampling is transparent.
const PDF_SECTION_ROW_CAP = 50;

function looksLikeEpochMs(n: number): boolean {
  // Epoch-ms timestamps, INCLUDING pre-1970 birthdates (negative). The
  // |n| >= 1e11 floor keeps ordinary integers (counts, cents, ids) from being
  // mistaken for dates; the bounds span roughly 1875 – 2096.
  return Number.isFinite(n) && n >= -3e12 && n <= 4e12 && Math.abs(n) >= 1e11;
}

function humanizeKey(key: string): string {
  const spaced = key
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function isDeniedKey(key: string): boolean {
  const k = key.toLowerCase();
  if (k === "facilitynumber" || k === "facility_number") return true;
  // beforeJson / afterJson / sectionsJson / findingsJson / … — never dump raw
  // JSON blobs into the document.
  if (k.endsWith("json")) return true;
  return false;
}

function formatFieldValue(key: string, value: string | number | boolean): string {
  // Boolean flags first — `true`/`false` and 0/1 flag-keyed fields both
  // render as "Yes" / "No" so an auditor never sees "0" or "false".
  const yn = formatYesNoFlag(key, value);
  if (yn !== undefined) return yn;
  if (typeof value === "number" && looksLikeEpochMs(value)) {
    const k = key.toLowerCase();
    // *_at / *datetime fields keep the time component; everything else that
    // looks like an epoch (dob, *_date, expiry, …) reads cleaner as a date.
    if (k.includes("expire")) return formatReportDate(value);
    if (/(at|datetime)$/.test(k)) return formatStampDateTime(value);
    return formatReportDate(value);
  }
  return String(value);
}

// Internal surrogate / foreign keys ("id", "resident_id", "medicationId") are
// DB plumbing, not audit data — suppress them from the record body (the row's
// own id appears in the record header instead).
function isInternalIdKey(key: string): boolean {
  return key === "id" || /_id$/.test(key) || /[a-z]Id$/.test(key);
}

// Name fields are promoted into the record header, so don't repeat them inline.
const IDENTITY_KEYS = new Set([
  "firstname",
  "first_name",
  "lastname",
  "last_name",
  "resident_first_name",
  "resident_last_name",
]);

// Row-bookkeeping columns — when the record was created/edited and by whom.
// They're system plumbing, not care/audit content, so they're dropped from
// the packet body to keep the signal high. (Report-level provenance is already
// in the "Prepared … by" header line.)
const SYSTEM_META_KEYS = new Set([
  "createdat",
  "created_at",
  "updatedat",
  "updated_at",
  "createdby",
  "created_by",
  "updatedby",
  "updated_by",
  "deletedat",
  "deleted_at",
  "deletedby",
  "deleted_by",
]);

function pickString(
  r: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/** Build a human record header — a name when present, else a label, plus #id. */
function recordTitle(r: Record<string, unknown>, index: number): string {
  const first = pickString(r, "firstName", "first_name", "resident_first_name");
  const last = pickString(r, "lastName", "last_name", "resident_last_name");
  const name = [first, last].filter(Boolean).join(" ");
  const alt = pickString(
    r,
    "residentName",
    "resident_name",
    "vendorName",
    "vendor_name",
    "drugName",
    "drug_name",
    "title",
    "name",
    "subject",
  );
  const label = name || alt;
  const idPart = r.id != null ? `#${r.id}` : `#${index + 1}`;
  return label ? `${label}  (${idPart})` : `Record ${idPart}`;
}

/**
 * Render one record as an organized block: a bold header line that identifies
 * the record, then its fields laid out in a TWO-COLUMN grid that flows
 * left → right and wraps to the next row, so the horizontal space is used
 * instead of stacking everything down the left. Short fields pair up across
 * the two columns; a field too long for half-width (e.g. a diagnosis or note)
 * spans the full width on its own row.
 */
function renderRecord(
  doc: InstanceType<typeof PDFDocument>,
  row: unknown,
  index: number,
): void {
  if (row === null || row === undefined) return;
  if (typeof row !== "object") {
    doc.font("Helvetica").fontSize(9).fillColor("#0f172a").text(String(row), {
      width: 510,
    });
    return;
  }
  const r = row as Record<string, unknown>;

  // Collect displayable fields up front so we can grid-lay them.
  const fields: string[] = [];
  for (const [key, value] of Object.entries(r)) {
    if (isDeniedKey(key) || isInternalIdKey(key)) continue;
    if (IDENTITY_KEYS.has(key.toLowerCase())) continue;
    if (SYSTEM_META_KEYS.has(key.toLowerCase())) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === "object") continue; // arrays / nested objects → skip
    if (typeof value === "string" && value.trim() === "") continue;
    fields.push(
      `${humanizeKey(key)}: ${formatFieldValue(key, value as string | number | boolean)}`,
    );
  }

  // Grid geometry.
  const leftMargin = doc.page.margins.left;
  const rightEdge = doc.page.width - doc.page.margins.right;
  const gridX = leftMargin + 14;
  const fullWidth = rightEdge - gridX;
  const gutter = 16;
  const colWidth = (fullWidth - gutter) / 2;
  const rightX = gridX + colWidth + gutter;
  const pageBottom = doc.page.height - doc.page.margins.bottom;
  const rowGap = 3;

  const ensureSpace = (h: number): void => {
    if (doc.y + h > pageBottom) doc.addPage();
  };

  // Header — keep it with at least the first field row.
  ensureSpace(30);
  doc
    .font("Helvetica-Bold")
    .fontSize(9.5)
    .fillColor("#0f172a")
    .text(recordTitle(r, index), leftMargin, doc.y, {
      width: rightEdge - leftMargin,
    });

  doc.font("Helvetica").fontSize(9).fillColor("#334155");

  if (fields.length === 0) {
    doc
      .fillColor("#94a3b8")
      .text("No additional detail recorded.", gridX, doc.y, {
        width: fullWidth,
      });
    return;
  }

  const oneLine = doc.heightOfString("Mg", { width: colWidth });
  const fitsHalf = (text: string): boolean =>
    doc.heightOfString(text, { width: colWidth }) <= oneLine + 1;

  let i = 0;
  while (i < fields.length) {
    const leftText = fields[i];

    // Long field → full width on its own row.
    if (!fitsHalf(leftText)) {
      const h = doc.heightOfString(leftText, { width: fullWidth });
      ensureSpace(h);
      doc.text(leftText, gridX, doc.y, { width: fullWidth });
      doc.y += rowGap;
      i += 1;
      continue;
    }

    // Short field → pair with the next field if it's also short.
    const rightText =
      i + 1 < fields.length && fitsHalf(fields[i + 1])
        ? fields[i + 1]
        : undefined;

    ensureSpace(oneLine);
    const y = doc.y;
    doc.text(leftText, gridX, y, { width: colWidth });
    if (rightText) doc.text(rightText, rightX, y, { width: colWidth });
    doc.y = y + oneLine + rowGap;
    i += rightText ? 2 : 1;
  }
}

export interface PreauditPdfInput {
  facilityNumber: string;
  generatedAt: number;
  generatedBy: string;
  audience: string;
  audienceLabel?: string | null;
  windowStartAt: number;
  windowEndAt: number;
  sections: PreauditSection[];
  totals: Record<PreauditSection, { included: number; excluded: number }>;
  bundle: Record<PreauditSection, unknown[]>;
}

export async function renderPreauditPullPdf(
  input: PreauditPdfInput,
): Promise<Buffer> {
  const facility = await getFacilityReportHeader(input.facilityNumber).catch(
    () => null,
  );
  // Canonical section order, filtered to what was actually requested.
  const orderedSections = PREAUDIT_SECTIONS.filter((s) =>
    input.sections.includes(s),
  );
  const audienceLabel =
    input.audienceLabel ||
    AUDITOR_AUDIENCE_LABELS[input.audience as AuditorAudience] ||
    input.audience;
  const footerLeft = facility
    ? `${facility.name} · License #${facility.number}`
    : undefined;

  return renderPdf((doc) => {
    drawPdfHeader(doc, {
      title: "Pre-audit pull",
      subtitle: `Prepared for: ${audienceLabel}`,
      facility,
      generatedAt: input.generatedAt,
      generatedBy: input.generatedBy,
      reportPeriod: { startAt: input.windowStartAt, endAt: input.windowEndAt },
    });

    // All section-level text is anchored to this x. renderRecord draws fields
    // with explicit column x-positions, which leaves the PDF cursor's x at a
    // column offset; headings/notes that follow must NOT inherit it or they
    // drift to the right.
    const headingX = doc.page.margins.left;

    // Summary — per-section counts so the reader sees scope at a glance.
    doc.fontSize(12).fillColor("#01696f").text("Summary", headingX, doc.y);
    doc.moveDown(0.2);
    doc.fontSize(9).fillColor("#0f172a");
    for (const s of orderedSections) {
      const t = input.totals[s] ?? { included: 0, excluded: 0 };
      const line =
        `${PREAUDIT_SECTION_LABELS[s] ?? s}: ${t.included}` +
        (t.excluded > 0 ? ` (+${t.excluded} truncated)` : "");
      doc.text(line, headingX, doc.y);
    }

    // Per-section detail.
    for (const section of orderedSections) {
      const rows = input.bundle[section] ?? [];
      const t = input.totals[section] ?? {
        included: rows.length,
        excluded: 0,
      };

      doc.moveDown(0.8);
      doc
        .fontSize(13)
        .fillColor("#01696f")
        .text(PREAUDIT_SECTION_LABELS[section] ?? section, headingX, doc.y);
      const countLine =
        `${t.included} record${t.included === 1 ? "" : "s"}` +
        (t.excluded > 0 ? `  ·  ${t.excluded} not shown (truncated)` : "");
      doc.fontSize(9).fillColor("#64748b").text(countLine, headingX, doc.y);
      doc.moveDown(0.3);

      if (rows.length === 0) {
        doc
          .fontSize(9)
          .fillColor("#94a3b8")
          .text("No records in this section.", headingX, doc.y);
        continue;
      }

      const shown = rows.slice(0, PDF_SECTION_ROW_CAP);
      shown.forEach((row, idx) => {
        renderRecord(doc, row, idx);
        doc.moveDown(0.3);
        if (idx < shown.length - 1) {
          // Faint rule between records so the eye can separate them.
          doc
            .strokeColor("#eef2f7")
            .lineWidth(0.5)
            .moveTo(doc.page.margins.left, doc.y)
            .lineTo(doc.page.width - doc.page.margins.right, doc.y)
            .stroke();
          doc.moveDown(0.3);
        }
      });

      if (rows.length > PDF_SECTION_ROW_CAP) {
        doc.moveDown(0.3);
        doc
          .fontSize(9)
          .fillColor("#64748b")
          .text(
            `Showing ${PDF_SECTION_ROW_CAP} of ${rows.length} records. Generate the dedicated report for the complete list.`,
            headingX,
            doc.y,
          );
      }
    }
  }, { footerLeft });
}
