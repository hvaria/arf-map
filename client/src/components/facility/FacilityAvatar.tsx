/**
 * <FacilityAvatar> — read-only circular avatar for the CUSTOMER FACILITY's
 * own logo. Used in the FacilityPortal page header next to the facility
 * name to give each operator their own brand identity in the portal chrome.
 *
 * This is NOT the arf-map app brand mark (the "Neighbourhood Care Finder"
 * wordmark at the top-left of every page) — that lives in
 * `client/src/components/BrandLogo.tsx` and is explicitly out of scope.
 * The two concepts share the word "logo" but are different surfaces:
 *   - BrandLogo: product chrome (one identity, shared by every customer).
 *   - FacilityAvatar: per-facility identity, fetched from the same
 *     /api/facility/profile/logo endpoint as the upload preview.
 *
 * Pattern citations (Implementation Contract §2.5):
 *   - Logo preview shape + image alt copy mirrors the upload widget's
 *     preview tile:
 *       client/src/components/facility/LogoUpload.tsx:128-145
 *   - Cache-busting `?t=<logoUpdatedAt>` convention is owned by the
 *     consumer and pre-computed exactly the same way as in
 *     FacilityDetailsTab:
 *       client/src/components/facility/FacilityDetailsTab.tsx:336-338
 *   - Circular avatar primitive (radix-based) — not used directly here
 *     because the design called for raw <img> + initials fallback with
 *     a deterministic 2-char rule; primitive lives at
 *       client/src/components/ui/avatar.tsx
 *     for callers that want the shadcn default.
 */
import { cn } from "@/lib/utils";

interface Props {
  /**
   * URL to render. Pass null to fall back to deterministic initials.
   * Callers should append `?t=<logoUpdatedAt>` so a fresh upload
   * triggers a re-fetch by the browser (same convention as
   * <LogoUpload>'s `currentLogoUrl`).
   */
  logoUrl: string | null;
  /** Facility display name — drives the initials fallback and image alt. */
  facilityName: string;
  /** sm=24px, md=40px (default), lg=64px. */
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE_PX: Record<NonNullable<Props["size"]>, number> = {
  sm: 24,
  md: 40,
  lg: 64,
};

// Conservative joiner-word skip list. Kept short and lowercase; words are
// matched case-insensitively after stripping punctuation. This mirrors the
// natural human reading of a brand: "DAVID & TERRIE'S HOME" → "DT",
// "ABC PHARMACY" → "AP", "Heart of the City" → "HC".
const JOINER_WORDS = new Set([
  "&",
  "and",
  "of",
  "the",
  "a",
  "an",
  "for",
  "to",
  "at",
]);

/**
 * Extract up to two initials from a facility name, skipping common joiner
 * words. Strips leading punctuation per word (e.g. "&" → "" and is
 * excluded; "Terrie's" → "T").
 *
 * Rule: take the first letter of the first TWO significant tokens. A
 * single-word name yields one letter. Joiner words like "&", "and",
 * "of", "the" are skipped before tokens are counted, so
 * "DAVID & TERRIE'S HOME" → "DT" (first + second significant token).
 */
export function facilityInitials(name: string): string {
  if (!name) return "";
  // Strip leading non-alphanumeric chars from each token (e.g. "&", "'",
  // quotes). Kept ASCII-safe so the regex doesn't require the `u` flag —
  // which would force a higher TS target than the rest of the repo uses.
  const significant = name
    .split(/\s+/)
    .map((w) => w.replace(/^[^A-Za-z0-9]+/, ""))
    .filter((w) => w.length > 0 && !JOINER_WORDS.has(w.toLowerCase()));
  if (significant.length === 0) return "";
  if (significant.length === 1) {
    return significant[0].charAt(0).toUpperCase();
  }
  return (
    significant[0].charAt(0).toUpperCase() +
    significant[1].charAt(0).toUpperCase()
  );
}

export function FacilityAvatar({
  logoUrl,
  facilityName,
  size = "md",
  className,
}: Props) {
  const px = SIZE_PX[size];
  const sizeStyle = { width: px, height: px };

  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={facilityName}
        className={cn(
          "shrink-0 rounded-full object-cover border border-black/10 bg-stone-50",
          className,
        )}
        style={sizeStyle}
        data-testid="facility-avatar-image"
      />
    );
  }

  const initials = facilityInitials(facilityName);
  return (
    <div
      aria-hidden="true"
      className={cn(
        "shrink-0 inline-flex items-center justify-center rounded-full",
        "bg-primary/10 text-primary font-semibold border border-black/5 select-none",
        size === "sm" && "text-[10px]",
        size === "md" && "text-sm",
        size === "lg" && "text-lg",
        className,
      )}
      style={sizeStyle}
      data-testid="facility-avatar-initials"
    >
      {initials}
    </div>
  );
}
