import { useMemo } from "react";
import type { Facility } from "@shared/schema";

interface StatsBarProps {
  facilities: Facility[];
}

export function StatsBar({ facilities }: StatsBarProps) {
  const stats = useMemo(() => {
    const licensed = facilities.filter((f) => f.status === "LICENSED").length;
    const totalCapacity = facilities.reduce((sum, f) => sum + (f.capacity || 0), 0);
    const withDeficiencies = facilities.filter((f) => f.totalTypeB > 0).length;
    const hiring = facilities.filter((f) => f.isHiring).length;
    return { licensed, totalCapacity, withDeficiencies, hiring };
  }, [facilities]);

  return (
    <div className="flex items-center gap-4 bg-background/95 backdrop-blur-sm rounded-lg px-4 py-2.5 shadow-lg border border-border/60" data-testid="stats-bar">
      <Stat label="Licensed" value={stats.licensed} />
      <div className="w-px h-6 bg-border" />
      <Stat label="Total Capacity" value={stats.totalCapacity.toLocaleString()} />
      <div className="w-px h-6 bg-border" />
      <Stat label="Hiring" value={stats.hiring} highlight />
      <div className="w-px h-6 bg-border" />
      <Stat label="w/ Type B" value={stats.withDeficiencies} alert={stats.withDeficiencies > 0} />
    </div>
  );
}

function Stat({ label, value, alert, highlight }: { label: string; value: string | number; alert?: boolean; highlight?: boolean }) {
  return (
    <div className="text-center">
      <div className={`text-sm font-semibold ${alert ? "text-red-600 dark:text-red-400" : highlight ? "text-blue-600 dark:text-blue-400" : "text-foreground"}`}>
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
