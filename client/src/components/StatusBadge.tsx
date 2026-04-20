// NEW: expression-of-interest — shared status badge for pending/viewed/shortlisted
import { cn } from "@/lib/utils";

type InterestStatus = "pending" | "viewed" | "shortlisted";

const CONFIG: Record<InterestStatus, { label: string; className: string }> = {
  pending:     { label: "Pending",     className: "bg-amber-50  text-amber-700  border-amber-200  dark:bg-amber-950/40  dark:text-amber-400  dark:border-amber-800"  },
  viewed:      { label: "Viewed",      className: "bg-blue-50   text-blue-700   border-blue-200   dark:bg-blue-950/40   dark:text-blue-400   dark:border-blue-800"   },
  shortlisted: { label: "Shortlisted", className: "bg-yellow-50 text-yellow-700 border-yellow-300 dark:bg-yellow-950/40 dark:text-yellow-400 dark:border-yellow-800" },
};

interface Props {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: Props) {
  const cfg = CONFIG[status as InterestStatus] ?? CONFIG.pending;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        cfg.className,
        className
      )}
    >
      {cfg.label}
    </span>
  );
}
