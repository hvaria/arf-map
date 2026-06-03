# Resume credential logos

Drop **licensed** certification logo images here and they appear automatically
next to the matching credential on generated resumes. No code change is needed —
the renderer (`server/resume/resumeRenderer.ts` → `resolveCredentialLogo`) does a
convention lookup on every request.

## ⚠️ Trademark / licensing

Official certification marks (American Red Cross & American Heart Association for
CPR / First Aid, state nursing-board seals, CDPH registry marks, etc.) are
**trademarked**. This repository intentionally ships **no** such images.

**Only add a file here if you hold the rights or permission to use it.** Many of
these credentials (CNA, LVN, RN) are state-issued and have no single canonical
logo. Where no licensed logo is present, the resume draws a neutral,
trademark-safe category badge (a colored check-mark) instead — so the resume
always renders correctly with or without logos.

## Filename convention

Name each file after the credential **kind** in lowercase, with a `.png`,
`.jpg`, or `.jpeg` extension. Square / near-square images look best (they are
fit into a ~20px box, aspect ratio preserved).

| Credential kind | File to add |
|---|---|
| CNA | `cna.png` |
| LVN | `lvn.png` |
| RN | `rn.png` |
| RCFE_ADMIN | `rcfe_admin.png` |
| ARF_ADMIN | `arf_admin.png` |
| DSP_YEAR_1 | `dsp_year_1.png` |
| DSP_YEAR_2 | `dsp_year_2.png` |
| MED_TECH | `med_tech.png` |
| MANDATED_REPORTER | `mandated_reporter.png` |
| RCFE_40_HOUR | `rcfe_40_hour.png` |
| LIVE_SCAN | `live_scan.png` |
| TB | `tb.png` |
| CPR | `cpr.png` |
| FIRST_AID | `first_aid.png` |

For a non-standard path, add an explicit override in
`server/resume/credentialLogos.ts` (`CREDENTIAL_LOGO_PATH`) — it takes
precedence over this convention lookup.
