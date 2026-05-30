import { cn } from "@/lib/utils";

type InterestStatus = "pending" | "viewed" | "shortlisted" | "rejected" | "archived";

// Operator tone palette (EmarContent / ComplianceContent reference):
//   blue    = pending / waiting on action
//   slate   = info / neutral (viewed but no action yet)
//   emerald = ok / positive outcome (shortlisted)
//   red     = negative outcome (rejected)
//   zinc    = removed from active pipeline (archived)
// Class shape mirrors the canonical operator status badge:
//   bg-{tone}-100 text-{tone}-700 border-{tone}-200
const CONFIG: Record<InterestStatus, { label: string; className: string }> = {
  pending:     { label: "Pending",     className: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900"             },
  viewed:      { label: "Viewed",      className: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700"      },
  shortlisted: { label: "Shortlisted", className: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900" },
  rejected:    { label: "Rejected",    className: "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900"                  },
  archived:    { label: "Archived",    className: "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800/60 dark:text-zinc-400 dark:border-zinc-700"            },
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
