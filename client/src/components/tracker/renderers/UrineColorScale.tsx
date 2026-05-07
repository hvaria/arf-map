/**
 * UrineColorScale — 7 colored swatch cards (clear → red) for the Toileting
 * tracker urine event type. Tap to select. The swatch is a colored circle
 * with hydration label + brief description.
 */
import { cn } from "@/lib/utils";
import {
  URINE_COLORS,
  URINE_COLOR_META,
  type UrineColor,
} from "@shared/tracker-schemas";

const CATEGORY_RING: Record<
  "good" | "ok" | "warning" | "alert",
  { ring: string; selectedRing: string; text: string }
> = {
  good: {
    ring: "ring-emerald-200",
    selectedRing: "ring-emerald-500",
    text: "text-emerald-800",
  },
  ok: {
    ring: "ring-amber-200",
    selectedRing: "ring-amber-500",
    text: "text-amber-800",
  },
  warning: {
    ring: "ring-orange-200",
    selectedRing: "ring-orange-500",
    text: "text-orange-800",
  },
  alert: {
    ring: "ring-red-300",
    selectedRing: "ring-red-500",
    text: "text-red-800",
  },
};

export function UrineColorScale({
  value,
  onChange,
  error,
}: {
  value: UrineColor | undefined;
  onChange: (next: UrineColor) => void;
  error?: string;
}) {
  return (
    <div className="space-y-2">
      <div
        role="radiogroup"
        aria-label="Urine color"
        className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5"
      >
        {URINE_COLORS.map((color) => {
          const meta = URINE_COLOR_META[color];
          const cls = CATEGORY_RING[meta.category];
          const selected = value === color;
          return (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${meta.title} — ${meta.description}`}
              onClick={() => onChange(color)}
              className={cn(
                "group relative flex flex-col items-center text-center rounded-lg border bg-white p-2.5 min-h-[148px] transition-all",
                "ring-1 ring-inset",
                cls.ring,
                "hover:-translate-y-0.5 hover:shadow-md",
                "active:scale-95",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-400",
                selected && "shadow-md -translate-y-0.5 ring-2",
                selected && cls.selectedRing,
              )}
            >
              <span
                className="block w-12 h-12 rounded-full border border-slate-300 shadow-inner mb-2"
                style={{ backgroundColor: meta.hex }}
                aria-hidden="true"
              />
              <p className={cn("text-xs font-semibold leading-tight", cls.text)}>
                {meta.title}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">
                {meta.description}
              </p>
              {selected && (
                <span
                  className={cn(
                    "absolute top-1.5 right-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-white text-[10px] font-bold animate-in fade-in zoom-in-50",
                    meta.category === "good" && "bg-emerald-500",
                    meta.category === "ok" && "bg-amber-500",
                    meta.category === "warning" && "bg-orange-500",
                    meta.category === "alert" && "bg-red-500",
                  )}
                  aria-hidden="true"
                >
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
