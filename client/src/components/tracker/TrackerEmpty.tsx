/** Reusable empty state for tracker surfaces. */
import { Inbox } from "lucide-react";

export function TrackerEmpty({
  title,
  hint,
  icon: Icon = Inbox,
}: {
  title: string;
  hint?: string;
  icon?: React.ElementType;
}) {
  return (
    <div className="rounded-md border border-dashed py-10 px-4 text-center">
      <Icon className="h-7 w-7 text-muted-foreground mx-auto mb-2" />
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}
