// Official-logo resolution for credential marks in the resume PDF.
//
// ── TRADEMARK / LICENSING NOTICE ─────────────────────────────────────────────
// Official certification marks (American Red Cross & American Heart Association
// for CPR / First Aid, state nursing-board seals, CDPH registry marks, etc.)
// are TRADEMARKED. This project ships NO such images. You may only place a logo
// file here if you hold the rights/permission to use it. Many of these
// credentials (CNA, LVN, RN) are state-issued and have no single canonical
// logo at all. Where no licensed logo is present, the renderer draws a
// trademark-safe category badge instead.
//
// ── HOW TO ADD A LOGO ────────────────────────────────────────────────────────
// Drop an image (PNG or JPG) into `server/resume/assets/` named after the
// credential kind in lowercase — e.g.:
//     server/resume/assets/cpr.png          → used for CPR
//     server/resume/assets/first_aid.png    → used for First Aid
//     server/resume/assets/cna.png          → used for CNA
// The renderer picks it up automatically on the next request. No code change.
// (Full kind list: cna, lvn, rn, rcfe_admin, arf_admin, dsp_year_1,
//  dsp_year_2, med_tech, mandated_reporter, rcfe_40_hour, live_scan, tb,
//  cpr, first_aid, other.)
//
// For a non-conventional path, add an explicit override in CREDENTIAL_LOGO_PATH
// below; it takes precedence over the convention lookup.

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { CredentialKind } from "@shared/schema";

const ASSETS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "assets",
);

/** Optional explicit overrides — keyed by CredentialKind, absolute path to a
 *  licensed image. Empty by default; the convention lookup covers most cases. */
export const CREDENTIAL_LOGO_PATH: Partial<Record<CredentialKind, string>> = {};

const LOGO_EXTS = [".png", ".jpg", ".jpeg"] as const;

/**
 * Resolve the official logo file for a credential kind, or null if none is
 * configured/present (→ the renderer falls back to the drawn badge).
 *
 * Precedence: explicit override → convention file `assets/<kind>.<ext>`.
 */
export function resolveCredentialLogo(kind: string): string | null {
  const override = CREDENTIAL_LOGO_PATH[kind as CredentialKind];
  if (override && existsSync(override)) return override;

  const base = kind.toLowerCase();
  for (const ext of LOGO_EXTS) {
    const candidate = path.join(ASSETS_DIR, `${base}${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
