/** Landing-page card for a single tracker definition. */
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertOctagon } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveTrackerIcon } from "./trackerIcons";
import type { SerializedTrackerDefinition } from "@shared/tracker-schemas";

// Per-slug palette — each tracker gets a distinct vibrant circular icon
// background. Matches the CaringData visual language: a colored avatar-style
// circle on the left + tracker name on the right. The colors are picked to
// be visually distinct, not category-coded — the category eyebrow text on
// the card already carries that classification.
const SLUG_PALETTE: Record<string, string> = {
  adl:        "bg-indigo-500",
  vitals:     "bg-rose-500",
  toileting:  "bg-orange-500",
  hygiene:    "bg-amber-500",
  skin_check: "bg-pink-500",
  seizure:    "bg-violet-500",
  sleep:      "bg-blue-500",
  inventory:  "bg-emerald-500",
  cleaning:   "bg-cyan-500",
};

// Stable fallback for trackers we haven't explicitly colored — hashes the
// slug to one of a small palette so new trackers get a deterministic color
// without us having to update this file.
const FALLBACK_COLORS = [
  "bg-teal-500",
  "bg-fuchsia-500",
  "bg-sky-500",
  "bg-lime-500",
  "bg-stone-500",
];
function fallbackColor(slug: string): string {
  let hash = 0;
  for (let i = 0; i < slug.length; i += 1) {
    hash = (hash * 31 + slug.charCodeAt(i)) >>> 0;
  }
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

export function TrackerCard({
  definition,
  onSelect,
  activeAlertCount = 0,
}: {
  definition: SerializedTrackerDefinition;
  onSelect: (slug: string) => void;
  /** Active alerts for this tracker. Shown as a red badge when > 0. */
  activeAlertCount?: number;
}) {
  const Icon = resolveTrackerIcon(definition.icon);
  const bg = SLUG_PALETTE[definition.slug] ?? fallbackColor(definition.slug);
  const hasAlerts = activeAlertCount > 0;
  return (
    <button
      type="button"
      onClick={() => onSelect(definition.slug)}
      className={cn(
        "block w-full text-left rounded-lg",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary",
      )}
      aria-label={
        hasAlerts
          ? `Open ${definition.name} tracker — ${activeAlertCount} active alert${activeAlertCount === 1 ? "" : "s"}`
          : `Open ${definition.name} tracker`
      }
    >
      <Card
        className={cn(
          "transition-all",
          "hover:border-stone-300 hover:shadow-sm",
        )}
      >
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "h-12 w-12 rounded-full flex items-center justify-center shrink-0 text-white",
                bg,
              )}
              aria-hidden="true"
            >
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold text-stone-900 line-clamp-2 leading-snug">
                {definition.name}
              </p>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mt-1">
                {definition.category.replace(/-/g, " ")}
              </p>
            </div>
            {hasAlerts && (
              <Badge
                variant="outline"
                className="h-5 text-[10px] font-semibold tabular-nums gap-1 bg-red-100 text-red-700 border-red-200 shrink-0"
              >
                <AlertOctagon className="h-3 w-3" aria-hidden="true" />
                {activeAlertCount}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </button>
  );
}
