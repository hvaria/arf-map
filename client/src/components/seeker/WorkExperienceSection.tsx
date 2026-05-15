import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Calendar,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  Briefcase,
} from "lucide-react";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type {
  EmploymentType,
  JobSeekerWorkExperience,
  WorkExperienceInput,
} from "@shared/schema";

// ─── Constants ────────────────────────────────────────────────────────────────

const EMPLOYMENT_TYPES: EmploymentType[] = [
  "Full-time",
  "Part-time",
  "Per-diem",
  "On-call",
  "Contract",
  "Volunteer",
];

// Sentinel value for the shadcn Select "Not set" option. The shadcn primitive
// rejects empty-string values, so we route "no selection" through a distinct
// token and translate it back to `undefined` at submit time.
const EMPLOYMENT_TYPE_UNSET = "__unset__";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// ─── Date helpers ────────────────────────────────────────────────────────────

/**
 * Convert a YYYY-MM string to "Mon YYYY" (e.g. "2024-01" → "Jan 2024").
 *
 * We deliberately split + look up the month from a constant array instead of
 * `new Date("2024-01").toLocaleString()` — that path is timezone-sensitive
 * (the date string parses as UTC midnight, then `.toLocaleString()` shifts to
 * the viewer's tz, which can roll the month backwards in negative offsets).
 */
function formatYearMonth(ym: string): string {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(ym);
  if (!m) return ym;
  const year = m[1];
  const monthIdx = parseInt(m[2], 10) - 1;
  return `${MONTH_NAMES[monthIdx]} ${year}`;
}

/**
 * Compute a "X yr Y mo" duration between two YYYY-MM strings. If `end` is
 * omitted (current role), measure against the current month. Skips any zero
 * component: "0 yr 7 mo" → "7 mo".
 */
function formatDuration(start: string, end: string | null): string {
  const sm = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(start);
  if (!sm) return "";
  const startTotal = parseInt(sm[1], 10) * 12 + (parseInt(sm[2], 10) - 1);

  let endTotal: number;
  if (end) {
    const em = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(end);
    if (!em) return "";
    endTotal = parseInt(em[1], 10) * 12 + (parseInt(em[2], 10) - 1);
  } else {
    const now = new Date();
    endTotal = now.getFullYear() * 12 + now.getMonth();
  }

  // Inclusive of both bookends — "Jan 2024 → Jan 2024" reads as "1 mo".
  let months = endTotal - startTotal + 1;
  if (months < 1) months = 1;

  const years = Math.floor(months / 12);
  const remMonths = months % 12;

  if (years === 0) return `${remMonths} mo`;
  if (remMonths === 0) return `${years} yr`;
  return `${years} yr ${remMonths} mo`;
}

function formatRange(start: string, end: string | null): string {
  const left = formatYearMonth(start);
  const right = end ? formatYearMonth(end) : "Present";
  const duration = formatDuration(start, end);
  return duration ? `${left} — ${right} · ${duration}` : `${left} — ${right}`;
}

// ─── Shared query hook ────────────────────────────────────────────────────────

/**
 * Shared TanStack Query hook for the seeker's work-experience list. Used by
 * both the editor (this file) and the read-only timeline on the dashboard
 * card so a save here immediately reflects there without a manual refetch.
 */
