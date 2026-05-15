import { useWorkExperience } from "@/components/seeker/WorkExperienceSection";

// ─── Date helpers (kept local — file-scoped duplicates of the editor's
// helpers so this component has no runtime dependency on the editor besides
// the shared query hook. Keeping them small + identical sidesteps the cost
// of a third "seeker date utils" module for two tiny functions.) ────────────

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatYearMonth(ym: string): string {
  // Deliberately avoids `new Date("YYYY-MM")` — that path parses as UTC
  // midnight and can roll the month backwards in negative-offset zones.
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(ym);
  if (!m) return ym;
  return `${MONTH_NAMES[parseInt(m[2], 10) - 1]} ${m[1]}`;
}

function formatRange(start: string, end: string | null): string {
  const left = formatYearMonth(start);
  const right = end ? formatYearMonth(end) : "Present";
  return `${left} — ${right}`;
}

/**
 * WorkExperienceTimeline — read-only LinkedIn-ish vertical timeline rendered
 * on SeekerProfileCard. Reuses `useWorkExperience()` so a save in the editor
 * reflects here immediately via the shared TanStack Query cache.
 *
 * Renders NOTHING when the list is empty — the empty state lives in the
 * editor; the read card should add zero noise.
 */
export default function WorkExperienceTimeline() {
  const { data } = useWorkExperience();
  const list = data ?? [];

  if (list.length === 0) return null;

  return (
    <ul className="space-y-3">
      {list.map((row, idx) => {
        const isCurrent = !row.endDate;
        const isLast = idx === list.length - 1;
        return (
          <li
            key={row.id}
            className={`relative pl-6 ${
              // Vertical connector line. Suppressed on the final row so the
              // line doesn't extend past the last dot.
              isLast
                ? ""
                : "before:absolute before:left-[5px] before:top-3 before:bottom-[-12px] before:w-px before:bg-stone-200"
            }`}
          >
            {/* Dot. Warm portal-accent for current roles, neutral stone
                otherwise. */}
            <span
              className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white"
              style={{
                background: isCurrent ? "var(--portal-accent)" : "#A8A29E",
              }}
              aria-hidden="true"
            />
            <p className="text-sm font-semibold text-stone-900 leading-tight">
              {row.title}
            </p>
            <p className="text-xs text-muted-foreground leading-tight mt-0.5">
              {row.company}
              {row.location ? ` · ${row.location}` : ""}
            </p>
            <p className="text-xs text-muted-foreground portal-num leading-tight mt-0.5">
              {formatRange(row.startDate, row.endDate)}
              {row.employmentType ? ` · ${row.employmentType}` : ""}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
