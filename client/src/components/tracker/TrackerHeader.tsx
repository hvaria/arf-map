/** Tracker page header — title and primary action. */
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resolveTrackerIcon } from "./trackerIcons";
import type { SerializedTrackerDefinition } from "@shared/tracker-schemas";

export function TrackerHeader({
  definition,
  onNewEntry,
}: {
  definition: SerializedTrackerDefinition;
  onNewEntry?: () => void;
}) {
  const Icon = resolveTrackerIcon(definition.icon);
  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-md bg-indigo-100 text-indigo-700 flex items-center justify-center">
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
            className="gap-1.5"
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
