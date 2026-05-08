/**
 * Tracker report PDF renderer.
 *
 * Pipes a single PDFKit document into the provided writable stream (typically
 * `res`). The document layout is:
 *
 *   1. Header strip   — facility name + license # + type · address · phone
 *   2. Filter line    — tracker name · date range · shift · resident
 *   3. Per-resident sections, oldest-first within each section (state-audit
 *      ordering). Each row: When · Shift · Detail · Reported by.
 *   4. Empty placeholder if no rows match.
 *   5. Signature block on the final page — print-only, not e-sign (v1).
 *
 * The renderer is purely synchronous after the first row write. The route
 * handler buffers `streamEntriesForExport` into an array and hands it in;
 * grouping by resident requires the full set up-front, so streaming the input
 * doesn't help here. Output is streamed to the response as PDFKit emits.
 *
 * No per-slug branching. Per-row Detail copy comes from the tracker's
 * `historySummary` callback, falling back to a generic key/value summary —
 * mirrors the History tab's behaviour exactly.
 */

import PDFDocument from "pdfkit";

import type { EntryExportRow } from "../trackerStorage";
import { getDefinition, type SerializedTrackerDefinition } from "../registry";
import type { HistoryTone } from "@shared/tracker-schemas";
import type { FacilityReportHeader } from "./reportQueries";

// ─────────────────────────────────────────────────────────────────────────────
// Layout constants
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_MARGIN_X = 50;
const PAGE_MARGIN_TOP = 50;
const PAGE_MARGIN_BOTTOM = 50;

/** ncaref teal — matches the design language token in CLAUDE.md. */
const COLOR_ACCENT = "#01696f";
const COLOR_TEXT = "#0f172a";
const COLOR_MUTED = "#64748b";
const COLOR_RULE = "#e2e8f0";

