/**
 * IncidentCard — shared header summary for an incident row.
 *
 * Two surfaces render this:
 *   1. IncidentsContent.tsx (operations sub-view) — wraps it inside a
 *      <button> that toggles an inline expanded panel; supplies its own
 *      status badge on the right (STATUS_COLORS palette) and uses this
 *      component only for the left column (type + severity + extras /
 *      meta line).
 *   2. ResidentProfileContent.tsx (resident profile incidents tab) —
 *      wraps it inside a static <div>; supplies a minimal outline
 *      status badge on the right and renders the description directly
 *      below this component.
 *
 * Canonical fields, per the unification brief: type (capitalize +
 * snake_case→space), severity badge (Serious / Non-Emergent — note the
 * hyphen + capitalization), meta line (date · time? · resident? ·
 * reporter), optional description with line-clamp-2. Extra inline
 * badges (e.g. "LIC 624 Required") are accepted via `extras` so the
 * operations row keeps its existing affordance without forking the
 * component.
 *
 * Why this is header-only: the operations row's expanded body carries
 * the entire checklist UI, edit dialog, audit trail, close/reopen
 * controls. Pulling that into a shared component would bloat the
 * resident tab and conflate two very different lifecycles. Header
 * markup is the only true overlap.
 */
import { cn } from "@/lib/utils";

export type IncidentSeverity = "serious" | "non_emergent" | null | undefined;

export interface IncidentCardProps {
  incidentType: string;
  incidentDate: number;
  /** Operations row supplies "HH:MM"; resident card omits. */
  incidentTime?: string | null;
  /** Shown in the meta line when present. */
  residentName?: string | null;
  reportedBy: string;
  /** Triggers the severity pill in the header. */
  severity?: IncidentSeverity;
  /** Inline body text. Falls back to omitted (operations row hides this). */
  description?: string | null;
  /**
   * Extra inline badges rendered alongside the severity pill (e.g.
   * "LIC 624 Required"). Kept as a slot so the operations sub-view can
   * keep its existing affordance without the resident card needing to
   * stub it out.
   */
  extras?: React.ReactNode;
  className?: string;
}

/**
 * Severity badge — hyphenated label ("Non-Emergent") and capitalized
 * "Serious" landed in the same commit batch as this extraction. Same
 * palette as the operations row pre-extraction so the optical weight
 * doesn't shift.
 */
function SeverityBadge({ severity }: { severity: NonNullable<IncidentSeverity> }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border",
        severity === "serious"
          ? "bg-red-100 text-red-700 border-red-200"
          : "bg-slate-100 text-slate-700 border-slate-200",
      )}
      data-testid="incident-severity-badge"
    >
      {severity === "serious" ? "Serious" : "Non-Emergent"}
    </span>
  );
}

export function IncidentCard({
  incidentType,
  incidentDate,
  incidentTime,
  residentName,
  reportedBy,
  severity,
  description,
  extras,
  className,
}: IncidentCardProps) {
  // Format the type the same way both surfaces did before — snake_case
  // becomes spaces, then capitalize via CSS so the legacy display is
  // pixel-identical.
  const typeLabel = incidentType?.replace(/_/g, " ") ?? "";
  const dateLabel = new Date(incidentDate).toLocaleDateString();

  return (
    <div className={cn("flex-1 min-w-0", className)}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium text-sm capitalize">{typeLabel}</span>
        {severity ? <SeverityBadge severity={severity} /> : null}
        {extras}
      </div>
      <p className="text-xs text-muted-foreground mt-0.5">
        {dateLabel}
        {incidentTime ? ` ${incidentTime}` : ""}
        {residentName ? ` · ${residentName}` : ""}
        {` · ${reportedBy}`}
      </p>
      {description ? (
        <p className="text-sm mt-1 line-clamp-2">{description}</p>
      ) : null}
    </div>
  );
}
