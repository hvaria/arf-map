/**
 * client/src/components/legal/Clickwrap.tsx
 *
 * Three-checkbox clickwrap block used by both registration forms
 * (job seeker + facility).
 *
 * Click-wrap pattern requires TWO actions from the user per doc:
 *   1) Open the doc (link target="_blank" — does NOT toggle the box).
 *   2) Actively check the box.
 *
 * The parent passes a single onChange that fires with the full triple
 * — disable the submit until all three are true. The component keeps its
 * own internal state so the parent never has to spell out three setters.
 */
import { useCallback, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { LEGAL_DOC_SLUGS, LEGAL_DOCS, type LegalDocSlug } from "@/lib/legal";

export interface ClickwrapAcceptance {
  acceptedTerms: boolean;
  acceptedPrivacy: boolean;
  acceptedAup: boolean;
}

export const EMPTY_ACCEPTANCE: ClickwrapAcceptance = {
  acceptedTerms: false,
  acceptedPrivacy: false,
  acceptedAup: false,
};

export function isFullyAccepted(a: ClickwrapAcceptance): boolean {
  return a.acceptedTerms && a.acceptedPrivacy && a.acceptedAup;
}

interface ClickwrapProps {
  /** Fires after every internal change with the merged state. */
  onChange: (state: ClickwrapAcceptance) => void;
  /** When true, render checkboxes disabled (e.g. while submitting). */
  disabled?: boolean;
  /** Extra container classes. */
  className?: string;
}

const FIELD_BY_SLUG: Record<LegalDocSlug, keyof ClickwrapAcceptance> = {
  terms: "acceptedTerms",
  privacy: "acceptedPrivacy",
  aup: "acceptedAup",
};

export function Clickwrap({ onChange, disabled, className }: ClickwrapProps) {
  const [state, setState] = useState<ClickwrapAcceptance>(EMPTY_ACCEPTANCE);

  const handleChange = useCallback(
    (slug: LegalDocSlug, checked: boolean) => {
      setState((prev) => {
        const next = { ...prev, [FIELD_BY_SLUG[slug]]: checked };
        onChange(next);
        return next;
      });
    },
    [onChange],
  );

  return (
    <div className={className ?? "space-y-2.5 pt-1"}>
      {LEGAL_DOC_SLUGS.map((slug) => {
        const meta = LEGAL_DOCS[slug];
        const field = FIELD_BY_SLUG[slug];
        const checked = state[field];
        const id = `clickwrap-${slug}`;
        return (
          <label
            key={slug}
            htmlFor={id}
            className="flex items-start gap-2.5 cursor-pointer select-none"
          >
            <Checkbox
              id={id}
              checked={checked}
              disabled={disabled}
              onCheckedChange={(v) => handleChange(slug, v === true)}
              aria-label={`I agree to the ${meta.title}`}
              className="mt-0.5"
            />
            <span className="text-xs text-muted-foreground leading-relaxed">
              I agree to the{" "}
              <a
                href={`#/legal/${slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary hover:underline"
                // Stop the label from toggling the box when the link is
                // clicked — click-wrap requires the user to take the box
                // action separately from opening the doc.
                onClick={(e) => e.stopPropagation()}
              >
                {meta.title}
              </a>
            </span>
          </label>
        );
      })}
    </div>
  );
}
