/**
 * <FacilityDetailsTab> — replaces the flat 4-field listing card on the
 * Facility Portal → My details tab with a sectioned profile page.
 *
 * Sections (in order):
 *   1. Identity & branding (DBA, logo upload, year established)
 *   2. Contact & basics    (phone, email, website, description) ← legacy fields
 *   3. Address             (mailing address; CCLD physical is read-only)
 *   4. Hours & languages   (per-day hours grid, language chips)
 *   5. Care offered        (multi-select care types + accreditations)
 *   6. Administrator       (admin name/phone/email/license)
 *   7. Social              (FB / IG / LinkedIn URLs)
 *   8. Report letterhead   (preview + optional header/footer override)
 *
 * Each section uses a per-section "Edit" button that opens a small Dialog
 * (matching the AddTaskDialog skeleton). Saves are PUT /api/facility/profile
 * with only that section's fields, with optimistic update + rollback so the
 * row updates instantly on slow links.
 *
 * Pattern citations (Implementation Contract §2.5):
 *   - Sectioned card + per-section "Edit" pattern:
 *       client/src/pages/FacilityPortal.tsx:1283-1347 (legacy "Listing details" card)
 *   - Dialog (header → body → footer with [Cancel] [Save] + kbd-Enter hint):
 *       client/src/components/operations/AddTaskDialog.tsx:137-225
 *   - FormField + onSubmitKey (inline-error scaffolding):
 *       client/src/components/operations/FormField.tsx:17-68
 *   - apiRequest + getQueryFn + optimistic update/rollback:
 *       client/src/components/operations/AttachEvidence.tsx:216-243
 *       client/src/lib/queryClient.ts
 *   - Completeness banner (yellow/green status):
 *       client/src/pages/FacilityPortal.tsx:1250-1282
 *
 * Shared catalogues come from shared/facility-profile.ts so FE/BE stay in
 * sync (FACILITY_LANGUAGES, FACILITY_CARE_TYPES, FACILITY_CARE_TYPE_LABELS,
 * DAYS_OF_WEEK, HoursOfOperation, FACILITY_LOGO_* — used inside LogoUpload).
 *
 * Guardrail — does NOT import or modify `client/src/components/BrandLogo.tsx`.
 * The facility logo is a separate concept handled by `LogoUpload`.
 */
import { useEffect, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  DAYS_OF_WEEK,
  FACILITY_CARE_TYPES,
  FACILITY_CARE_TYPE_LABELS,
  FACILITY_LANGUAGES,
  defaultReportHeader,
  type DayOfWeek,
  type FacilityCareType,
  type HoursOfOperation,
} from "@shared/facility-profile";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCopy,
  Copy,
  Edit3,
  RefreshCw,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FormField, onSubmitKey } from "@/components/operations/FormField";
import { LogoUpload } from "@/components/facility/LogoUpload";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { getCsrfToken, refreshCsrfTokenFromMe } from "@/lib/csrfToken";
import { cn } from "@/lib/utils";

// ── Types (shape mirrors /api/facility/profile envelope) ─────────────────────

export interface FacilityProfileOverrides {
  // Section 1 — Identity & branding
  dbaName?: string | null;
  yearEstablished?: number | null;
  logoStorageUri?: string | null;
  logoMime?: string | null;
  logoUpdatedAt?: number | null;
  // Section 2 — Contact & basics
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  description?: string | null;
  // Section 3 — Address
  mailingAddressLine1?: string | null;
  mailingAddressLine2?: string | null;
  mailingCity?: string | null;
  mailingState?: string | null;
  mailingZip?: string | null;
  // Section 4 — Hours & languages
  hoursOfOperation?: HoursOfOperation | null;
  languages?: string[] | null;
  // Section 5 — Care offered
  careTypes?: FacilityCareType[] | null;
  accreditations?: string[] | null;
  // Section 6 — Administrator
  administratorName?: string | null;
  administratorPhone?: string | null;
  administratorEmail?: string | null;
  administratorLicenseNumber?: string | null;
  // Section 7 — Social
  facebookUrl?: string | null;
  instagramUrl?: string | null;
  linkedinUrl?: string | null;
  // Section 8 — Letterhead
  reportHeaderText?: string | null;
  reportFooterText?: string | null;
}

export interface FacilityProfileCcld {
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  administrator?: string | null;
  capacity?: number | null;
  firstLicenseDate?: string | null;
}

export interface FacilityProfileEnvelope {
  overrides: FacilityProfileOverrides | null;
  ccld: FacilityProfileCcld | null;
  ccldPrefill?: { fields: string[]; at: number } | null;
}

interface Props {
  facilityNumber: string;
  facilityName: string | null;
  /**
   * Optional ccldPrefill envelope from /api/facility/me — when present the
   * "we pre-filled N fields" banner appears at the top.
   */
  initialCcldPrefill?: { fields: string[]; at: number } | null;
}

// ── Main component ──────────────────────────────────────────────────────────

