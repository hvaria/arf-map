/** Landing-page card for a single tracker definition. */
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight } from "lucide-react";
import { resolveTrackerIcon } from "./trackerIcons";
import type { SerializedTrackerDefinition } from "@shared/tracker-schemas";

export function TrackerCard({
  definition,
  onSelect,
}: {
  definition: SerializedTrackerDefinition;
  onSelect: (slug: string) => void;
}) {
  const Icon = resolveTrackerIcon(definition.icon);
  return (
    <button
      type="button"
      onClick={() => onSelect(definition.slug)}
      className="block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded-lg"
      aria-label={`Open ${definition.name} tracker`}
    >
      <Card className="border-l-4 border-l-indigo-400 transition-all hover:shadow-md hover:-translate-y-0.5">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-md bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
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
