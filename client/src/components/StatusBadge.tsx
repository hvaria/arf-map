import { cn } from "@/lib/utils";

type InterestStatus = "pending" | "viewed" | "shortlisted";

const CONFIG: Record<InterestStatus, { label: string; className: string }> = {
  pending:     { label: "Pending",     className: "bg-[#FEF9C3] text-[#92400E] border-[#FDE68A]"  },
  viewed:      { label: "Viewed",      className: "bg-[#F0F4FF] text-[#4F46E5] border-[#E0E7FF]"  },
  shortlisted: { label: "Shortlisted", className: "bg-[#D1FAE5] text-[#065F46] border-[#BBF7D0]"  },
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
