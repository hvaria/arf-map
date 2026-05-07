/** Tracker page header — title and primary action. */
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { resolveTrackerIcon } from "./trackerIcons";
import type {
  SerializedTrackerDefinition,
  TrackerCategory,
} from "@shared/tracker-schemas";

const CATEGORY_BADGE: Record<TrackerCategory, { bg: string; text: string }> = {
  "daily-care": { bg: "bg-indigo-100", text: "text-indigo-700" },
  "health-clinical": { bg: "bg-rose-100", text: "text-rose-700" },
  "safety-incidents": { bg: "bg-amber-100", text: "text-amber-700" },
  "resident-life": { bg: "bg-emerald-100", text: "text-emerald-700" },
  "facility-ops": { bg: "bg-sky-100", text: "text-sky-700" },
};

export function TrackerHeader({
  definition,
  onNewEntry,
}: {
  definition: SerializedTrackerDefinition;
  onNewEntry?: () => void;
}) {
  const Icon = resolveTrackerIcon(definition.icon);
  const cat = CATEGORY_BADGE[definition.category];
  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "h-11 w-11 rounded-md flex items-center justify-center transition-transform",
              cat.bg,
              cat.text,
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-tight">
              {definition.name}
            </h1>
            {definition.description && (
              <p className="text-sm text-muted-foreground mt-0.5">
                {definition.description}
              </p>
            )}
          </div>
        </div>
        {onNewEntry && (
          <Button
            size="sm"
            onClick={onNewEntry}
            className="gap-1.5 active:scale-95 transition-transform"
            aria-label={`Add new ${definition.name} entry`}
          >
            <Plus className="h-4 w-4" />
            New entry
          </Button>
        )}
      </div>
    </div>
  );
}
