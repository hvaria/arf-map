/**
 * Job-seeker resume PDF renderer.
 *
 * Pipes a single PDFKit document into the provided writable stream (typically
 * `res`). Layout — single column, real selectable text (ATS-friendly: no
 * images, no multi-column tables, standard Helvetica, plain section
 * headings):
 *
 *   1. Name + headline
 *   2. Contact line (email · phone · location)
 *   3. Professional Summary      (omitted if no bio)
 *   4. Target Roles              (omitted if none selected)
 *   5. Credentials & Clearances  (omitted if none)
 *   6. Work Experience           (omitted if none)
 *
 * Every section renders only when it has content, so an incomplete profile
 * produces a clean best-effort resume rather than empty headings. Mirrors the
 * conventions of `server/trackers/reports/pdfRenderer.ts` (US Letter, the
 * teal accent rule, page-break guards) so the two renderers read alike.
 */

import PDFDocument from "pdfkit";

import type {
  ResumeViewModel,
  ResumeWorkEntryVM,
  ResumeCredentialVM,
  ResumeCredentialCategory,
} from "@shared/resume";
import { resolveCredentialLogo } from "./credentialLogos";

// ─── Layout constants ─────────────────────────────────────────────────────────

const PAGE_MARGIN_X = 56;
const PAGE_MARGIN_TOP = 56;
const PAGE_MARGIN_BOTTOM = 56;

const COLOR_ACCENT = "#01696f"; // ncaref teal
const COLOR_TEXT = "#0f172a";
const COLOR_MUTED = "#475569";
const COLOR_RULE = "#e2e8f0";

const PHOTO_SIZE = 84; // square box the (circle-cropped) profile photo fits in

/** Badge fill per credential category — mirrors the in-app CredentialBadge
 *  tone split so the resume and the portal speak the same visual language. */
const CATEGORY_COLOR: Record<ResumeCredentialCategory, string> = {
  license: "#01696f",  // teal — licenses (CNA, LVN, RN…)
  clearance: "#2563eb", // blue — clearances (Live Scan, TB…)
  training: "#7c3aed",  // violet — training (CPR, First Aid, DSP…)
  other: "#64748b",     // slate — everything else
};

// ─── Public API ───────────────────────────────────────────────────────────────

export function renderResumePdf(
  out: NodeJS.WritableStream,
  vm: ResumeViewModel,
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
      Title: `${vm.contact.fullName || "Resume"} — Resume`,
      Author: vm.contact.fullName || "Neighbourhood Care Finder",
      Subject: "Resume",
    },
  });

  doc.pipe(out);

  drawHeader(doc, vm);
  drawSummary(doc, vm);
  // "Target Roles" was removed (product decision) — the role keywords now live
  // in the ATS-standard "Core Competencies" section, which ATS keyword matchers
  // weight far more highly than a "roles I want" list.
  drawCoreCompetencies(doc, vm);
  drawCredentials(doc, vm);
  drawWorkExperience(doc, vm);

  doc.end();
}

// ─── Header: name + headline + contact ─────────────────────────────────────────

function drawHeader(doc: PDFKit.PDFDocument, vm: ResumeViewModel): void {
  const topY = doc.y;

  // Profile photo — circle-cropped, pinned to the top-right corner. Drawn
  // first (absolute position) so the text block below can flow with a
  // constrained width and never collide with it. Images are ignored by ATS
  // parsers, which read the text stream — so this stays ATS-safe.
  const photoDrawn = drawProfilePhoto(doc, vm, topY);
  const textWidth = photoDrawn
    ? contentWidth(doc) - PHOTO_SIZE - 18
    : contentWidth(doc);

  doc
    .fillColor(COLOR_TEXT)
    .font("Helvetica-Bold")
    .fontSize(24)
    .text(vm.contact.fullName || "Your Name", PAGE_MARGIN_X, topY, {
      width: textWidth,
      continued: false,
    });

  if (vm.headline) {
    doc.moveDown(0.15);
    doc
      .font("Helvetica")
      .fontSize(11)
      .fillColor(COLOR_ACCENT)
      .text(vm.headline, PAGE_MARGIN_X, doc.y, { width: textWidth });
  }

  // Contact line — email · phone · location, then street on its own line.
  const contactBits = [vm.contact.email, vm.contact.phone, vm.contact.location]
    .filter((v): v is string => !!v)
    .join("   ·   ");

  doc.moveDown(0.35);
  doc.font("Helvetica").fontSize(10).fillColor(COLOR_MUTED);
  if (contactBits) doc.text(contactBits, PAGE_MARGIN_X, doc.y, { width: textWidth });
  if (vm.contact.street) doc.text(vm.contact.street, PAGE_MARGIN_X, doc.y, { width: textWidth });

  // Make sure the accent rule clears the photo even when the text block is
  // shorter than the photo.
  if (photoDrawn) {
    const photoBottom = topY + PHOTO_SIZE;
    if (doc.y < photoBottom) doc.y = photoBottom;
  }

  doc.moveDown(0.5);
  accentRule(doc);
  doc.moveDown(0.6);
}