const TONE_PILL: Record<HistoryTone, { bg: string; fg: string }> = {
  normal:   { bg: "#ecfdf5", fg: "#047857" },
  elevated: { bg: "#fffbeb", fg: "#b45309" },
  critical: { bg: "#fef2f2", fg: "#b91c1c" },
  info:     { bg: "#f1f5f9", fg: "#475569" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface RenderTrackerReportPdfArgs {
  definition: SerializedTrackerDefinition;
  facility: FacilityReportHeader | null;
  /** Echoed in the filter line of the header. */
  filters: {
    from: number;
    to: number;
    shift?: string;
    residentId?: number;
  };
  rows: EntryExportRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Renderer
// ─────────────────────────────────────────────────────────────────────────────

export function renderTrackerReportPdf(
  out: NodeJS.WritableStream,
  args: RenderTrackerReportPdfArgs,
): void {
  const doc = new PDFDocument({
    size: "LETTER",
    margins: {
      top: PAGE_MARGIN_TOP,
      bottom: PAGE_MARGIN_BOTTOM,
      left: PAGE_MARGIN_X,
      right: PAGE_MARGIN_X,
    },
    info: {
      Title: `${args.definition.name} report`,
      Author: args.facility?.name ?? "ncaref",
      Subject: `Tracker report — ${args.definition.name}`,
    },
  });

  doc.pipe(out);

  drawHeaderStrip(doc, args);
  drawFilterLine(doc, args);

  if (args.rows.length === 0) {
    drawEmptyPlaceholder(doc);
  } else {
    drawResidentSections(doc, args);
  }

  drawSignatureBlock(doc, args);

  doc.end();
}

// ─────────────────────────────────────────────────────────────────────────────
// Section: header strip
// ─────────────────────────────────────────────────────────────────────────────

function drawHeaderStrip(
  doc: PDFKit.PDFDocument,
  args: RenderTrackerReportPdfArgs,
): void {
  const facility = args.facility;

  doc.fillColor(COLOR_TEXT).font("Helvetica-Bold").fontSize(14);
  doc.text(facility?.name ?? "Facility report", { continued: false });

  doc.font("Helvetica").fontSize(10).fillColor(COLOR_MUTED);
  const idLine = facility
    ? `License #: ${facility.number}${facility.facilityType ? ` · ${facility.facilityType}` : ""}`
    : "License: —";
  doc.text(idLine);

  if (facility) {
    const addressLine = [facility.address, facility.city, facility.zip]
      .filter((v) => v && v.trim() !== "")
      .join(", ");
    if (addressLine) doc.text(addressLine);
    if (facility.phone) doc.text(facility.phone);
  }

  doc.moveDown(0.4);

  // Teal accent rule under the letterhead.
  const y = doc.y;
  doc
    .strokeColor(COLOR_ACCENT)
    .lineWidth(1)
    .moveTo(PAGE_MARGIN_X, y)
    .lineTo(doc.page.width - PAGE_MARGIN_X, y)
    .stroke();

  doc.moveDown(0.6);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section: filter line
// ─────────────────────────────────────────────────────────────────────────────

function drawFilterLine(
  doc: PDFKit.PDFDocument,
  args: RenderTrackerReportPdfArgs,
): void {
  const fromIso = formatDate(args.filters.from);
  const toIso = formatDate(args.filters.to);

  const parts = [
    args.definition.name,
    `${fromIso} → ${toIso}`,
  ];
  parts.push(`Shift: ${args.filters.shift ?? "All"}`);

  // Resident name lookup is cheap from the row set — pick the first matching
  // row's resident name. If the filter is set but no rows match, we fall back
  // to "Resident #<id>" so the header still reflects the requested filter.
  if (args.filters.residentId !== undefined) {
    const match = args.rows.find((r) => r.residentId === args.filters.residentId);
    parts.push(`Resident: ${match ? formatResident(match) : `#${args.filters.residentId}`}`);
  } else {
    parts.push("Resident: All");
  }

  doc
    .font("Helvetica-Oblique")
    .fontSize(9)
    .fillColor(COLOR_MUTED)
    .text(parts.join("  ·  "));

  doc.moveDown(0.6);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section: empty placeholder (AC-3)
// ─────────────────────────────────────────────────────────────────────────────

function drawEmptyPlaceholder(doc: PDFKit.PDFDocument): void {
  doc.moveDown(2);
  doc
    .font("Helvetica-Oblique")
    .fontSize(11)
    .fillColor(COLOR_MUTED)
    .text("No entries match these filters in the selected date range.", {
      align: "center",
    });
  doc.moveDown(2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section: per-resident grouping & rows
// ─────────────────────────────────────────────────────────────────────────────

interface GroupedRows {
  residentId: number | null;
  residentLabel: string;
  rows: EntryExportRow[];
}

function groupByResident(rows: EntryExportRow[]): GroupedRows[] {
  // Maintain a parallel ordered list so we never iterate the Map directly —
  // keeps us off TS's downlevelIteration codepath.
  const ordered: GroupedRows[] = [];
  const index = new Map<string, GroupedRows>();
  for (const r of rows) {
    const key = r.residentId === null ? "__none__" : String(r.residentId);
    let group = index.get(key);
    if (!group) {
      group = {
        residentId: r.residentId,
        residentLabel: formatResident(r),
        rows: [],
      };
      index.set(key, group);
      ordered.push(group);
    }
    group.rows.push(r);
  }
  // Within each group: oldest-first (state-audit ordering).
  for (const group of ordered) {
    group.rows.sort((a, b) => a.occurredAt - b.occurredAt);
  }
  // Across groups: stable alphabetical by resident label, with the
  // unidentified bucket sinking to the bottom.
  ordered.sort((a, b) => {
    if (a.residentId === null) return 1;
    if (b.residentId === null) return -1;
    return a.residentLabel.localeCompare(b.residentLabel);
  });
  return ordered;
}

function drawResidentSections(
  doc: PDFKit.PDFDocument,
  args: RenderTrackerReportPdfArgs,
): void {
  const groups = groupByResident(args.rows);

  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i];

    // Avoid orphan section headers — if the next section can't fit at least
    // ~3 rows on this page, start a new page.
    const remaining = doc.page.height - PAGE_MARGIN_BOTTOM - doc.y;
    if (i > 0 && remaining < 80) {
      doc.addPage();
    }

    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor(COLOR_TEXT)
      .text(group.residentLabel);

    doc.moveDown(0.3);
    drawTableHeader(doc);

    for (const row of group.rows) {
      // Compute the actual height the row will consume — the Detail column
      // can wrap to multiple lines for long notes, and a fixed reservation
      // would let the page-break trigger fire mid-row, desynchronizing the
      // four absolute-positioned columns. heightOfString uses the same font
      // sizing pdfkit will apply during the actual draw.
      const rowHeight = computeRowHeight(doc, args.definition.slug, row);
      if (doc.page.height - PAGE_MARGIN_BOTTOM - doc.y < rowHeight) {
        doc.addPage();
        drawTableHeader(doc);
      }
      drawTableRow(doc, args.definition.slug, row);
    }

    doc.moveDown(0.8);
  }
}

const COL_X = {
  when: 50,
  shift: 165,
  detail: 215,
  reportedBy: 460,
};
const COL_W = {
  when: 110,
  shift: 50,
  detail: 245,
  reportedBy: 100,
};

function drawTableHeader(doc: PDFKit.PDFDocument): void {
  const y = doc.y;
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(COLOR_MUTED);
  doc.text("WHEN", COL_X.when, y, { width: COL_W.when });
  doc.text("SHIFT", COL_X.shift, y, { width: COL_W.shift });
  doc.text("DETAIL", COL_X.detail, y, { width: COL_W.detail });
  doc.text("REPORTED BY", COL_X.reportedBy, y, { width: COL_W.reportedBy });

  doc.moveDown(0.3);
  const ruleY = doc.y;
  doc
    .strokeColor(COLOR_RULE)
    .lineWidth(0.5)
    .moveTo(PAGE_MARGIN_X, ruleY)
    .lineTo(doc.page.width - PAGE_MARGIN_X, ruleY)
    .stroke();
  doc.moveDown(0.2);
}

/**
 * Compute the vertical space (in pdf points) a single row will consume. The
 * caller uses this to decide whether to page-break before drawing — fixed
 * heuristics desync columns when the Detail wraps. Mirrors `drawTableRow`
 * font/size/width settings.
 */
function computeRowHeight(
  doc: PDFKit.PDFDocument,
  slug: string,
  row: EntryExportRow,
): number {
  const localDef = getDefinition(slug);
  const summary = localDef?.historySummary
    ? localDef.historySummary(row.payload)
    : { primary: genericPayloadSummary(row.payload), tone: undefined };
  const editedSuffix = row.status === "edited" ? "  (edited)" : "";
  const text = summary.primary + editedSuffix;

  doc.font("Helvetica").fontSize(9);
  const detailHeight = doc.heightOfString(text, { width: COL_W.detail });
  // Single-line minimum is 14pt; padding adds the row separator buffer.
  return Math.max(detailHeight, 14) + 4;
}

function drawTableRow(
  doc: PDFKit.PDFDocument,
  slug: string,
  row: EntryExportRow,
): void {
  const localDef = getDefinition(slug);
  const summary = localDef?.historySummary
    ? localDef.historySummary(row.payload)
    : { primary: genericPayloadSummary(row.payload), tone: undefined };

  const tone: HistoryTone = summary.tone ?? "info";
  const editedSuffix = row.status === "edited" ? "  (edited)" : "";

  const startY = doc.y;
  doc.font("Helvetica").fontSize(9).fillColor(COLOR_TEXT);

  doc.text(formatDateTime(row.occurredAt), COL_X.when, startY, {
    width: COL_W.when,
  });
  doc.text(row.shift ?? "—", COL_X.shift, startY, { width: COL_W.shift });

  // Detail column — primary text, then a tone pill on the same line if
  // the summary tone is anything other than "info" (info reads as no-pill).
  doc.text(summary.primary + editedSuffix, COL_X.detail, startY, {
    width: COL_W.detail,
  });
  if (tone !== "info" && summary.tone) {
    drawTonePill(doc, tone, COL_X.detail, startY + 12);
  }

  doc.fillColor(COLOR_MUTED).fontSize(8);
  const reportedBy = row.reportedByDisplayName
    ? `${row.reportedByDisplayName}${row.reportedByRole ? ` · ${row.reportedByRole}` : ""}`
    : "—";
  doc.text(reportedBy, COL_X.reportedBy, startY, { width: COL_W.reportedBy });

  // Move past the tallest column to the next row position. pdfkit advances
  // doc.y for the most-recently-written column only, so we sync explicitly.
  const endY = Math.max(doc.y, startY + 14);
  doc.y = endY;

  // Light row separator.
  doc
    .strokeColor(COLOR_RULE)
    .lineWidth(0.25)
    .moveTo(PAGE_MARGIN_X, endY + 2)
    .lineTo(doc.page.width - PAGE_MARGIN_X, endY + 2)
    .stroke();
  doc.moveDown(0.25);
}

function drawTonePill(
  doc: PDFKit.PDFDocument,
  tone: HistoryTone,
  x: number,
  y: number,
): void {
  const palette = TONE_PILL[tone];
  const label = tone.charAt(0).toUpperCase() + tone.slice(1);
  const w = 36;
  const h = 11;
  doc
    .fillColor(palette.bg)
    .roundedRect(x, y, w, h, 3)
    .fill();
  doc
    .fillColor(palette.fg)
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .text(label, x, y + 2.5, { width: w, align: "center" });
}

// ─────────────────────────────────────────────────────────────────────────────
// Section: signature block
// ─────────────────────────────────────────────────────────────────────────────

function drawSignatureBlock(
  doc: PDFKit.PDFDocument,
  args: RenderTrackerReportPdfArgs,
): void {
  // Force the signature onto its own page if there's not enough room left.
  const remaining = doc.page.height - PAGE_MARGIN_BOTTOM - doc.y;
  if (remaining < 130) {
    doc.addPage();
  } else {
    doc.moveDown(2);
  }

  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor(COLOR_TEXT)
    .text("Reviewer sign-off");
  doc.moveDown(0.6);

  doc.font("Helvetica").fontSize(10).fillColor(COLOR_TEXT);

  drawSignatureLine(doc, "Reviewed by");
  drawSignatureLine(doc, "Title");
  drawSignatureLine(doc, "Date");

  doc.moveDown(0.3);
  doc
    .fillColor(COLOR_MUTED)
    .fontSize(9)
    .text(`Facility license #: ${args.facility?.number ?? "—"}`);
}

function drawSignatureLine(doc: PDFKit.PDFDocument, label: string): void {
  const lineY = doc.y + 12;
  doc.text(`${label}:`, PAGE_MARGIN_X, doc.y, { continued: false });
  doc
    .strokeColor(COLOR_RULE)
    .lineWidth(0.75)
    .moveTo(PAGE_MARGIN_X + 70, lineY)
    .lineTo(doc.page.width - PAGE_MARGIN_X, lineY)
    .stroke();
  doc.moveDown(1.2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatResident(row: EntryExportRow): string {
  const first = row.residentFirstName ?? "";
  const last = row.residentLastName ?? "";
  const full = `${first} ${last}`.trim();
  if (full) return full;
  if (row.residentId !== null) return `Resident #${row.residentId}`;
  return "Unidentified resident";
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const date = formatDate(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${date} ${hh}:${mm}`;
}

/**
 * Generic payload summarizer — mirrors the client's fallback in HistoryTab.tsx
 * for trackers that haven't defined a `historySummary` callback. First 3
 * key/value pairs.
 */
function genericPayloadSummary(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  return Object.entries(payload as Record<string, unknown>)
    .slice(0, 3)
    .map(([k, v]) => {
      const formatted =
        v !== null && typeof v === "object" ? JSON.stringify(v) : String(v);
      return `${k}: ${formatted}`;
    })
    .join(", ");
}
