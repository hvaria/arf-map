/** Landing-page card for a single tracker definition. */
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveTrackerIcon } from "./trackerIcons";
import type {
  SerializedTrackerDefinition,
  TrackerCategory,
} from "@shared/tracker-schemas";

const CATEGORY_THEME: Record<
  TrackerCategory,
  { borderL: string; iconBg: string; iconText: string }
> = {
  "daily-care": {
    borderL: "border-l-indigo-400",
    iconBg: "bg-indigo-100",
    iconText: "text-indigo-700",
  },
  "health-clinical": {
    borderL: "border-l-rose-400",
    iconBg: "bg-rose-100",
    iconText: "text-rose-700",
  },
  "safety-incidents": {
    borderL: "border-l-amber-400",
    iconBg: "bg-amber-100",
    iconText: "text-amber-700",
  },
  "resident-life": {
    borderL: "border-l-emerald-400",
    iconBg: "bg-emerald-100",
    iconText: "text-emerald-700",
  },
  "facility-ops": {
    borderL: "border-l-sky-400",
    iconBg: "bg-sky-100",
    iconText: "text-sky-700",
  },
};

export function TrackerCard({
  definition,
  onSelect,
}: {
  definition: SerializedTrackerDefinition;
  onSelect: (slug: string) => void;
}) {
  const Icon = resolveTrackerIcon(definition.icon);
  const theme = CATEGORY_THEME[definition.category];
  return (
    <button
      type="button"
      onClick={() => onSelect(definition.slug)}
      className={cn(
        "block w-full text-left rounded-lg",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-400",
        "active:scale-[0.98]",
      )}
      aria-label={`Open ${definition.name} tracker`}
    >
      <Card
        className={cn(
          "border-l-4 transition-all",
          theme.borderL,
          "hover:shadow-md hover:-translate-y-0.5",
          "min-h-[112px]",
        )}
      >
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "h-11 w-11 rounded-md flex items-center justify-center shrink-0 transition-transform group-hover:scale-105",
                theme.iconBg,
                theme.iconText,
              )}
            >
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold truncate">
                  {definition.name}
                </p>
                <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </div>
              {definition.description && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {definition.description}
                </p>
              )}
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mt-2">
                {definition.category.replace(/-/g, " ")}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </button>
  );
}