export function useWorkExperience({
  enabled,
}: { enabled?: boolean } = {}) {
  return useQuery<JobSeekerWorkExperience[]>({
    queryKey: ["/api/jobseeker/work-experience"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 60_000,
    enabled: enabled !== false,
  });
}

// ─── Form state ───────────────────────────────────────────────────────────────

interface FormState {
  title: string;
  company: string;
  location: string;
  employmentType: EmploymentType | typeof EMPLOYMENT_TYPE_UNSET;
  startDate: string;
  endDate: string;
  currentlyWorking: boolean;
  description: string;
}

const EMPTY_FORM: FormState = {
  title: "",
  company: "",
  location: "",
  employmentType: EMPLOYMENT_TYPE_UNSET,
  startDate: "",
  endDate: "",
  currentlyWorking: false,
  description: "",
};

function fromRow(row: JobSeekerWorkExperience): FormState {
  return {
    title: row.title ?? "",
    company: row.company ?? "",
    location: row.location ?? "",
    employmentType:
      (row.employmentType as EmploymentType | null) ?? EMPLOYMENT_TYPE_UNSET,
    startDate: row.startDate ?? "",
    endDate: row.endDate ?? "",
    currentlyWorking: !row.endDate,
    description: row.description ?? "",
  };
}

function toPayload(form: FormState): WorkExperienceInput {
  const trim = (s: string) => (s.trim() === "" ? undefined : s.trim());
  return {
    title: form.title.trim(),
    company: form.company.trim(),
    location: trim(form.location),
    employmentType:
      form.employmentType === EMPLOYMENT_TYPE_UNSET
        ? undefined
        : form.employmentType,
    startDate: form.startDate,
    endDate: form.currentlyWorking ? undefined : trim(form.endDate),
    description: trim(form.description),
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

type FormMode =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; id: number };

/**
 * WorkExperienceSection — inline editor for the seeker's LinkedIn-style work
 * history. Rendered inside SeekerProfileEditor between Credentials and the
 * bottom action row. Visual + interaction language mirrors CredentialsSection
 * (portal-eyebrow heading, gradient primary action, single inline form for
 * both create + edit, no nested dialogs).
 */
export default function WorkExperienceSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading, isError } = useWorkExperience();
  const list = data ?? [];

  const [mode, setMode] = useState<FormMode>({ kind: "closed" });
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [dateError, setDateError] = useState<string | null>(null);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["/api/jobseeker/work-experience"] });

  const createMut = useMutation({
    mutationFn: (input: WorkExperienceInput) =>
      apiRequest("POST", "/api/jobseeker/work-experience", input),
    onSuccess: () => {
      invalidate();
      toast({ title: "Work experience added" });
      setMode({ kind: "closed" });
      setForm(EMPTY_FORM);
      setDateError(null);
    },
    onError: (err: Error) =>
      toast({
        title: "Couldn't save",
        description: err.message,
        variant: "destructive",
      }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, input }: { id: number; input: WorkExperienceInput }) =>
      apiRequest("PUT", `/api/jobseeker/work-experience/${id}`, input),
    onSuccess: () => {
      invalidate();
      toast({ title: "Updated" });
      setMode({ kind: "closed" });
      setForm(EMPTY_FORM);
      setDateError(null);
    },
    onError: (err: Error) =>
      toast({
        title: "Couldn't update",
        description: err.message,
        variant: "destructive",
      }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) =>
      apiRequest("DELETE", `/api/jobseeker/work-experience/${id}`),
    onSuccess: () => {
      invalidate();
      toast({ title: "Removed" });
    },
    onError: (err: Error) =>
      toast({
        title: "Couldn't remove",
        description: err.message,
        variant: "destructive",
      }),
  });

  const isSaving = createMut.isPending || updateMut.isPending;
  const isFormOpen = mode.kind !== "closed";

  const handleAddClick = () => {
    setForm(EMPTY_FORM);
    setDateError(null);
    setMode({ kind: "create" });
  };

  const handleEditClick = (row: JobSeekerWorkExperience) => {
    setForm(fromRow(row));
    setDateError(null);
    setMode({ kind: "edit", id: row.id });
  };

  const handleCancel = () => {
    setMode({ kind: "closed" });
    setForm(EMPTY_FORM);
    setDateError(null);
  };

  const handleSubmit = () => {
    setDateError(null);

    if (form.title.trim() === "") {
      toast({
        title: "Title required",
        description: "Enter the job title.",
        variant: "destructive",
      });
      return;
    }
    if (form.company.trim() === "") {
      toast({
        title: "Company required",
        description: "Enter the company or facility name.",
        variant: "destructive",
      });
      return;
    }
    if (form.startDate === "") {
      toast({
        title: "Start date required",
        description: "Select when you started this role.",
        variant: "destructive",
      });
      return;
    }

    // Mirror the server's superRefine — YYYY-MM strings compare correctly
    // lexicographically because the regex enforces fixed-width.
    if (
      !form.currentlyWorking &&
      form.endDate !== "" &&
      form.endDate < form.startDate
    ) {
      setDateError("End date must be on or after the start date");
      return;
    }

    const payload = toPayload(form);
    if (mode.kind === "create") {
      createMut.mutate(payload);
    } else if (mode.kind === "edit") {
      updateMut.mutate({ id: mode.id, input: payload });
    }
  };

  return (
    <div>
      <h4 className="portal-eyebrow mb-1">
        Work experience{" "}
        <span className="ml-1 text-[10px] font-normal text-muted-foreground normal-case tracking-normal">
          (optional)
        </span>
      </h4>
      <p className="text-[11px] text-muted-foreground mb-3">
        Add roles in reverse-chronological order — current jobs surface first.
      </p>

      {/* Loading skeletons */}
      {isLoading && (
        <ul className="space-y-2 mb-3" aria-busy="true">
          {[0, 1].map((i) => (
            <li
              key={i}
              className="h-24 rounded-lg border border-stone-200 bg-stone-50/50 animate-pulse"
            />
          ))}
        </ul>
      )}

      {/* Error */}
      {isError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive text-center mb-3">
          Failed to load work experience. Please refresh.
        </div>
      )}

      {/* Existing rows */}
      {!isLoading && !isError && list.length > 0 && (
        <ul className="space-y-2 mb-3">
          {list.map((row) => {
            const isCurrent = !row.endDate;
            const isEditingThis =
              mode.kind === "edit" && mode.id === row.id;
            return (
              <li
                key={row.id}
                className="rounded-lg border border-stone-200 bg-white p-3"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-stone-900 truncate">
                          {row.title}
                        </p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Building2
                            className="h-3.5 w-3.5 shrink-0"
                            aria-hidden="true"
                          />
                          <span className="truncate">{row.company}</span>
                        </p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Calendar
                            className="h-3.5 w-3.5 shrink-0"
                            aria-hidden="true"
                          />
                          <span className="portal-num">
                            {formatRange(row.startDate, row.endDate)}
                          </span>
                        </p>
                        {row.location && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <MapPin
                              className="h-3.5 w-3.5 shrink-0"
                              aria-hidden="true"
                            />
                            <span className="truncate">{row.location}</span>
                          </p>
                        )}
                      </div>
                      {row.employmentType && (
                        <span className="shrink-0 rounded-full border bg-stone-50 text-stone-600 border-stone-200 px-2 py-0.5 text-[10px] font-medium">
                          {row.employmentType}
                        </span>
                      )}
                    </div>
                    {row.description && (
                      <p className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap line-clamp-4">
                        {row.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => handleEditClick(row)}
                      aria-label={`Edit ${row.title} at ${row.company}`}
                      disabled={isFormOpen}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-destructive hover:text-destructive"
                      onClick={() => deleteMut.mutate(row.id)}
                      aria-label={`Remove ${row.title} at ${row.company}`}
                      disabled={deleteMut.isPending || isFormOpen}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Inline edit hint — soft accent if this row is currently
                    being edited so users keep their place visually. */}
                {isEditingThis && (
                  <p className="mt-2 text-[10px] uppercase tracking-wide text-[var(--portal-accent)]">
                    Editing — see form below
                  </p>
                )}
                {isCurrent && (
                  <p className="mt-2 text-[10px] uppercase tracking-wide text-stone-500">
                    Current role
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Empty state — only when not loading, not erroring, no rows, and
          the form is not open. */}
      {!isLoading && !isError && list.length === 0 && !isFormOpen && (
        <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50/40 p-4 mb-3 text-center">
          <Briefcase
            className="h-6 w-6 mx-auto text-muted-foreground opacity-40 mb-2"
            aria-hidden="true"
          />
          <p className="text-xs text-muted-foreground mb-3">
            Add your work history so facilities can see your background.
          </p>
          <Button
            variant="gradient"
            size="sm"
            type="button"
            onClick={handleAddClick}
          >
            <Plus className="h-4 w-4" />
            Add work experience
          </Button>
        </div>
      )}

      {/* Inline create / edit form */}
      {isFormOpen ? (
        <div className="rounded-lg border border-stone-200 bg-white p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>
                Title <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="e.g. Direct Support Professional"
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
                maxLength={120}
              />
            </div>

            <div className="space-y-1.5">
              <Label>
                Company <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="e.g. Sunrise Adult Care"
                value={form.company}
                onChange={(e) =>
                  setForm((f) => ({ ...f, company: e.target.value }))
                }
                maxLength={120}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Location</Label>
              <Input
                placeholder="e.g. Sacramento, CA"
                value={form.location}
                onChange={(e) =>
                  setForm((f) => ({ ...f, location: e.target.value }))
                }
                maxLength={120}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Employment type</Label>
              <Select
                value={form.employmentType}
                onValueChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    employmentType: v as
                      | EmploymentType
                      | typeof EMPLOYMENT_TYPE_UNSET,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Not set" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EMPLOYMENT_TYPE_UNSET}>Not set</SelectItem>
                  {EMPLOYMENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>
                Start date <span className="text-destructive">*</span>
              </Label>
              <input
                type="month"
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm portal-num"
                value={form.startDate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, startDate: e.target.value }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label>End date</Label>
              <input
                type="month"
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm portal-num disabled:bg-stone-100 disabled:text-stone-400"
                value={form.currentlyWorking ? "" : form.endDate}
                disabled={form.currentlyWorking}
                onChange={(e) =>
                  setForm((f) => ({ ...f, endDate: e.target.value }))
                }
                aria-invalid={dateError ? "true" : undefined}
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5"
                  checked={form.currentlyWorking}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      currentlyWorking: e.target.checked,
                      // Clear endDate when toggling on so we don't accidentally
                      // ship a stale value on submit.
                      endDate: e.target.checked ? "" : f.endDate,
                    }))
                  }
                />
                I currently work here
              </label>
              {dateError && (
                <p className="text-xs text-destructive mt-1">{dateError}</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              placeholder="What you did, who you supported, and any notable accomplishments…"
              rows={3}
              maxLength={2000}
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
            />
            <p className="text-xs text-muted-foreground text-right portal-num">
              {form.description.length}/2000
            </p>
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              variant="gradient"
              size="sm"
              onClick={handleSubmit}
              disabled={isSaving}
            >
              {isSaving ? "Saving…" : "Save"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              disabled={isSaving}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        // Show the standalone "Add" button only when there are already rows —
        // the empty state has its own gradient CTA above.
        list.length > 0 && (
          <Button
            variant="gradient"
            size="sm"
            onClick={handleAddClick}
            type="button"
          >
            <Plus className="h-4 w-4" />
            Add work experience
          </Button>
        )
      )}
    </div>
  );
}
