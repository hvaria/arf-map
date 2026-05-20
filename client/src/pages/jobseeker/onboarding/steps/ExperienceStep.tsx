// ExperienceStep — wizard step 3. 4-bucket slider that maps to an
// integer midpoint stored as `yearsExperience`:
//   index 0 → 0  ("Just starting")
//   index 1 → 1  ("1–2 years")
//   index 2 → 3  ("3–4 years")
//   index 3 → 5  ("5+ years")
//
// The slider itself uses min=0, max=3, step=1 — the index is converted
// to a stored value via BUCKET_VALUES on every change. This keeps the
// downstream bio template (which discriminates 0, 1, 2–4, 5+) honest.
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { ChevronRight, ChevronLeft } from "lucide-react";

const BUCKET_VALUES = [0, 1, 3, 5] as const;
const BUCKET_LABELS = [
  "Just starting",
  "1–2 years",
  "3–4 years",
  "5+ years",
] as const;

interface ExperienceStepValue {
  yearsExperience: number | null;
}

interface ExperienceStepProps {
  value: ExperienceStepValue;
  onChange(next: ExperienceStepValue): void;
  onNext(): void;
  onBack(): void;
  onSkip?: () => void;
}

function valueToIndex(years: number | null): number {
  if (years === null) return 0;
  // Map any stored value back to the nearest bucket index — defensive
  // against future drift in BUCKET_VALUES.
  const exact = BUCKET_VALUES.indexOf(years as (typeof BUCKET_VALUES)[number]);
  if (exact !== -1) return exact;
  // Fallback: ascending search for the closest bucket.
  let best = 0;
  let bestDist = Infinity;
  BUCKET_VALUES.forEach((v, i) => {
    const d = Math.abs(v - years);
    if (d < bestDist) {
      best = i;
      bestDist = d;
    }
  });
  return best;
}

export function ExperienceStep({
  value,
  onChange,
  onNext,
  onBack,
}: ExperienceStepProps) {
  const idx = valueToIndex(value.yearsExperience);
  const label = BUCKET_LABELS[idx];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1" style={{ color: "#1E1B4B" }}>
          How much care experience do you have?
        </h2>
        <p className="text-sm text-stone-500">
          A rough range is fine — facilities use this to filter their matches.
        </p>
      </div>

      <div className="space-y-4 px-1">
        <div className="text-center">
          <p className="text-3xl font-bold" style={{ color: "#1E1B4B" }}>
            {label}
          </p>
        </div>

        <Slider
          min={0}
          max={3}
          step={1}
          value={[idx]}
          onValueChange={(vals) => {
            const i = vals[0] ?? 0;
            onChange({ yearsExperience: BUCKET_VALUES[i] });
          }}
        />

        <div className="flex justify-between text-[10px] uppercase tracking-wide text-stone-400">
          {BUCKET_LABELS.map((bl) => (
            <span key={bl}>{bl}</span>
          ))}
        </div>
      </div>

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

export default ExperienceStep;
