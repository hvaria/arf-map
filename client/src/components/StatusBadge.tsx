import { cn } from "@/lib/utils";

type InterestStatus = "pending" | "viewed" | "shortlisted";

// Operator tone palette (EmarContent / ComplianceContent reference):
//   blue    = pending / waiting on action
//   slate   = info / neutral (viewed but no action yet)
//   emerald = ok / positive outcome (shortlisted)
// Class shape mirrors the canonical operator status badge:
//   bg-{tone}-100 text-{tone}-700 border-{tone}-200
const CONFIG: Record<InterestStatus, { label: string; className: string }> = {
  pending:     { label: "Pending",     className: "bg-blue-100 text-blue-700 border-blue-200"          },
  viewed:      { label: "Viewed",      className: "bg-slate-100 text-slate-700 border-slate-200"       },
  shortlisted: { label: "Shortlisted", className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
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