/**
 * Draw the profile photo as a circle-cropped image in the top-right corner.
 * Returns true if a photo was actually drawn (valid data URL + decodable),
 * false otherwise so the caller can use the full text width.
 */
function drawProfilePhoto(
  doc: PDFKit.PDFDocument,
  vm: ResumeViewModel,
  topY: number,
): boolean {
  const buf = dataUrlToBuffer(vm.contact.photoDataUrl);
  if (!buf) return false;

  const x = doc.page.width - PAGE_MARGIN_X - PHOTO_SIZE;
  const r = PHOTO_SIZE / 2;
  try {
    doc.save();
    doc.circle(x + r, topY + r, r).clip();
    doc.image(buf, x, topY, {
      width: PHOTO_SIZE,
      height: PHOTO_SIZE,
      align: "center",
      valign: "center",
    });
    doc.restore();
    // Thin ring around the photo.
    doc
      .circle(x + r, topY + r, r)
      .lineWidth(0.75)
      .strokeColor(COLOR_RULE)
      .stroke();
    return true;
  } catch {
    // Corrupt base64 / unsupported format — restore graphics state and fall
    // back to a photo-less header.
    try {
      doc.restore();
    } catch {
      /* nothing to restore */
    }
    return false;
  }
}

/** Decode a `data:image/...;base64,...` URL into a Buffer pdfkit can embed
 *  (it accepts JPEG + PNG). Returns null for anything else. */
function dataUrlToBuffer(dataUrl: string | undefined): Buffer | null {
  if (!dataUrl) return null;
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  try {
    return Buffer.from(m[2], "base64");
  } catch {
    return null;
  }
}

// ─── Section: professional summary ─────────────────────────────────────────────

function drawSummary(doc: PDFKit.PDFDocument, vm: ResumeViewModel): void {
  if (!vm.summary) return;
  sectionHeading(doc, "Professional Summary");
  doc
    .font("Helvetica")
    .fontSize(10.5)
    .fillColor(COLOR_TEXT)
    .text(vm.summary, { align: "left", lineGap: 1.5 });
  doc.moveDown(0.8);
}

// ─── Section: core competencies ────────────────────────────────────────────────
// Replaces the old "Target Roles" block. ATS keyword matchers weight a
// recognized SKILLS/COMPETENCIES section far more than a "roles I want" list,
// so the same role keywords are re-emitted here as a comma-delimited line.

function drawCoreCompetencies(doc: PDFKit.PDFDocument, vm: ResumeViewModel): void {
  if (vm.jobTypes.length === 0) return;
  sectionHeading(doc, "Core Competencies");
  doc
    .font("Helvetica")
    .fontSize(10.5)
    .fillColor(COLOR_TEXT)
    .text(vm.jobTypes.join(", "), { lineGap: 1.5 });
  doc.moveDown(0.8);
}

// ─── Section: credentials & clearances ─────────────────────────────────────────

const CRED_BADGE = 20; // px badge/logo box (logos need a touch more than a glyph)
const CRED_TEXT_X = PAGE_MARGIN_X + CRED_BADGE + 8;

function drawCredentials(doc: PDFKit.PDFDocument, vm: ResumeViewModel): void {
  if (vm.credentials.length === 0) return;
  // "Licenses & Certifications" is the highest-recognition ATS heading token
  // for licensed healthcare roles (per the consulting review) — clearances are
  // listed as line items beneath it.
  sectionHeading(doc, "Licenses & Certifications");

  for (const c of vm.credentials) {
    ensureSpace(doc, 28);
    const startY = doc.y;

    // Verified-credential mark: an official licensed logo if one is configured
    // for this kind, else a drawn category-coloured badge.
    drawCredentialMark(doc, c, PAGE_MARGIN_X, startY);

    doc
      .font("Helvetica-Bold")
      .fontSize(10.5)
      .fillColor(COLOR_TEXT)
      .text(c.label, CRED_TEXT_X, startY + 1.5, {
        width: contentWidth(doc) - (CRED_TEXT_X - PAGE_MARGIN_X),
      });
    if (c.detail) {
      doc
        .font("Helvetica")
        .fontSize(9.5)
        .fillColor(COLOR_MUTED)
        .text(c.detail, CRED_TEXT_X, doc.y, {
          width: contentWidth(doc) - (CRED_TEXT_X - PAGE_MARGIN_X),
        });
    }
    // Keep the row at least as tall as the badge.
    if (doc.y < startY + CRED_BADGE) doc.y = startY + CRED_BADGE;
    doc.moveDown(0.4);
  }
  doc.moveDown(0.5);
}

/** Draw the per-credential mark at (x, y): a licensed official logo image when
 *  one is mapped in credentialLogos.ts, otherwise a trademark-safe drawn
 *  badge — a category-coloured rounded square with a white checkmark. */