export function FacilityDetailsTab({
  facilityNumber,
  facilityName,
  initialCcldPrefill,
}: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const profileQuery = useQuery<FacilityProfileEnvelope | null>({
    queryKey: ["/api/facility/profile"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 60_000,
  });

  // Dialog state — only one open at a time.
  const [openSection, setOpenSection] = useState<SectionId | null>(null);

  // Prefill banner dismissed state (in-memory; resets on reload).
  const [prefillDismissed, setPrefillDismissed] = useState(false);

  const data = profileQuery.data ?? null;
  const overrides = data?.overrides ?? null;
  const ccld = data?.ccld ?? null;
  // Prefer the envelope value (live) and fall back to the one from /me.
  const ccldPrefill = data?.ccldPrefill ?? initialCcldPrefill ?? null;

  // ── PUT /api/facility/profile — section-scoped optimistic save ────────────
  const saveMutation = useMutation({
    mutationFn: async (patch: Partial<FacilityProfileOverrides>) => {
      const res = await apiRequest("PUT", "/api/facility/profile", patch);
      return res.json();
    },
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ["/api/facility/profile"] });
      const prev = qc.getQueryData<FacilityProfileEnvelope>([
        "/api/facility/profile",
      ]);
      if (prev) {
        qc.setQueryData<FacilityProfileEnvelope>(["/api/facility/profile"], {
          ...prev,
          overrides: { ...(prev.overrides ?? {}), ...patch },
        });
      }
      return { prev };
    },
    onError: (err: Error, _patch, ctx) => {
      if (ctx?.prev)
        qc.setQueryData(["/api/facility/profile"], ctx.prev);
      toast({
        title: "Couldn't save",
        description: err.message,
        variant: "destructive",
      });
    },
    onSuccess: () => {
      toast({ title: "Details saved" });
      qc.invalidateQueries({
        queryKey: [`/api/facilities/${facilityNumber}/public`],
      });
      setOpenSection(null);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["/api/facility/profile"] });
    },
  });

  // ── POST /api/facility/profile/prefill-from-ccld ──────────────────────────
  const prefillMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        "/api/facility/profile/prefill-from-ccld",
      );
      return res.json() as Promise<{
        success?: boolean;
        data?: { fields: string[] };
        fields?: string[];
      }>;
    },
    onSuccess: (json) => {
      const fields = json?.data?.fields ?? json?.fields ?? [];
      toast({
        title:
          fields.length === 0
            ? "Already up to date"
            : `Refreshed ${fields.length} field${fields.length === 1 ? "" : "s"} from CCLD`,
      });
      qc.invalidateQueries({ queryKey: ["/api/facility/profile"] });
      qc.invalidateQueries({
        queryKey: [`/api/facilities/${facilityNumber}/public`],
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't refresh from CCLD",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // ── Logo: POST (multipart) and DELETE ─────────────────────────────────────
  const logoUpload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      // Multipart upload — can't go through apiRequest() (it serialises JSON).
      // Headers mirror apiRequest exactly: X-Requested-With sentinel +
      // X-CSRF-Token per-session token (Phase 1). Note: NO Content-Type —
      // the browser sets it (with boundary) for FormData.
      const buildHeaders = (): Record<string, string> => {
        const h: Record<string, string> = {
          "X-Requested-With": "XMLHttpRequest",
        };
        const csrf = getCsrfToken();
        if (csrf) h["X-CSRF-Token"] = csrf;
        return h;
      };
      const doPost = () =>
        fetch("/api/facility/profile/logo", {
          method: "POST",
          credentials: "include",
          headers: buildHeaders(),
          body: fd,
        });
      let res = await doPost();
      if (res.status === 403) {
        const probe = await res.clone().json().catch(() => null);
        if ((probe as { code?: string } | null)?.code === "CSRF_TOKEN_INVALID") {
          await refreshCsrfTokenFromMe("facility");
          res = await doPost();
        }
      }
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          msg = body?.message || body?.error || msg;
        } catch {
          /* swallow */
        }
        throw new Error(msg);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Logo uploaded" });
      qc.invalidateQueries({ queryKey: ["/api/facility/profile"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Upload failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const logoRemove = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/facility/profile/logo");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Logo removed" });
      qc.invalidateQueries({ queryKey: ["/api/facility/profile"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't remove logo",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Completeness banner — legacy phone/email/description signal.
  const missingFields: string[] = [];
  if (!overrides?.phone) missingFields.push("phone");
  if (!overrides?.email) missingFields.push("email");
  if (!overrides?.description) missingFields.push("description");
  const isListingComplete = missingFields.length === 0;

  // Loading
  if (profileQuery.isLoading) {
    return (
      <div className="space-y-3" data-testid="facility-profile-loading">
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }

  // Network error
  if (profileQuery.error) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
      >
        Couldn't load your facility profile — please refresh.
      </div>
    );
  }

  const logoUrl = overrides?.logoStorageUri
    ? `/api/facility/profile/logo?t=${overrides.logoUpdatedAt ?? 0}`
    : null;

  return (
    <div className="space-y-4">
      {/* ── Prefill banner ─────────────────────────────────────────────── */}
      {ccldPrefill && ccldPrefill.fields.length > 0 && !prefillDismissed && (
        <div
          role="status"
          data-testid="ccld-prefill-banner"
          className="flex items-start gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900"
        >
          <CheckCircle2
            className="h-4 w-4 mt-0.5 shrink-0 text-sky-600"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="font-medium leading-snug">
              We pre-filled {ccldPrefill.fields.length} field
              {ccldPrefill.fields.length === 1 ? "" : "s"} from your CCLD
              license record.
            </p>
            <p className="text-sky-800/80 text-[13px] mt-0.5 leading-snug">
              Review and edit anytime.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPrefillDismissed(true)}
            className="shrink-0 rounded p-0.5 text-sky-700 hover:text-sky-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Dismiss prefill notice"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ── Listing completeness ───────────────────────────────────────── */}
      <div
        role="status"
        data-testid="listing-completeness-banner"
        className={cn(
          "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm",
          isListingComplete
            ? "bg-emerald-50 border-emerald-200 text-emerald-900"
            : "bg-amber-50 border-amber-200 text-amber-900",
        )}
      >
        {isListingComplete ? (
          <CheckCircle2
            className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600"
            aria-hidden="true"
          />
        ) : (
          <AlertCircle
            className="h-4 w-4 mt-0.5 shrink-0 text-amber-600"
            aria-hidden="true"
          />
        )}
        <div className="min-w-0 flex-1">
          {isListingComplete ? (
            <p className="font-medium leading-snug">
              Your public listing is complete.
            </p>
          ) : (
            <>
              <p className="font-medium leading-snug">
                Your public listing is missing {missingFields.length} field
                {missingFields.length === 1 ? "" : "s"}:{" "}
                {missingFields.join(", ")}.
              </p>
              <p className="text-amber-800/80 text-[13px] mt-0.5 leading-snug">
                Filling these in helps families find you.
              </p>
            </>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => prefillMutation.mutate()}
          disabled={prefillMutation.isPending}
          data-testid="refresh-from-ccld-btn"
          aria-label="Refresh empty fields from CCLD"
        >
          <RefreshCw
            className={cn(
              "h-3.5 w-3.5 mr-1.5",
              prefillMutation.isPending && "animate-spin",
            )}
          />
          {prefillMutation.isPending ? "Refreshing…" : "Refresh from CCLD"}
        </Button>
      </div>

      {/* ── Section 1: Identity & branding ─────────────────────────────── */}
      <SectionCard
        title="Identity & branding"
        description="Your facility's display name and visual identity."
        onEdit={() => setOpenSection("identity")}
        testId="section-identity"
      >
        <Row
          label="DBA name"
          value={overrides?.dbaName}
          fallback={facilityName ?? undefined}
        />
        <Row
          label="Year established"
          value={
            overrides?.yearEstablished
              ? String(overrides.yearEstablished)
              : null
          }
        />
        <div className="px-5 py-3">
          <LogoUpload
            currentLogoUrl={logoUrl}
            onUpload={async (file) => {
              await logoUpload.mutateAsync(file);
            }}
            onRemove={async () => {
              await logoRemove.mutateAsync();
            }}
            loading={logoUpload.isPending || logoRemove.isPending}
          />
        </div>
      </SectionCard>

      {/* ── Section 2: Contact & basics ────────────────────────────────── */}
      <SectionCard
        title="Contact & basics"
        description="Public information on your map listing."
        onEdit={() => setOpenSection("contact")}
        testId="section-contact"
      >
        <Row label="Phone" value={overrides?.phone} />
        <Row label="Email" value={overrides?.email} />
        <Row label="Website" value={overrides?.website} />
        <Row label="Description" value={overrides?.description} />
      </SectionCard>

      {/* ── Section 3: Address ─────────────────────────────────────────── */}
      <SectionCard
        title="Address"
        description="Your mailing address (separate from the licensed physical address on file with CCLD)."
        onEdit={() => setOpenSection("address")}
        testId="section-address"
      >
        <Row label="Mailing line 1" value={overrides?.mailingAddressLine1} />
        <Row label="Mailing line 2" value={overrides?.mailingAddressLine2} />
        <Row label="City" value={overrides?.mailingCity} />
        <Row label="State" value={overrides?.mailingState} />
        <Row label="ZIP" value={overrides?.mailingZip} />
        <div
          className="px-5 py-3 border-t bg-stone-50/60"
          style={{ borderColor: "var(--portal-border-subtle)" }}
        >
          <p className="text-xs font-medium text-stone-700 mb-1.5">
            Licensed physical address (read-only, from CCLD)
          </p>
          <p
            className="text-[13px] text-stone-900"
            data-testid="ccld-physical-address"
          >
            {[ccld?.address, ccld?.city, ccld?.state, ccld?.zip]
              .filter(Boolean)
              .join(", ") || (
              <span className="italic text-muted-foreground">
                Not on file
              </span>
            )}
          </p>
        </div>
      </SectionCard>

      {/* ── Section 4: Hours & languages ───────────────────────────────── */}
      <SectionCard
        title="Hours & languages"
        description="When you accept visitors, and what languages your staff speak."
        onEdit={() => setOpenSection("hours")}
        testId="section-hours"
      >
        <div className="px-5 py-3">
          <p className="text-xs font-medium text-stone-700 mb-2">
            Hours of operation
          </p>
          <HoursPreview hours={overrides?.hoursOfOperation ?? null} />
        </div>
        <div
          className="px-5 py-3 border-t"
          style={{ borderColor: "var(--portal-border-subtle)" }}
        >
          <p className="text-xs font-medium text-stone-700 mb-2">
            Languages spoken
          </p>
          <ChipsPreview
            values={(overrides?.languages ?? []) as string[]}
            labelMap={Object.fromEntries(
              FACILITY_LANGUAGES.map((l) => [l.code, l.label]),
            )}
            emptyText="Not specified"
          />
        </div>
      </SectionCard>

      {/* ── Section 5: Care offered ────────────────────────────────────── */}
      <SectionCard
        title="Care offered"
        description="Services and accreditations families will see on your listing."
        onEdit={() => setOpenSection("care")}
        testId="section-care"
      >
        <div className="px-5 py-3">
          <p className="text-xs font-medium text-stone-700 mb-2">
            Care types
          </p>
          <ChipsPreview
            values={(overrides?.careTypes ?? []) as string[]}
            labelMap={FACILITY_CARE_TYPE_LABELS as Record<string, string>}
            emptyText="None selected"
          />
        </div>
        <div
          className="px-5 py-3 border-t"
          style={{ borderColor: "var(--portal-border-subtle)" }}
        >
          <p className="text-xs font-medium text-stone-700 mb-2">
            Accreditations
          </p>
          <ChipsPreview
            values={overrides?.accreditations ?? []}
            emptyText="None listed"
          />
        </div>
      </SectionCard>

      {/* ── Section 6: Administrator ───────────────────────────────────── */}
      <SectionCard
        title="Administrator"
        description="Primary administrator on file (pre-filled from CCLD, editable)."
        onEdit={() => setOpenSection("admin")}
        testId="section-admin"
      >
        <Row label="Name" value={overrides?.administratorName} />
        <Row label="Phone" value={overrides?.administratorPhone} />
        <Row label="Email" value={overrides?.administratorEmail} />
        <Row
          label="License #"
          value={overrides?.administratorLicenseNumber}
        />
      </SectionCard>

      {/* ── Section 7: Social ──────────────────────────────────────────── */}
      <SectionCard
        title="Social"
        description="Optional links shown on your public listing."
        onEdit={() => setOpenSection("social")}
        testId="section-social"
      >
        <Row label="Facebook" value={overrides?.facebookUrl} />
        <Row label="Instagram" value={overrides?.instagramUrl} />
        <Row label="LinkedIn" value={overrides?.linkedinUrl} />
      </SectionCard>

      {/* ── Section 8: Report letterhead ───────────────────────────────── */}
      <SectionCard
        title="Report letterhead"
        description="This header appears on every PDF report you download."
        onEdit={() => setOpenSection("letterhead")}
        testId="section-letterhead"
      >
        <div className="px-5 py-4">
          <LetterheadPreview
            facilityName={facilityName ?? `Facility ${facilityNumber}`}
            licenseNumber={facilityNumber}
            city={ccld?.city ?? null}
            logoUrl={logoUrl}
            overrideHeader={overrides?.reportHeaderText ?? null}
            overrideFooter={overrides?.reportFooterText ?? null}
          />
        </div>
        <div
          className="px-5 py-3 border-t text-[12px] text-muted-foreground"
          style={{ borderColor: "var(--portal-border-subtle)" }}
        >
          {overrides?.reportHeaderText || overrides?.reportFooterText
            ? "Custom header/footer text active."
            : "Using default letterhead. Click Edit to customize."}
        </div>
      </SectionCard>

      {/* ── Per-section dialogs ────────────────────────────────────────── */}
      <EditIdentityDialog
        open={openSection === "identity"}
        onOpenChange={(v) => !v && setOpenSection(null)}
        overrides={overrides}
        defaultDba={facilityName}
        onSave={(patch) => saveMutation.mutate(patch)}
        saving={saveMutation.isPending}
      />
      <EditContactDialog
        open={openSection === "contact"}
        onOpenChange={(v) => !v && setOpenSection(null)}
        overrides={overrides}
        onSave={(patch) => saveMutation.mutate(patch)}
        saving={saveMutation.isPending}
      />
      <EditAddressDialog
        open={openSection === "address"}
        onOpenChange={(v) => !v && setOpenSection(null)}
        overrides={overrides}
        ccld={ccld}
        onSave={(patch) => saveMutation.mutate(patch)}
        saving={saveMutation.isPending}
      />
      <EditHoursDialog
        open={openSection === "hours"}
        onOpenChange={(v) => !v && setOpenSection(null)}
        overrides={overrides}
        onSave={(patch) => saveMutation.mutate(patch)}
        saving={saveMutation.isPending}
      />
      <EditCareDialog
        open={openSection === "care"}
        onOpenChange={(v) => !v && setOpenSection(null)}
        overrides={overrides}
        onSave={(patch) => saveMutation.mutate(patch)}
        saving={saveMutation.isPending}
      />
      <EditAdminDialog
        open={openSection === "admin"}
        onOpenChange={(v) => !v && setOpenSection(null)}
        overrides={overrides}
        onSave={(patch) => saveMutation.mutate(patch)}
        saving={saveMutation.isPending}
      />
      <EditSocialDialog
        open={openSection === "social"}
        onOpenChange={(v) => !v && setOpenSection(null)}
        overrides={overrides}
        onSave={(patch) => saveMutation.mutate(patch)}
        saving={saveMutation.isPending}
      />
      <EditLetterheadDialog
        open={openSection === "letterhead"}
        onOpenChange={(v) => !v && setOpenSection(null)}
        overrides={overrides}
        onSave={(patch) => saveMutation.mutate(patch)}
        saving={saveMutation.isPending}
        facilityName={facilityName ?? `Facility ${facilityNumber}`}
        licenseNumber={facilityNumber}
        city={ccld?.city ?? null}
        logoUrl={logoUrl}
      />
    </div>
  );
}

type SectionId =
  | "identity"
  | "contact"
  | "address"
  | "hours"
  | "care"
  | "admin"
  | "social"
  | "letterhead";

// ── Reusable section card / row primitives ──────────────────────────────────

function SectionCard({
  title,
  description,
  onEdit,
  children,
  testId,
}: {
  title: string;
  description?: string;
  onEdit: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section
      className="rounded-lg border bg-white"
      style={{ borderColor: "var(--portal-border-subtle)" }}
      data-testid={testId}
    >
      <div
        className="px-5 py-4 flex items-center justify-between border-b"
        style={{ borderColor: "var(--portal-border-subtle)" }}
      >
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-stone-900">{title}</h2>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {description}
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onEdit}
          aria-label={`Edit ${title}`}
          data-testid={testId ? `${testId}-edit` : undefined}
        >
          <Edit3 className="h-3.5 w-3.5 mr-1.5" />
          Edit
        </Button>
      </div>
      <dl
        className="text-sm divide-y"
        style={{ borderColor: "var(--portal-border-subtle)" }}
      >
        {children}
      </dl>
    </section>
  );
}

function Row({
  label,
  value,
  fallback,
}: {
  label: string;
  value?: string | number | null;
  fallback?: string;
}) {
  const display =
    value === null || value === undefined || value === "" ? null : String(value);
  return (
    <div
      className="flex items-start gap-4 px-5 py-3"
      style={{ borderColor: "var(--portal-border-subtle)" }}
    >
      <dt className="text-muted-foreground w-32 shrink-0 text-[13px]">
        {label}
      </dt>
      <dd
        className={cn(
          "min-w-0 flex-1 text-[13px]",
          display
            ? "text-stone-900"
            : fallback
              ? "text-stone-500"
              : "text-muted-foreground italic",
        )}
      >
        {display ?? fallback ?? "Not set"}
      </dd>
    </div>
  );
}

function ChipsPreview({
  values,
  labelMap,
  emptyText,
}: {
  values: string[];
  labelMap?: Record<string, string>;
  emptyText: string;
}) {
  if (!values || values.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground italic">{emptyText}</p>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((v) => (
        <Badge key={v} variant="secondary" className="text-[11px]">
          {labelMap?.[v] ?? v}
        </Badge>
      ))}
    </div>
  );
}

function dayLabel(d: DayOfWeek): string {
  return { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" }[d];
}

function HoursPreview({ hours }: { hours: HoursOfOperation | null }) {
  if (!hours || Object.keys(hours).length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground italic">Not set</p>
    );
  }
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
      {DAYS_OF_WEEK.map((d) => {
        const entry = hours[d];
        return (
          <li key={d} className="flex justify-between">
            <span className="text-muted-foreground">{dayLabel(d)}</span>
            <span className="text-stone-900 tabular-nums">
              {!entry || entry.closed
                ? "Closed"
                : `${entry.open}–${entry.close}`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function LetterheadPreview({
  facilityName,
  licenseNumber,
  city,
  logoUrl,
  overrideHeader,
  overrideFooter,
}: {
  facilityName: string;
  licenseNumber: string;
  city: string | null;
  logoUrl: string | null;
  overrideHeader: string | null;
  overrideFooter: string | null;
}) {
  const headerLine =
    overrideHeader && overrideHeader.trim().length > 0
      ? overrideHeader
      : defaultReportHeader(facilityName, licenseNumber, city ?? undefined);
  return (
    <div
      className="rounded border bg-white px-4 py-3 shadow-sm"
      style={{ borderColor: "var(--portal-border-subtle)" }}
      data-testid="letterhead-preview"
      aria-label="Report letterhead preview"
    >
      <div className="flex items-center gap-3 pb-2 border-b" style={{ borderColor: "var(--portal-border-subtle)" }}>
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={`${facilityName} logo`}
            className="h-10 w-10 object-contain"
          />
        ) : (
          <div className="h-10 w-10 rounded bg-stone-100 border" />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-stone-900 text-sm truncate">
            {headerLine}
          </p>
        </div>
      </div>
      <div className="pt-3 text-[11px] text-muted-foreground space-y-1">
        <p>
          [Report body content renders here — each PDF report inherits this
          letterhead automatically.]
        </p>
        {overrideFooter && overrideFooter.trim().length > 0 && (
          <p className="pt-2 mt-2 border-t text-[10px] italic" style={{ borderColor: "var(--portal-border-subtle)" }}>
            {overrideFooter}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Per-section edit dialogs ────────────────────────────────────────────────

interface DialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  overrides: FacilityProfileOverrides | null;
  onSave: (patch: Partial<FacilityProfileOverrides>) => void;
  saving: boolean;
}

function DialogFooterButtons({
  onCancel,
  onSubmit,
  saving,
  label = "Save",
}: {
  onCancel: () => void;
  onSubmit: () => void;
  saving: boolean;
  label?: string;
}) {
  return (
    <>
      <div className="flex gap-2 justify-end pt-2">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={onSubmit} disabled={saving}>
          {saving ? "Saving…" : label}
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground -mt-1 text-right">
        <kbd className="px-1 rounded border bg-gray-50">Enter</kbd> to save
      </p>
    </>
  );
}

function EditIdentityDialog({
  open,
  onOpenChange,
  overrides,
  defaultDba,
  onSave,
  saving,
}: DialogProps & { defaultDba: string | null }) {
  const [dbaName, setDbaName] = useState("");
  const [year, setYear] = useState("");

  useEffect(() => {
    if (!open) return;
    setDbaName(overrides?.dbaName ?? "");
    setYear(
      overrides?.yearEstablished ? String(overrides.yearEstablished) : "",
    );
  }, [open, overrides]);

  const submit = () => {
    const yearNum = year.trim() === "" ? null : Number(year);
    onSave({
      dbaName: dbaName.trim() === "" ? null : dbaName.trim(),
      yearEstablished:
        yearNum !== null && Number.isFinite(yearNum) ? yearNum : null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit identity & branding</DialogTitle>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={onSubmitKey(submit)}>
          <FormField
            label="DBA name"
            hint={defaultDba ? `Defaults to "${defaultDba}" if empty.` : undefined}
          >
            <Input
              value={dbaName}
              onChange={(e) => setDbaName(e.target.value)}
              placeholder={defaultDba ?? "Doing-business-as name"}
              data-testid="identity-dba-input"
            />
          </FormField>
          <FormField label="Year established">
            <Input
              type="number"
              inputMode="numeric"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="e.g. 2008"
              data-testid="identity-year-input"
            />
          </FormField>
          <DialogFooterButtons
            onCancel={() => onOpenChange(false)}
            onSubmit={submit}
            saving={saving}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditContactDialog({
  open,
  onOpenChange,
  overrides,
  onSave,
  saving,
}: DialogProps) {
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open) return;
    setPhone(overrides?.phone ?? "");
    setEmail(overrides?.email ?? "");
    setWebsite(overrides?.website ?? "");
    setDescription(overrides?.description ?? "");
  }, [open, overrides]);

  const submit = () =>
    onSave({
      phone: phone.trim() || null,
      email: email.trim() || null,
      website: website.trim() || null,
      description: description.trim() || null,
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit contact & basics</DialogTitle>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={onSubmitKey(submit)}>
          <FormField label="Phone">
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 555-5555"
            />
          </FormField>
          <FormField label="Email">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="contact@facility.com"
            />
          </FormField>
          <FormField label="Website">
            <Input
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://www.yourfacility.com"
            />
          </FormField>
          <FormField label="Description">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your facility, services, and what makes it special."
              className="resize-none min-h-[100px]"
            />
          </FormField>
          <DialogFooterButtons
            onCancel={() => onOpenChange(false)}
            onSubmit={submit}
            saving={saving}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditAddressDialog({
  open,
  onOpenChange,
  overrides,
  ccld,
  onSave,
  saving,
}: DialogProps & { ccld: FacilityProfileCcld | null }) {
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");

  useEffect(() => {
    if (!open) return;
    setLine1(overrides?.mailingAddressLine1 ?? "");
    setLine2(overrides?.mailingAddressLine2 ?? "");
    setCity(overrides?.mailingCity ?? "");
    setState(overrides?.mailingState ?? "");
    setZip(overrides?.mailingZip ?? "");
  }, [open, overrides]);

  const copyFromCcld = () => {
    setLine1(ccld?.address ?? "");
    setLine2("");
    setCity(ccld?.city ?? "");
    setState(ccld?.state ?? "");
    setZip(ccld?.zip ?? "");
  };

  const submit = () =>
    onSave({
      mailingAddressLine1: line1.trim() || null,
      mailingAddressLine2: line2.trim() || null,
      mailingCity: city.trim() || null,
      mailingState: state.trim() || null,
      mailingZip: zip.trim() || null,
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit mailing address</DialogTitle>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={onSubmitKey(submit)}>
          <div className="rounded-md bg-stone-50 border px-3 py-2 text-[12px]" style={{ borderColor: "var(--portal-border-subtle)" }}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">
                Licensed physical:&nbsp;
                <span className="text-stone-900">
                  {[ccld?.address, ccld?.city, ccld?.state, ccld?.zip]
                    .filter(Boolean)
                    .join(", ") || "Not on file"}
                </span>
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={copyFromCcld}
                disabled={!ccld?.address}
                data-testid="copy-to-mailing-btn"
                aria-label="Copy CCLD address to mailing"
              >
                <ClipboardCopy className="h-3.5 w-3.5 mr-1" />
                Copy to mailing
              </Button>
            </div>
          </div>
          <FormField label="Line 1">
            <Input
              value={line1}
              onChange={(e) => setLine1(e.target.value)}
              data-testid="mailing-line1-input"
            />
          </FormField>
          <FormField label="Line 2">
            <Input
              value={line2}
              onChange={(e) => setLine2(e.target.value)}
            />
          </FormField>
          <div className="grid grid-cols-3 gap-3">
            <FormField label="City" className="col-span-2">
              <Input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                data-testid="mailing-city-input"
              />
            </FormField>
            <FormField label="State">
              <Input
                value={state}
                onChange={(e) => setState(e.target.value)}
                maxLength={2}
              />
            </FormField>
          </div>
          <FormField label="ZIP">
            <Input value={zip} onChange={(e) => setZip(e.target.value)} />
          </FormField>
          <DialogFooterButtons
            onCancel={() => onOpenChange(false)}
            onSubmit={submit}
            saving={saving}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditHoursDialog({
  open,
  onOpenChange,
  overrides,
  onSave,
  saving,
}: DialogProps) {
  const [hours, setHours] = useState<HoursOfOperation>({});
  const [languages, setLanguages] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setHours(overrides?.hoursOfOperation ?? {});
    setLanguages(overrides?.languages ?? []);
  }, [open, overrides]);

  const setDay = (
    d: DayOfWeek,
    patch: Partial<{ open: string; close: string; closed: boolean }>,
  ) => {
    setHours((prev) => {
      const existing = prev[d] ?? { open: "09:00", close: "17:00" };
      return { ...prev, [d]: { ...existing, ...patch } };
    });
  };

  const toggleLang = (code: string) => {
    setLanguages((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  };

  const submit = () =>
    onSave({
      hoursOfOperation: hours,
      languages,
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit hours & languages</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-stone-700 mb-2">
              Hours of operation
            </p>
            <ul className="space-y-1.5">
              {DAYS_OF_WEEK.map((d) => {
                const entry = hours[d];
                const closed = entry?.closed ?? false;
                return (
                  <li key={d} className="flex items-center gap-2" data-testid={`hours-row-${d}`}>
                    <span className="w-12 text-[13px] text-stone-700">
                      {dayLabel(d)}
                    </span>
                    <Input
                      type="time"
                      value={entry?.open ?? "09:00"}
                      onChange={(e) => setDay(d, { open: e.target.value })}
                      disabled={closed}
                      className="w-28"
                      aria-label={`${dayLabel(d)} open time`}
                    />
                    <span className="text-muted-foreground text-xs">to</span>
                    <Input
                      type="time"
                      value={entry?.close ?? "17:00"}
                      onChange={(e) => setDay(d, { close: e.target.value })}
                      disabled={closed}
                      className="w-28"
                      aria-label={`${dayLabel(d)} close time`}
                    />
                    <label className="ml-auto flex items-center gap-1.5 text-[12px] text-stone-700">
                      <input
                        type="checkbox"
                        checked={closed}
                        onChange={(e) =>
                          setDay(d, { closed: e.target.checked })
                        }
                        aria-label={`${dayLabel(d)} closed`}
                      />
                      Closed
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            <p className="text-xs font-medium text-stone-700 mb-2">
              Languages spoken
            </p>
            <div className="flex flex-wrap gap-1.5">
              {FACILITY_LANGUAGES.map((l) => {
                const active = languages.includes(l.code);
                return (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => toggleLang(l.code)}
                    aria-pressed={active}
                    data-testid={`lang-chip-${l.code}`}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                      active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-white text-stone-700 hover:bg-stone-50",
                    )}
                  >
                    {l.label}
                  </button>
                );
              })}
            </div>
          </div>

          <DialogFooterButtons
            onCancel={() => onOpenChange(false)}
            onSubmit={submit}
            saving={saving}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditCareDialog({
  open,
  onOpenChange,
  overrides,
  onSave,
  saving,
}: DialogProps) {
  const [careTypes, setCareTypes] = useState<FacilityCareType[]>([]);
  const [accreditationsText, setAccreditationsText] = useState("");

  useEffect(() => {
    if (!open) return;
    setCareTypes((overrides?.careTypes ?? []) as FacilityCareType[]);
    setAccreditationsText((overrides?.accreditations ?? []).join(", "));
  }, [open, overrides]);

  const toggle = (t: FacilityCareType) => {
    setCareTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  };

  const submit = () => {
    const accreditations = accreditationsText
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    onSave({ careTypes, accreditations });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit care offered</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-stone-700 mb-2">
              Care types
            </p>
            <div className="flex flex-wrap gap-1.5">
              {FACILITY_CARE_TYPES.map((t) => {
                const active = careTypes.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggle(t)}
                    aria-pressed={active}
                    data-testid={`care-chip-${t}`}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                      active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-white text-stone-700 hover:bg-stone-50",
                    )}
                  >
                    {FACILITY_CARE_TYPE_LABELS[t]}
                  </button>
                );
              })}
            </div>
          </div>
          <FormField
            label="Accreditations"
            hint="Comma-separated. e.g. CARF, Joint Commission"
          >
            <Textarea
              value={accreditationsText}
              onChange={(e) => setAccreditationsText(e.target.value)}
              placeholder="CARF, Joint Commission"
              className="resize-none min-h-[80px]"
              data-testid="accreditations-input"
            />
          </FormField>
          <DialogFooterButtons
            onCancel={() => onOpenChange(false)}
            onSubmit={submit}
            saving={saving}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditAdminDialog({
  open,
  onOpenChange,
  overrides,
  onSave,
  saving,
}: DialogProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [license, setLicense] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(overrides?.administratorName ?? "");
    setPhone(overrides?.administratorPhone ?? "");
    setEmail(overrides?.administratorEmail ?? "");
    setLicense(overrides?.administratorLicenseNumber ?? "");
  }, [open, overrides]);

  const submit = () =>
    onSave({
      administratorName: name.trim() || null,
      administratorPhone: phone.trim() || null,
      administratorEmail: email.trim() || null,
      administratorLicenseNumber: license.trim() || null,
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit administrator</DialogTitle>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={onSubmitKey(submit)}>
          <FormField label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <FormField label="Phone">
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 555-5555"
            />
          </FormField>
          <FormField label="Email">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FormField>
          <FormField label="License number">
            <Input
              value={license}
              onChange={(e) => setLicense(e.target.value)}
            />
          </FormField>
          <DialogFooterButtons
            onCancel={() => onOpenChange(false)}
            onSubmit={submit}
            saving={saving}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditSocialDialog({
  open,
  onOpenChange,
  overrides,
  onSave,
  saving,
}: DialogProps) {
  const [fb, setFb] = useState("");
  const [ig, setIg] = useState("");
  const [li, setLi] = useState("");

  useEffect(() => {
    if (!open) return;
    setFb(overrides?.facebookUrl ?? "");
    setIg(overrides?.instagramUrl ?? "");
    setLi(overrides?.linkedinUrl ?? "");
  }, [open, overrides]);

  const submit = () =>
    onSave({
      facebookUrl: fb.trim() || null,
      instagramUrl: ig.trim() || null,
      linkedinUrl: li.trim() || null,
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit social links</DialogTitle>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={onSubmitKey(submit)}>
          <FormField label="Facebook URL">
            <Input
              value={fb}
              onChange={(e) => setFb(e.target.value)}
              placeholder="https://facebook.com/your-facility"
            />
          </FormField>
          <FormField label="Instagram URL">
            <Input
              value={ig}
              onChange={(e) => setIg(e.target.value)}
              placeholder="https://instagram.com/your-facility"
            />
          </FormField>
          <FormField label="LinkedIn URL">
            <Input
              value={li}
              onChange={(e) => setLi(e.target.value)}
              placeholder="https://linkedin.com/company/your-facility"
            />
          </FormField>
          <DialogFooterButtons
            onCancel={() => onOpenChange(false)}
            onSubmit={submit}
            saving={saving}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditLetterheadDialog({
  open,
  onOpenChange,
  overrides,
  onSave,
  saving,
  facilityName,
  licenseNumber,
  city,
  logoUrl,
}: DialogProps & {
  facilityName: string;
  licenseNumber: string;
  city: string | null;
  logoUrl: string | null;
}) {
  const [header, setHeader] = useState("");
  const [footer, setFooter] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    if (!open) return;
    setHeader(overrides?.reportHeaderText ?? "");
    setFooter(overrides?.reportFooterText ?? "");
    setShowPreview(false);
  }, [open, overrides]);

  const submit = () =>
    onSave({
      reportHeaderText: header.trim() || null,
      reportFooterText: footer.trim() || null,
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit report letterhead</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <FormField
            label="Header text"
            hint={`Defaults to "${defaultReportHeader(facilityName, licenseNumber, city ?? undefined)}".`}
          >
            <Input
              value={header}
              onChange={(e) => setHeader(e.target.value)}
              placeholder="Custom header line"
              data-testid="letterhead-header-input"
            />
          </FormField>
          <FormField label="Footer text" hint="Shown at the bottom of each report page.">
            <Textarea
              value={footer}
              onChange={(e) => setFooter(e.target.value)}
              placeholder="Confidential — for licensed use only."
              className="resize-none min-h-[80px]"
            />
          </FormField>
          <div className="flex items-center justify-between">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setShowPreview((v) => !v)}
              data-testid="letterhead-preview-toggle"
            >
              <Copy className="h-3.5 w-3.5 mr-1.5" />
              {showPreview ? "Hide preview" : "Preview"}
            </Button>
          </div>
          {showPreview && (
            <LetterheadPreview
              facilityName={facilityName}
              licenseNumber={licenseNumber}
              city={city}
              logoUrl={logoUrl}
              overrideHeader={header || null}
              overrideFooter={footer || null}
            />
          )}
          <DialogFooterButtons
            onCancel={() => onOpenChange(false)}
            onSubmit={submit}
            saving={saving}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

