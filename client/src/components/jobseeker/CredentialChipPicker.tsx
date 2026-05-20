// CredentialChipPicker — multi-select chip strip for the 14 canonical
// CredentialKind values (OTHER excluded). The onboarding wizard renders
// it on the Credentials step; the picker is intentionally label-only —
// expiry, license number, issuing authority all live in the post-
// onboarding profile editor.
//
// Visual palette mirrors CredentialBadge's "emerald" tone (the same
// colors a valid, in-date credential renders in) so the chips a seeker
// taps now match the chips they'll see later on their profile.
import type { CredentialKind } from "@shared/schema";
import { CREDENTIAL_LABEL } from "@/lib/credentialLabels";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

interface CredentialChipPickerProps {
  value: CredentialKind[];
  onChange(next: CredentialKind[]): void;
  disabled?: boolean;
}

// Render order — licenses first (clinical credibility), then DSP,
// admin/training, then clearances, then BLS-style certs. Matches the
// natural mental grouping in CredentialBadge's `LICENSE_KINDS` /
// `CLEARANCE_KINDS` sets.
const PICKER_ORDER: CredentialKind[] = [
  "CNA",
  "LVN",
  "RN",
  "MED_TECH",
  "DSP_YEAR_1",
  "DSP_YEAR_2",
  "RCFE_ADMIN",
  "ARF_ADMIN",
  "RCFE_40_HOUR",
  "MANDATED_REPORTER",
  "LIVE_SCAN",
  "TB",
  "CPR",
  "FIRST_AID",
];

export function CredentialChipPicker({
  value,
  onChange,
  disabled = false,
}: CredentialChipPickerProps) {
  const selectedSet = new Set(value);

  const toggle = (kind: CredentialKind) => {
    if (disabled) return;
    if (selectedSet.has(kind)) {
      onChange(value.filter((k) => k !== kind));
    } else {
      onChange([...value, kind]);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Credentials">
        {PICKER_ORDER.map((kind) => {
          const selected = selectedSet.has(kind);
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={selected}
              aria-label={CREDENTIAL_LABEL[kind]}
              disabled={disabled}
              onClick={() => toggle(kind)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                selected
                  ? // Mirror CredentialBadge's emerald tone — what they tap is
                    // what they'll see as a verified chip later.
                    "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                  : "bg-white text-stone-600 border-stone-200 hover:border-stone-300 hover:text-stone-800",
                disabled && "opacity-50 cursor-not-allowed",
              )}
            >
              {selected && <Check className="h-3 w-3" aria-hidden="true" />}
              <span>{CREDENTIAL_LABEL[kind]}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-stone-500">
        {value.length} selected
      </p>
    </div>
  );
}

export default CredentialChipPicker;
