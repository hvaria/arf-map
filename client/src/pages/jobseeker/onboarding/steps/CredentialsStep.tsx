// CredentialsStep — wizard step 2. Multi-select chip picker over the 14
// canonical CredentialKinds (OTHER excluded — the wizard doesn't collect
// free-form labels). Skippable; "Next" is always enabled.
import type { CredentialKind } from "@shared/schema";
import { CredentialChipPicker } from "@/components/jobseeker/CredentialChipPicker";
import { Button } from "@/components/ui/button";
import { ChevronRight, ChevronLeft } from "lucide-react";

interface CredentialsStepValue {
  credentials: CredentialKind[];
}

interface CredentialsStepProps {
  value: CredentialsStepValue;
  onChange(next: CredentialsStepValue): void;
  onNext(): void;
  onBack(): void;
  onSkip?: () => void;
}

export function CredentialsStep({
  value,
  onChange,
  onNext,
  onBack,
}: CredentialsStepProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1" style={{ color: "#1E1B4B" }}>
          What credentials do you hold?
        </h2>
        <p className="text-sm text-stone-500">
          Tap each one that applies — you can edit the details later.
        </p>
      </div>

      <CredentialChipPicker
        value={value.credentials}
        onChange={(credentials) => onChange({ credentials })}
      />

      <div className="flex items-center gap-3 pt-2">
        <Button variant="outline" onClick={onBack} className="h-11 px-4">
          <ChevronLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <Button className="flex-1 h-11" onClick={onNext}>
          Next
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

export default CredentialsStep;
