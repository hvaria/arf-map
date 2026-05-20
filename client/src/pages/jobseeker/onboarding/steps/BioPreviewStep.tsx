// BioPreviewStep — wizard step 4. Pre-fills the textarea via
// buildBio(credentials, yearsExperience, zipCode) so a seeker can either
// accept the template or edit it before saving. Whatever sits in the
// textarea at "Finish" time is what gets PUT to /api/jobseeker/profile.
//
// The shell owns the actual API call (single submit point); this step
// just hands its `bio` string back via onChange. The "Finish" button
// fires onNext, which the shell interprets as "submit".
import { useEffect, useRef } from "react";
import type { CredentialKind } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ChevronLeft, Sparkles, Loader2 } from "lucide-react";
import { buildBio } from "@/lib/bioTemplate";

interface BioPreviewStepValue {
  bio: string;
}

interface BioPreviewStepProps {
  value: BioPreviewStepValue;
  onChange(next: BioPreviewStepValue): void;
  onNext(): void;
  onBack(): void;
  onSkip?: () => void;
  /** Inputs used to seed the template if `value.bio` is still empty. */
  templateInputs: {
    credentials: CredentialKind[];
    yearsExperience: number | null;
    zipCode: string;
  };
  submitting?: boolean;
}

export function BioPreviewStep({
  value,
  onChange,
  onNext,
  onBack,
  templateInputs,
  submitting = false,
}: BioPreviewStepProps) {
  // Seed the textarea exactly once when the step first renders without
  // a pre-existing bio. Tracking with a ref (not value.bio in deps) so
  // the seed never re-runs after the user starts editing.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    if (value.bio && value.bio.trim().length > 0) {
      seededRef.current = true;
      return;
    }
    const draft = buildBio({
      credentials: templateInputs.credentials,
      yearsExperience: templateInputs.yearsExperience,
      zipCity: templateInputs.zipCode || null,
    });
    onChange({ bio: draft });
    seededRef.current = true;
    // Intentionally only on mount — re-seeding after user edits would
    // wipe their changes. The shell triggers a remount if the user goes
    // back to an earlier step and changes the inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const regenerate = () => {
    const fresh = buildBio({
      credentials: templateInputs.credentials,
      yearsExperience: templateInputs.yearsExperience,
      zipCity: templateInputs.zipCode || null,
    });
    onChange({ bio: fresh });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1" style={{ color: "#1E1B4B" }}>
          Here's a starter intro
        </h2>
        <p className="text-sm text-stone-500">
          Edit anything you'd like — facilities will see this when you express interest.
        </p>
      </div>

      <Textarea
        rows={6}
        value={value.bio}
        onChange={(e) => onChange({ bio: e.target.value })}
        className="text-sm leading-relaxed"
        placeholder="Tell facilities a little about yourself…"
      />

      <button
        type="button"
        onClick={regenerate}
        disabled={submitting}
        className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:underline disabled:opacity-50"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Regenerate from my selections
      </button>

      <div className="flex items-center gap-3 pt-2">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={submitting}
          className="h-11 px-4"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <Button
          className="flex-1 h-11"
          onClick={onNext}
          disabled={submitting || value.bio.trim().length === 0}
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              Saving…
            </>
          ) : (
            "Finish"
          )}
        </Button>
      </div>
    </div>
  );
}

export default BioPreviewStep;
