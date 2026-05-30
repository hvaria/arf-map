// Applicant Profile Review — full-profile drawer opened from the Applicants tab.
// Right-side Sheet (full-screen on mobile). Fetches the detail endpoint
// GET /api/facility/applicants/:externalId, renders recruiter-friendly sections,
// and exposes status actions + internal notes. See
// docs/features/applicant-profile-review.md.
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Mail, Phone, MapPin, Briefcase, Clock, MessageSquare, GraduationCap,
  FileText, ShieldCheck, History, StickyNote, Trash2, Loader2,
  ChevronUp, ChevronDown,
} from "lucide-react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/StatusBadge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

// ── Types (mirror server DTO in server/storage.ts:ApplicantProfileDetail) ────
type ExpiryStatus = "valid" | "expiring" | "expired" | "none";

interface Credential {
  kind: string;
  label: string | null;
  licenseNumber: string | null;
  issuingAuthority: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  notes: string | null;
  expiryStatus: ExpiryStatus;
}
interface WorkExp {
  title: string;
  company: string;
  location: string | null;
  employmentType: string | null;
  startDate: string;
  endDate: string | null;
  description: string | null;
}
interface Note {
  externalId: string;
  body: string;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}
interface StatusHist {
  fromStatus: string | null;
  toStatus: string;
  changedBy: string | null;
  note: string | null;
  createdAt: number;
}
interface ApplicantProfileDetail {
  interest: {
    externalId: string;
    status: string;
    roleInterest: string | null;
    message: string | null;
    createdAt: number;
    updatedAt: number;
    jobExternalId: string | null;
    jobTitle: string | null;
  };
  profile: {
    firstName: string | null;
    lastName: string | null;
    email: string;
    phone: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
    profilePictureUrl: string | null;
    yearsExperience: number | null;
    jobTypes: string[];
    bio: string | null;
  } | null;
  credentials: Credential[];
  workExperience: WorkExp[];
  notes: Note[];
  statusHistory: StatusHist[];
  completion: { percent: number; missing: string[] };
}

/** A minimal seed from the list row so the header renders before the fetch resolves. */
export interface ApplicantSeed {
  externalId: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  city: string | null;
  state: string | null;
  status: string;
  jobTitle: string | null;
}

