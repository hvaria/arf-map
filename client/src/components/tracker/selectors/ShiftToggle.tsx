/** Shift segmented control — AM | PM | NOC (+ optional OTHER). */
import { cn } from "@/lib/utils";
import type { Shift } from "@shared/tracker-schemas";

const STANDARD: Shift[] = ["AM", "PM", "NOC"];

export function ShiftToggle({
  value,
  onChange,
  includeOther = false,
  size = "md",
  ariaLabel = "Shift",
}: {
  value: Shift;
  onChange: (next: Shift) => void;
  includeOther?: boolean;
  size?: "sm" | "md";
  ariaLabel?: string;
}) {
  const options: Shift[] = includeOther ? [...STANDARD, "OTHER"] : STANDARD;
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center rounded-md border bg-white",
        size === "sm" ? "p-0.5" : "p-1",
      )}
    >
      {options.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt)}
            className={cn(
              "rounded-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
              size === "sm"
                ? "px-2 py-1 text-xs min-w-[44px]"
                : "px-3 py-1.5 text-sm min-w-[48px]",
              active
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-muted-foreground hover:bg-indigo-50",
            )}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

/** Derive a default shift from the current local time. */
export function deriveCurrentShift(now: Date = new Date()): Shift {
  const h = now.getHours();
  if (h >= 6 && h < 14) return "AM";
  if (h >= 14 && h < 22) return "PM";
  return "NOC";
}
