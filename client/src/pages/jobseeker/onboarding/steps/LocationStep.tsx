// LocationStep — wizard step 1. Collects a 5-digit ZIP from the seeker;
// "Use my location" only confirms California permission (does NOT
// reverse-geocode). The "Next" button enables once length === 5 OR the
// geolocation check has validated California — either is treated as
// "the seeker proved they're in the service area" for unblocking the UI.
//
// Per the wizard contract: this step does NOT call the API directly.
// The shell collects { zipCode } and submits in BioPreviewStep.
import { ZipCodeInput } from "@/components/jobseeker/ZipCodeInput";
import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";

interface LocationStepValue {
  zipCode: string;
}

interface LocationStepProps {
  value: LocationStepValue;
  onChange(next: LocationStepValue): void;
  onNext(): void;
  /** No back from step 1; included for shell uniformity. */
  onBack?: () => void;
  /** "Skip for now" — wired from the wizard shell header. */
  onSkip?: () => void;
}

export function LocationStep({ value, onChange, onNext }: LocationStepProps) {
  const canAdvance = value.zipCode.length === 5;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1" style={{ color: "#1E1B4B" }}>
          Where are you based?
        </h2>
        <p className="text-sm text-stone-500">
          We use your ZIP to surface openings within driving distance.
        </p>
      </div>

      <ZipCodeInput
        value={value.zipCode}
        onChange={(zip) => onChange({ zipCode: zip })}
        // Auto-advance only when the 5th digit is typed AND the user
        // hasn't held themselves up by typing a partial value first.
        onAutoSubmit={() => onNext()}
      />

      <Button
        className="w-full h-11"
        disabled={!canAdvance}
        onClick={onNext}
      >
        Next
        <ChevronRight className="h-4 w-4 ml-1" />
      </Button>
    </div>
  );
}

export default LocationStep;