function fullName(p: { firstName: string | null; lastName: string | null; email: string }): string {
  const n = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
  return n || p.email.split("@")[0];
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtMonth(ym: string | null): string {
  if (!ym) return "Present";
  const [y, m] = ym.split("-");
  if (!y) return ym;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return m ? `${months[Number(m) - 1] ?? m} ${y}` : y;
}

function credentialLabel(c: Credential): string {
  if (c.kind === "OTHER" && c.label) return c.label;
  return (c.label || c.kind).replace(/_/g, " ");
}

const EXPIRY_CHIP: Record<ExpiryStatus, { label: string; className: string }> = {
  valid:    { label: "Valid",         className: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900" },
  expiring: { label: "Expiring soon", className: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900" },
  expired:  { label: "Expired",       className: "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900" },
  none:     { label: "No expiry",     className: "bg-muted text-muted-foreground border-transparent" },
};

// ── Small presentational helpers ─────────────────────────────────────────────
function Section({ icon: Icon, title, children }: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </h3>
      {children}
    </section>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground italic">{children}</p>;
}

const STATUS_OPTIONS = ["pending", "viewed", "shortlisted", "rejected", "archived"] as const;
const STATUS_LABEL: Record<string, string> = {
  pending: "Pending", viewed: "Viewed", shortlisted: "Shortlisted", rejected: "Rejected", archived: "Archived",
};

interface Props {
  /** The applicant interest externalId to show; null = drawer closed. */
  externalId: string | null;
  /** Seed from the clicked list row so the header paints instantly. */
  seed?: ApplicantSeed | null;
  /** Ordered externalIds of the current (filtered) list — drives Prev/Next. */
  orderedIds?: string[];
  /** Jump to another applicant without closing the drawer. */
  onNavigate?: (externalId: string) => void;
  onClose: () => void;
}

export function ApplicantProfileDrawer({ externalId, seed, orderedIds = [], onNavigate, onClose }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [noteBody, setNoteBody] = useState("");

  const open = externalId != null;

  // Prev/Next queue navigation over the current list order.
  const idx = externalId ? orderedIds.indexOf(externalId) : -1;
  const prevId = idx > 0 ? orderedIds[idx - 1] : null;
  const nextId = idx >= 0 && idx < orderedIds.length - 1 ? orderedIds[idx + 1] : null;

  // Reset the note composer when the viewed applicant changes (Prev/Next).
  useEffect(() => { setNoteBody(""); }, [externalId]);

  // Keyboard: J/K (and ↑/↓) step through the queue. Ignored while typing in a
  // field so the notes composer isn't hijacked.
  useEffect(() => {
    if (!open || !onNavigate) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if ((e.key === "j" || e.key === "ArrowDown") && nextId) { e.preventDefault(); onNavigate(nextId); }
      else if ((e.key === "k" || e.key === "ArrowUp") && prevId) { e.preventDefault(); onNavigate(prevId); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onNavigate, nextId, prevId]);

  const { data, isLoading, isError, refetch } = useQuery<ApplicantProfileDetail>({
    queryKey: ["/api/facility/applicants", externalId],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: open,
    staleTime: 15_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/facility/applicants"] });
    if (externalId) qc.invalidateQueries({ queryKey: ["/api/facility/applicants", externalId] });
  };

  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      apiRequest("PATCH", `/api/facility/applicants/${externalId}`, { status }),
    onSuccess: (_r, status) => {
      invalidate();
      toast({ title: `Marked ${STATUS_LABEL[status] ?? status}` });
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const addNote = useMutation({
    mutationFn: (body: string) =>
      apiRequest("POST", `/api/facility/applicants/${externalId}/notes`, { body }),
    onSuccess: () => { setNoteBody(""); invalidate(); },
    onError: (err: Error) => toast({ title: "Couldn't add note", description: err.message, variant: "destructive" }),
  });

  const deleteNote = useMutation({
    mutationFn: (noteExternalId: string) =>
      apiRequest("DELETE", `/api/facility/applicants/${externalId}/notes/${noteExternalId}`),
    onSuccess: () => invalidate(),
    onError: (err: Error) => toast({ title: "Couldn't delete note", description: err.message, variant: "destructive" }),
  });

  // Header data: prefer the live profile, fall back to the seed so the top
  // never flashes empty while the detail request is in flight.
  const header = useMemo(() => {
    if (data) {
      const p = data.profile;
      return {
        name: p ? fullName(p) : (seed ? fullName(seed) : data.interest.externalId),
        email: p?.email ?? seed?.email ?? "",
        location: [p?.city, p?.state].filter(Boolean).join(", "),
        status: data.interest.status,
        jobTitle: data.interest.jobTitle ?? data.interest.roleInterest,
      };
    }
    if (seed) {
      return {
        name: fullName(seed),
        email: seed.email,
        location: [seed.city, seed.state].filter(Boolean).join(", "),
        status: seed.status,
        jobTitle: seed.jobTitle,
      };
    }
    return null;
  }, [data, seed]);

  const status = data?.interest.status ?? seed?.status ?? "pending";

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl p-0 flex flex-col gap-0"
        aria-describedby={undefined}
      >
        {/* ── Summary header (sticky top) ───────────────────────────────── */}
        <SheetHeader className="space-y-0 border-b p-4 text-left">
          {orderedIds.length > 1 && idx >= 0 && (
            <div className="flex items-center gap-1 pb-2 text-xs text-muted-foreground">
              <Button
                variant="outline" size="icon" className="h-6 w-6"
                disabled={!prevId} onClick={() => prevId && onNavigate?.(prevId)}
                aria-label="Previous applicant (k)"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline" size="icon" className="h-6 w-6"
                disabled={!nextId} onClick={() => nextId && onNavigate?.(nextId)}
                aria-label="Next applicant (j)"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
              <span className="ml-1 tabular-nums">{idx + 1} of {orderedIds.length}</span>
            </div>
          )}
          {header ? (
            <div className="flex items-start gap-3 pr-8">
              <div className="h-11 w-11 shrink-0 rounded-full bg-primary/10 flex items-center justify-center text-base font-semibold text-primary">
                {(header.name[0] ?? "?").toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-base leading-tight truncate">{header.name}</SheetTitle>
                <SheetDescription className="text-xs mt-0.5">
                  {header.jobTitle ? <>Applied to: {header.jobTitle}</> : "General interest"}
                </SheetDescription>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {header.location && (
                    <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{header.location}</span>
                  )}
                  <StatusBadge status={header.status} />
                </div>
              </div>
            </div>
          ) : (
            <Skeleton className="h-11 w-full" />
          )}
        </SheetHeader>

        {/* ── Scrollable body ───────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {isError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center text-sm text-destructive">
              Couldn't load this profile.
              <Button variant="outline" size="sm" className="ml-2" onClick={() => refetch()}>Retry</Button>
            </div>
          ) : isLoading || !data ? (
            <DetailSkeleton />
          ) : (
            <ProfileBody
              data={data}
              noteBody={noteBody}
              setNoteBody={setNoteBody}
              onAddNote={(b) => addNote.mutate(b)}
              addingNote={addNote.isPending}
              onDeleteNote={(id) => deleteNote.mutate(id)}
              deletingNoteId={deleteNote.isPending ? deleteNote.variables ?? null : null}
            />
          )}
        </div>

        {/* ── Sticky action bar ─────────────────────────────────────────── */}
        <div className="border-t p-3 flex items-center gap-2 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            disabled={statusMutation.isPending || status === "rejected"}
            onClick={() => statusMutation.mutate("rejected")}
          >
            Reject
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            disabled={statusMutation.isPending || status === "archived"}
            onClick={() => statusMutation.mutate("archived")}
          >
            Archive
          </Button>
          <Button
            size="sm"
            className="flex-1"
            disabled={statusMutation.isPending || status === "shortlisted"}
            onClick={() => statusMutation.mutate("shortlisted")}
          >
            {statusMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Shortlist"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Body ─────────────────────────────────────────────────────────────────────
function ProfileBody({
  data, noteBody, setNoteBody, onAddNote, addingNote, onDeleteNote, deletingNoteId,
}: {
  data: ApplicantProfileDetail;
  noteBody: string;
  setNoteBody: (v: string) => void;
  onAddNote: (body: string) => void;
  addingNote: boolean;
  onDeleteNote: (noteExternalId: string) => void;
  deletingNoteId: string | null;
}) {
  const { profile, interest, credentials, workExperience, notes, statusHistory, completion } = data;

  return (
    <>
      {/* Completion meter */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-muted-foreground">Profile completion</span>
          <span className="tabular-nums text-muted-foreground">{completion.percent}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full transition-all", completion.percent >= 70 ? "bg-emerald-500" : completion.percent >= 40 ? "bg-amber-500" : "bg-red-500")}
            style={{ width: `${completion.percent}%` }}
          />
        </div>
        {completion.percent < 50 && <EmptyLine>Limited profile — the applicant hasn't filled in much yet.</EmptyLine>}
      </div>

      <Separator />

      {/* Contact */}
      <Section icon={Mail} title="Contact">
        {profile ? (
          <div className="space-y-1 text-sm">
            <a href={`mailto:${profile.email}`} className="flex items-center gap-2 text-foreground hover:text-primary">
              <Mail className="h-3.5 w-3.5 text-muted-foreground" />{profile.email}
            </a>
            {profile.phone && (
              <a href={`tel:${profile.phone}`} className="flex items-center gap-2 text-foreground hover:text-primary">
                <Phone className="h-3.5 w-3.5 text-muted-foreground" />{profile.phone}
              </a>
            )}
            {(profile.address || profile.zipCode) && (
              <p className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" />
                {[profile.address, profile.city, profile.state, profile.zipCode].filter(Boolean).join(", ")}
              </p>
            )}
            {profile.yearsExperience != null && (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Briefcase className="h-3.5 w-3.5" />{profile.yearsExperience} yr{profile.yearsExperience !== 1 ? "s" : ""} experience
              </p>
            )}
          </div>
        ) : (
          <EmptyLine>This applicant hasn't completed their profile.</EmptyLine>
        )}
        {profile?.jobTypes && profile.jobTypes.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {profile.jobTypes.map((t) => (
              <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
            ))}
          </div>
        )}
      </Section>

      {/* Application answers */}
      {(interest.roleInterest || interest.message) && (
        <>
          <Separator />
          <Section icon={MessageSquare} title="Application">
            {interest.roleInterest && (
              <p className="text-xs text-muted-foreground">
                Role interest: <span className="text-foreground">{interest.roleInterest}</span>
              </p>
            )}
            {interest.message && (
              <div className="rounded-md bg-muted/50 px-3 py-2 text-sm italic leading-relaxed">"{interest.message}"</div>
            )}
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />Applied {fmtDate(interest.createdAt)}
            </p>
          </Section>
        </>
      )}

      {/* Bio */}
      {profile?.bio && (
        <>
          <Separator />
          <Section icon={FileText} title="About">
            <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">{profile.bio}</p>
          </Section>
        </>
      )}

      {/* Certifications */}
      <Separator />
      <Section icon={ShieldCheck} title="Certifications & licenses">
        {credentials.length === 0 ? (
          <EmptyLine>No certifications added.</EmptyLine>
        ) : (
          <ul className="space-y-2">
            {credentials.map((c, i) => {
              const chip = EXPIRY_CHIP[c.expiryStatus];
              return (
                <li key={i} className="flex items-start justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{credentialLabel(c)}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {[c.licenseNumber && `#${c.licenseNumber}`, c.issuingAuthority, c.expiresAt && `exp ${c.expiresAt}`]
                        .filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                  <span className={cn("shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium", chip.className)}>
                    {chip.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* Work experience */}
      <Separator />
      <Section icon={Briefcase} title="Work experience">
        {workExperience.length === 0 ? (
          <EmptyLine>No work history added.</EmptyLine>
        ) : (
          <ul className="space-y-3">
            {workExperience.map((w, i) => (
              <li key={i} className="relative pl-4">
                <span className="absolute left-0 top-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
                <p className="text-sm font-medium leading-tight">{w.title}</p>
                <p className="text-xs text-muted-foreground">
                  {w.company}{w.location ? ` · ${w.location}` : ""}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {fmtMonth(w.startDate)} – {fmtMonth(w.endDate)}{w.employmentType ? ` · ${w.employmentType}` : ""}
                </p>
                {w.description && <p className="mt-1 text-xs leading-relaxed text-foreground/80">{w.description}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Education (deferred to Phase 2) */}
      <Separator />
      <Section icon={GraduationCap} title="Education">
        <EmptyLine>Education isn't captured in profiles yet.</EmptyLine>
      </Section>

      {/* Activity / status timeline */}
      {statusHistory.length > 0 && (
        <>
          <Separator />
          <Section icon={History} title="Activity">
            <ul className="space-y-1.5">
              {statusHistory.map((h, i) => (
                <li key={i} className="text-xs text-muted-foreground">
                  <span className="text-foreground">{STATUS_LABEL[h.toStatus] ?? h.toStatus}</span>
                  {h.fromStatus ? ` (from ${STATUS_LABEL[h.fromStatus] ?? h.fromStatus})` : ""} · {fmtDate(h.createdAt)}
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}

      {/* Internal notes */}
      <Separator />
      <Section icon={StickyNote} title="Internal notes (only your team sees this)">
        <div className="space-y-2">
          <Textarea
            value={noteBody}
            onChange={(e) => setNoteBody(e.target.value)}
            placeholder="Add a private note about this applicant…"
            className="min-h-[60px] text-sm"
            maxLength={5000}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!noteBody.trim() || addingNote}
              onClick={() => onAddNote(noteBody.trim())}
            >
              {addingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add note"}
            </Button>
          </div>
        </div>
        {notes.length > 0 && (
          <ul className="space-y-2 pt-1">
            {notes.map((n) => (
              <li key={n.externalId} className="group rounded-md border bg-card px-3 py-2 text-sm">
                <p className="whitespace-pre-wrap leading-relaxed">{n.body}</p>
                <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{fmtDate(n.createdAt)}</span>
                  <button
                    type="button"
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-destructive transition-opacity inline-flex items-center gap-1"
                    onClick={() => onDeleteNote(n.externalId)}
                    disabled={deletingNoteId === n.externalId}
                  >
                    <Trash2 className="h-3 w-3" />Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-2 w-full" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ))}
    </div>
  );
}