function drawCredentialMark(
  doc: PDFKit.PDFDocument,
  c: ResumeCredentialVM,
  x: number,
  y: number,
): void {
  const logoPath = resolveCredentialLogo(c.kind);
  if (logoPath) {
    try {
      // `fit` preserves the logo's aspect ratio inside the mark box and
      // centers it, so a square seal or a wide wordmark both render cleanly.
      doc.image(logoPath, x, y, {
        fit: [CRED_BADGE, CRED_BADGE],
        align: "center",
        valign: "center",
      });
      return;
    } catch {
      // Unreadable / unsupported image — fall through to the drawn badge.
    }
  }
  drawBadgeGlyph(doc, c.category, x, y);
}

/** A small filled rounded-square badge with a white checkmark — the
 *  trademark-safe "verified credential" mark. */
function drawBadgeGlyph(
  doc: PDFKit.PDFDocument,
  category: ResumeCredentialCategory,
  x: number,
  y: number,
): void {
  const s = CRED_BADGE;
  const fill = CATEGORY_COLOR[category];
  doc.save();
  doc.roundedRect(x, y, s, s, 3).fill(fill);
  // Checkmark.
  doc
    .strokeColor("#ffffff")
    .lineWidth(1.4)
    .lineJoin("round")
    .moveTo(x + s * 0.28, y + s * 0.52)
    .lineTo(x + s * 0.44, y + s * 0.68)
    .lineTo(x + s * 0.74, y + s * 0.32)
    .stroke();
  doc.restore();
}

// ─── Section: work experience ──────────────────────────────────────────────────

function drawWorkExperience(doc: PDFKit.PDFDocument, vm: ResumeViewModel): void {
  if (vm.workExperience.length === 0) return;
  sectionHeading(doc, "Professional Experience");

  for (const entry of vm.workExperience) {
    drawWorkEntry(doc, entry);
  }
}

function drawWorkEntry(doc: PDFKit.PDFDocument, entry: ResumeWorkEntryVM): void {
  // Reserve room for the title + company lines so a page-break doesn't
  // orphan an entry header from its body.
  ensureSpace(doc, 50);

  const titleLine = [entry.title, entry.company]
    .filter(Boolean)
    .join("  —  ");

  // Title (left) + date range (right) on the same baseline.
  const rowY = doc.y;
  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor(COLOR_TEXT)
    .text(titleLine, PAGE_MARGIN_X, rowY, {
      width: contentWidth(doc) - 130,
      continued: false,
    });
  if (entry.dateRange) {
    doc
      .font("Helvetica")
      .fontSize(9.5)
      .fillColor(COLOR_MUTED)
      .text(entry.dateRange, PAGE_MARGIN_X, rowY, {
        width: contentWidth(doc),
        align: "right",
      });
  }
  // Re-sync y to below the taller of the two columns.
  doc.y = Math.max(doc.y, rowY + 14);

  // Secondary line: location · employment type.
  const meta = [entry.location, entry.employmentType].filter(Boolean).join("  ·  ");
  if (meta) {
    doc
      .font("Helvetica-Oblique")
      .fontSize(9.5)
      .fillColor(COLOR_MUTED)
      .text(meta, PAGE_MARGIN_X, doc.y);
  }

  if (entry.description) {
    doc.moveDown(0.2);
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor(COLOR_TEXT)
      .text(entry.description, PAGE_MARGIN_X, doc.y, {
        width: contentWidth(doc),
        lineGap: 1.5,
      });
  }

  doc.moveDown(0.7);
}

// ─── Shared drawing helpers ────────────────────────────────────────────────────

function sectionHeading(doc: PDFKit.PDFDocument, label: string): void {
  ensureSpace(doc, 40);
  doc
    .font("Helvetica-Bold")
    .fontSize(11.5)
    .fillColor(COLOR_ACCENT)
    .text(label.toUpperCase(), PAGE_MARGIN_X, doc.y, {
      characterSpacing: 0.5,
    });
  doc.moveDown(0.25);
  const y = doc.y;
  doc
    .strokeColor(COLOR_RULE)
    .lineWidth(0.75)
    .moveTo(PAGE_MARGIN_X, y)
    .lineTo(doc.page.width - PAGE_MARGIN_X, y)
    .stroke();
  doc.moveDown(0.4);
}

function accentRule(doc: PDFKit.PDFDocument): void {
  const y = doc.y;
  doc
    .strokeColor(COLOR_ACCENT)
    .lineWidth(1.25)
    .moveTo(PAGE_MARGIN_X, y)
    .lineTo(doc.page.width - PAGE_MARGIN_X, y)
    .stroke();
}

function contentWidth(doc: PDFKit.PDFDocument): number {
  return doc.page.width - PAGE_MARGIN_X * 2;
}

/** Start a new page if fewer than `needed` points remain before the bottom. */
function ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
  if (doc.page.height - PAGE_MARGIN_BOTTOM - doc.y < needed) {
    doc.addPage();
  }
}
