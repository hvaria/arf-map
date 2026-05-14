/**
 * <StaffContent> — Wave 2 W3 extends Wave 0/1 with the Credentials tab.
 *
 * Pattern citations (Implementation Contract §2.5):
 *   - portal-tabs shell + shadcn <Tabs>:                StaffContent.tsx:386-391 (same file)
 *   - Page heading style:                                ComplianceContent.tsx:281
 *   - Summary tile grid + tone palette:                  ComplianceContent.tsx:289-302
 *   - AddX dialog skeleton (FormField + Enter-submit):   ComplianceContent.tsx:128-203
 *   - Loading skeleton row pattern:                      ComplianceContent.tsx:311-313
 *   - Empty-state dashed border:                         ComplianceContent.tsx:315-318
 *   - Mobile card collapse:                              StaffContent.tsx:471-493 (same file)
 *   - Evidence attachment + flushAttach:                 AttachEvidence.tsx
 *   - Audit trail icon button:                           AuditTrailButton.tsx
 *   - credentialSeverity reuse (no FE reimplementation): shared/staff-credentials.ts
 */
import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { toLocalEpochMs, todayLocal } from "@/lib/datetime";
import { FormField, onSubmitKey } from "@/components/operations/FormField";
import { AttachEvidence, type AttachEvidenceHandle } from "@/components/operations/AttachEvidence";
import { AuditTrailButton } from "@/components/operations/AuditTrailButton";
import { useSession } from "@/hooks/useSession";
import {
  CREDENTIAL_TYPES,
  CREDENTIAL_LABELS,
  ROLE_REQUIRED_CREDENTIALS,
  credentialSeverity,
  type CredentialType,
  type CredentialStatus,
} from "@shared/staff-credentials";
import {
  Plus,
  Users,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";

interface StaffMember {
  id: number;
  facilityNumber: string;
  firstName: string;
  lastName: string;
  role: string;
  status: "active" | "inactive" | "on_leave";
  hireDate: number;
  licenseExpiry: number | null;
  email: string;
  phone: string;
}

interface Shift {
  id: number;
  staffId: number;
  staffName: string;
  shiftType: "AM" | "PM" | "NOC";
  shiftDate: number;
  startTime: string;
  endTime: string;
}

const ROLES = [
  "administrator",
  "caregiver",
  "med_tech",
  "rn",
  "lpn",
  "activity_coordinator",
  "dietary",
  "housekeeping",
  "maintenance",
  "other",
];

const SHIFT_TYPES = ["AM", "PM", "NOC"] as const;

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ── Credentials types & helpers ──────────────────────────────────────────────

interface StaffCredentialRow {
  id: number;
  facilityNumber: string;
  staffId: number;
  credentialType: CredentialType;
  issuedAt: number | null;
  expiresAt: number | null;
  verifiedAt: number | null;
  verifiedBy: string | null;
  status: CredentialStatus;
  note: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

interface RegSettingRowLite {
  key: string;
  value: string;
}

interface EvaluateShiftResult {
  worst: "ok" | "warning" | "expired";
  missing: CredentialType[];
  expired: CredentialType[];
  warning: CredentialType[];
  ok: CredentialType[];
  warningDays?: number;
}

/** Parse CREDENTIAL_WARNING_DAYS from reg-settings list with safe default. */
function readWarningDays(rows: RegSettingRowLite[] | undefined): number {
  if (!rows) return 60;
  const row = rows.find((r) => r.key === "CREDENTIAL_WARNING_DAYS");
  if (!row) return 60;
  const n = parseInt(row.value, 10);
  return Number.isFinite(n) && n > 0 ? n : 60;
}

/** Compute (expired, warning, missing) counts per staff member. Pure. */
function summarizeStaffCredentials(
  staff: StaffMember[],
  rows: StaffCredentialRow[],
  warningDays: number,
  now: number = Date.now(),
): Map<number, { expired: number; warning: number; missing: number; worst: "ok" | "warning" | "expired" }> {
  const out = new Map<number, { expired: number; warning: number; missing: number; worst: "ok" | "warning" | "expired" }>();
  for (const s of staff) {
    const required = ROLE_REQUIRED_CREDENTIALS[s.role] ?? ROLE_REQUIRED_CREDENTIALS.other;
    const byType = new Map<CredentialType, StaffCredentialRow>();
    for (const r of rows) {
      if (r.staffId !== s.id) continue;
      if (r.status !== "active") continue;
      const cur = byType.get(r.credentialType);
      if (!cur) {
        byType.set(r.credentialType, r);
        continue;
      }
      // Most-forgiving (latest expiry; null beats any dated value).
      if (cur.expiresAt === null || r.expiresAt === null) {
        if (r.expiresAt === null) byType.set(r.credentialType, r);
      } else if (r.expiresAt > cur.expiresAt) {
        byType.set(r.credentialType, r);
      }
    }
    let expired = 0;
    let warning = 0;
    let missing = 0;
    for (const reqType of required) {
      const row = byType.get(reqType);
      if (!row) {
        missing += 1;
        continue;
      }
      const sev = credentialSeverity(row.expiresAt, warningDays, now);
      if (sev === "expired") expired += 1;
      else if (sev === "warning") warning += 1;
    }
    let worst: "ok" | "warning" | "expired" = "ok";
    if (expired > 0 || missing > 0) worst = "expired";
    else if (warning > 0) worst = "warning";
    out.set(s.id, { expired, warning, missing, worst });
  }
  return out;
}

const SEVERITY_BADGE: Record<"ok" | "warning" | "expired", string> = {
  ok: "bg-emerald-100 text-emerald-700 border-emerald-200",
  warning: "bg-amber-100 text-amber-700 border-amber-200",
  expired: "bg-red-100 text-red-700 border-red-200",
};

const SEVERITY_LABEL: Record<"ok" | "warning" | "expired", string> = {
  ok: "OK",
  warning: "Expiring soon",
  expired: "Action needed",
};

function AddStaffDialog({
  open,
  onOpenChange,
  facilityNumber,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  facilityNumber: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    role: "",
    email: "",
    phone: "",
    hireDate: "",
    licenseExpiry: "",
    status: "active",
  });

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const [showErrors, setShowErrors] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/ops/staff`, {
        ...form,
        hireDate: form.hireDate ? toLocalEpochMs(form.hireDate) : Date.now(),
        licenseExpiry: form.licenseExpiry ? toLocalEpochMs(form.licenseExpiry) : null,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/ops/facilities/${facilityNumber}/staff`] });
      toast({ title: "Staff member added" });
      onOpenChange(false);
      setShowErrors(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Inline validation: required fields + future-only license expiry.
  const expiryMs = form.licenseExpiry ? toLocalEpochMs(form.licenseExpiry) : null;
  const errors = {
    firstName: !form.firstName.trim() ? "First name is required" : undefined,
    lastName:  !form.lastName.trim() ? "Last name is required" : undefined,
    role:      !form.role ? "Pick a role" : undefined,
    licenseExpiry:
      expiryMs !== null && expiryMs <= Date.now() ? "Must be a future date" : undefined,
  };
  const isValid =
    !errors.firstName && !errors.lastName && !errors.role && !errors.licenseExpiry;
  const submit = () => {
    if (!isValid || mutation.isPending) {
      setShowErrors(true);
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Staff Member</DialogTitle>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={onSubmitKey(submit)}>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="First Name" required error={showErrors ? errors.firstName : undefined}>
              <Input value={form.firstName} onChange={(e) => set("firstName", e.target.value)} placeholder="First name" />
            </FormField>
            <FormField label="Last Name" required error={showErrors ? errors.lastName : undefined}>
              <Input value={form.lastName} onChange={(e) => set("lastName", e.target.value)} placeholder="Last name" />
            </FormField>
          </div>
          <FormField label="Role" required error={showErrors ? errors.role : undefined}>
            <Select value={form.role} onValueChange={(v) => set("role", v)}>
              <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r} className="capitalize">{r.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Email">
              <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="email@example.com" />
            </FormField>
            <FormField label="Phone">
              <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="Phone" />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Hire Date">
              <Input type="date" value={form.hireDate} onChange={(e) => set("hireDate", e.target.value)} />
            </FormField>
            <FormField
              label="License Expiry"
              error={showErrors ? errors.licenseExpiry : undefined}
              hint="Must be in the future"
            >
              <Input type="date" value={form.licenseExpiry} onChange={(e) => set("licenseExpiry", e.target.value)} />
            </FormField>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} disabled={mutation.isPending}>
              {mutation.isPending ? "Adding..." : "Add Staff"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddShiftDialog({
  open,
  onOpenChange,
  facilityNumber,
  staff,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  facilityNumber: string;
  staff: StaffMember[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState(() => ({
    staffId: "",
    shiftType: "AM" as typeof SHIFT_TYPES[number],
    shiftDate: todayLocal(),
    startTime: "06:00",
    endTime: "14:00",
  }));

  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const [showErrors, setShowErrors] = useState(false);
  const [overrideMode, setOverrideMode] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  // Reset override state whenever the user changes staff or shift date.
  // Otherwise a stale override could silently allow saving for a different
  // staff member than the one that was originally evaluated.
  const handleStaffChange = (v: string) => {
    set("staffId", v);
    setOverrideMode(false);
    setOverrideReason("");
  };
  const handleDateChange = (v: string) => {
    set("shiftDate", v);
    setOverrideMode(false);
    setOverrideReason("");
  };

  const shiftAtMs = useMemo(
    () => (form.shiftDate ? toLocalEpochMs(form.shiftDate) : 0),
    [form.shiftDate],
  );

  // Credential check fires once both staff + shift date are set.
  const checkKey = [
    `/api/ops/facilities/${facilityNumber}/credentials/evaluate-shift`,
    { staffId: form.staffId, shiftAtMs },
  ] as const;
  const credentialCheck = useQuery<EvaluateShiftResult | null>({
    queryKey: checkKey,
    queryFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/ops/facilities/${facilityNumber}/credentials/evaluate-shift`,
        { staffId: Number(form.staffId), shiftAtMs },
      );
      const json = (await res.json()) as { success: boolean; data: EvaluateShiftResult };
      return json?.data ?? null;
    },
    enabled: open && !!form.staffId && shiftAtMs > 0,
    staleTime: 60_000,
    retry: false,
  });

  const checkResult = credentialCheck.data;
  const worst = checkResult?.worst ?? "ok";

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        ...form,
        staffId: Number(form.staffId),
        shiftDate: toLocalEpochMs(form.shiftDate),
      };
      // Phase 5 §6 emergency-override hatch: include the reason so a future
      // server retrofit (Wave 4) can audit it. v0 server ignores the field;
      // ignored fields don't break the request.
      if (overrideMode && overrideReason.trim()) {
        body.overrideReason = overrideReason.trim();
      }
      const res = await apiRequest("POST", `/api/ops/shifts`, body);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/ops/facilities/${facilityNumber}/schedule`] });
      toast({ title: "Shift added" });
      onOpenChange(false);
      setShowErrors(false);
      setOverrideMode(false);
      setOverrideReason("");
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Inline validation: pick a person, sane time order.
  const errors = {
    staffId: !form.staffId ? "Pick a staff member" : undefined,
    times: form.startTime >= form.endTime ? "End time must be after start" : undefined,
    override:
      overrideMode && !overrideReason.trim()
        ? "Reason is required to override the credential block"
        : undefined,
  };
  const isValid = !errors.staffId && !errors.times && !errors.override;

  // Block save when credentials are expired/missing unless override is active.
  const blockedByCredentials = worst === "expired" && !overrideMode;
  const saveDisabled =
    mutation.isPending ||
    blockedByCredentials ||
    (overrideMode && !overrideReason.trim());

  const submit = () => {
    if (!isValid || saveDisabled) {
      setShowErrors(true);
      return;
    }
    mutation.mutate();
  };

  const fmtList = (types: CredentialType[]): string =>
    types.map((t) => CREDENTIAL_LABELS[t]).join(", ");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Shift</DialogTitle>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={onSubmitKey(submit)}>
          <FormField label="Staff Member" required error={showErrors ? errors.staffId : undefined}>
            <Select value={form.staffId} onValueChange={handleStaffChange}>
              <SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger>
              <SelectContent>
                {staff.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.firstName} {s.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Shift Type">
              <Select value={form.shiftType} onValueChange={(v) => set("shiftType", v as typeof SHIFT_TYPES[number])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SHIFT_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Date">
              <Input type="date" value={form.shiftDate} onChange={(e) => handleDateChange(e.target.value)} />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Start Time" error={showErrors ? errors.times : undefined}>
              <Input type="time" value={form.startTime} onChange={(e) => set("startTime", e.target.value)} />
            </FormField>
            <FormField label="End Time">
              <Input type="time" value={form.endTime} onChange={(e) => set("endTime", e.target.value)} />
            </FormField>
          </div>

          {/* Credential check notices — non-blocking warning vs. blocking expired */}
          {form.staffId && checkResult && worst === "warning" && (
            <div
              role="status"
              className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 flex items-start gap-1.5"
              data-testid="shift-cred-warning"
            >
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div>
                <span className="font-medium">
                  {checkResult.warning.length} credential
                  {checkResult.warning.length !== 1 ? "s" : ""} expiring soon:
                </span>{" "}
                {fmtList(checkResult.warning)}. Shift will be scheduled.
              </div>
            </div>
          )}
          {form.staffId && checkResult && worst === "expired" && (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800 flex items-start gap-1.5"
              data-testid="shift-cred-blocked"
            >
              <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div>
                <span className="font-medium">Blocked:</span>{" "}
                {checkResult.missing.length > 0 && (
                  <>missing {fmtList(checkResult.missing)}</>
                )}
                {checkResult.missing.length > 0 && checkResult.expired.length > 0 && "; "}
                {checkResult.expired.length > 0 && (
                  <>expired {fmtList(checkResult.expired)}</>
                )}
                . Renew before scheduling.
              </div>
            </div>
          )}

          {/* Phase 5 §6 emergency override hatch — only visible when blocked */}
          {form.staffId && checkResult && worst === "expired" && (
            <div className="rounded-md border border-dashed border-red-200 p-2 space-y-2">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={overrideMode}
                  onChange={(e) => {
                    setOverrideMode(e.target.checked);
                    if (!e.target.checked) setOverrideReason("");
                  }}
                  aria-label="Override credential block with reason"
                  data-testid="shift-override-toggle"
                />
                <span>Override with reason</span>
              </label>
              {overrideMode && (
                <FormField
                  label="Reason for override"
                  required
                  error={showErrors ? errors.override : undefined}
                >
                  <Textarea
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="Why is this shift being scheduled despite the credential block? (audited)"
                    className="resize-none min-h-[60px] text-xs"
                    aria-invalid={!!(showErrors && errors.override)}
                    data-testid="shift-override-reason"
                  />
                </FormField>
              )}
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              onClick={submit}
              disabled={saveDisabled}
              data-testid="shift-save"
            >
              {mutation.isPending ? "Adding..." : "Add Shift"}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground -mt-1 text-right">
            <kbd className="px-1 rounded border bg-gray-50">Enter</kbd> to save
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WeeklySchedule({ shifts }: { shifts: Shift[] }) {
  // Build a week starting from Sunday
  const today = new Date();
  const dayOfWeek = today.getDay();
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - dayOfWeek);
  sunday.setHours(0, 0, 0, 0);

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    return d;
  });

  const getShiftsForDayAndType = (day: Date, shiftType: typeof SHIFT_TYPES[number]) => {
    return shifts.filter((s) => {
      const sd = new Date(s.shiftDate);
      sd.setHours(0, 0, 0, 0);
      return sd.getTime() === day.getTime() && s.shiftType === shiftType;
    });
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse min-w-[600px]">
        <thead>
          <tr>
            <th className="border px-2 py-2 text-left bg-muted/50 w-16">Shift</th>
            {weekDays.map((d, i) => (
              <th key={i} className={cn("border px-2 py-2 text-center bg-muted/50", d.toDateString() === today.toDateString() ? "bg-primary/10" : "")}>
                <div>{DAYS_OF_WEEK[d.getDay()]}</div>
                <div className="text-muted-foreground font-normal">{d.getDate()}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SHIFT_TYPES.map((shiftType) => (
            <tr key={shiftType}>
              <td className="border px-2 py-2 font-medium bg-muted/20">{shiftType}</td>
              {weekDays.map((d, i) => {
                const dayShifts = getShiftsForDayAndType(d, shiftType);
                return (
                  <td key={i} className="border px-1 py-1 align-top min-h-[40px]">
                    {dayShifts.map((s) => (
                      <div key={s.id} className="text-xs bg-primary/10 rounded px-1 py-0.5 mb-0.5 truncate">
                        {s.staffName}
                      </div>
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// W3 Credentials — AddCredentialDialog
// ─────────────────────────────────────────────────────────────────────────────

function AddCredentialDialog({
  open,
  onOpenChange,
  facilityNumber,
  staffId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  facilityNumber: string;
  staffId: number;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: session } = useSession();
  const evidenceRef = useRef<AttachEvidenceHandle | null>(null);

  const [form, setForm] = useState({
    credentialType: "" as CredentialType | "",
    issuedAt: "",
    expiresAt: "",
    verifiedBy: session?.username ?? "",
    note: "",
  });
  const [showErrors, setShowErrors] = useState(false);

  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Reset form whenever the dialog opens fresh.
  // Keep verifiedBy pre-populated from session.
  // (Not in a useEffect — controlled by `open` prop transitions via key prop on parent.)

  const errors = {
    credentialType: !form.credentialType ? "Pick a credential type" : undefined,
    note:
      form.credentialType === "other" && !form.note.trim()
        ? "Note is required when type is Other"
        : undefined,
  };
  const isValid = !errors.credentialType && !errors.note;

  const mutation = useMutation({
    mutationFn: async () => {
      const issuedAtMs = form.issuedAt ? toLocalEpochMs(form.issuedAt) : null;
      const expiresAtMs = form.expiresAt ? toLocalEpochMs(form.expiresAt) : null;
      const res = await apiRequest("POST", `/api/ops/staff-credentials`, {
        staffId,
        credentialType: form.credentialType,
        issuedAt: issuedAtMs,
        expiresAt: expiresAtMs,
        verifiedBy: form.verifiedBy.trim() || null,
        note: form.note.trim() || null,
      });
      return (await res.json()) as { success: boolean; data: StaffCredentialRow };
    },
    onSuccess: async (payload) => {
      const newId = payload?.data?.id;
      if (newId && evidenceRef.current && evidenceRef.current.pendingCount > 0) {
        try {
          await evidenceRef.current.flushAttach(newId);
        } catch {
          // AttachEvidence has its own toast on upload error; record will still
          // exist without evidence so the user can retry from the detail view.
        }
      }
      qc.invalidateQueries({
        queryKey: [`/api/ops/facilities/${facilityNumber}/staff-credentials`],
      });
      toast({ title: "Credential added" });
      onOpenChange(false);
      setShowErrors(false);
      setForm({
        credentialType: "",
        issuedAt: "",
        expiresAt: "",
        verifiedBy: session?.username ?? "",
        note: "",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't add credential", description: err.message, variant: "destructive" });
    },
  });

  const submit = () => {
    if (!isValid || mutation.isPending) {
      setShowErrors(true);
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Credential</DialogTitle>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={onSubmitKey(submit)}>
          <FormField
            label="Credential type"
            required
            error={showErrors ? errors.credentialType : undefined}
          >
            <Select
              value={form.credentialType}
              onValueChange={(v) => set("credentialType", v as CredentialType)}
            >
              <SelectTrigger data-testid="cred-type-trigger">
                <SelectValue placeholder="Select credential" />
              </SelectTrigger>
              <SelectContent>
                {CREDENTIAL_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {CREDENTIAL_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Issued at">
              <Input
                type="date"
                value={form.issuedAt}
                onChange={(e) => set("issuedAt", e.target.value)}
                data-testid="cred-issued-at"
              />
            </FormField>
            <FormField
              label="Expires at"
              hint="Leave blank for non-expiring (e.g., Live Scan continuous)"
            >
              <Input
                type="date"
                value={form.expiresAt}
                onChange={(e) => set("expiresAt", e.target.value)}
                data-testid="cred-expires-at"
              />
            </FormField>
          </div>

          <FormField label="Verified by">
            <Input
              value={form.verifiedBy}
              onChange={(e) => set("verifiedBy", e.target.value)}
              placeholder="Your name"
            />
          </FormField>

          <FormField
            label="Note"
            required={form.credentialType === "other"}
            error={showErrors ? errors.note : undefined}
          >
            <Textarea
              value={form.note}
              onChange={(e) => set("note", e.target.value)}
              placeholder={
                form.credentialType === "other"
                  ? "Describe this credential (required for Other)"
                  : "Optional context for the audit trail"
              }
              className="resize-none min-h-[60px] text-sm"
              aria-invalid={!!(showErrors && errors.note)}
              data-testid="cred-note"
            />
          </FormField>

          <FormField label="Evidence">
            <AttachEvidence
              ref={evidenceRef}
              entityType="ops_staff_credential"
              entityId={undefined}
              facilityNumber={facilityNumber}
              triggerLabel="Add certificate or proof"
            />
          </FormField>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              onClick={submit}
              disabled={mutation.isPending}
              variant="gradient"
              data-testid="cred-save"
            >
              {mutation.isPending ? "Saving…" : "Add Credential"}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground -mt-1 text-right">
            <kbd className="px-1 rounded border bg-gray-50">Enter</kbd> to save
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// W3 Credentials — per-staff detail view
// ─────────────────────────────────────────────────────────────────────────────

function CredentialDetailView({
  facilityNumber,
  staff,
  onBack,
  warningDays,
}: {
  facilityNumber: string;
  staff: StaffMember;
  onBack: () => void;
  warningDays: number;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);

  const listKey = [
    `/api/ops/facilities/${facilityNumber}/staff-credentials`,
    { staffId: staff.id },
  ] as const;

  const { data: envelope, isLoading } = useQuery<{
    success: boolean;
    data: StaffCredentialRow[];
  } | null>({
    queryKey: listKey,
    queryFn: async () => {
      const params = new URLSearchParams({ staffId: String(staff.id), limit: "100", page: "1" });
      const res = await fetch(
        `/api/ops/facilities/${facilityNumber}/staff-credentials?${params}`,
        { credentials: "include" },
      );
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!facilityNumber && !!staff.id,
    staleTime: 60_000,
  });

  const rows = envelope?.data ?? [];
  const required = ROLE_REQUIRED_CREDENTIALS[staff.role] ?? ROLE_REQUIRED_CREDENTIALS.other;
  const requiredSet = new Set<CredentialType>(required);

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/ops/staff-credentials/${id}`);
      return res.json();
    },
    onMutate: async (id: number) => {
      await qc.cancelQueries({ queryKey: listKey });
      const prev = qc.getQueryData<{ data: StaffCredentialRow[] }>(listKey);
      if (prev?.data) {
        qc.setQueryData(listKey, {
          ...prev,
          data: prev.data.filter((r) => r.id !== id),
        });
      }
      return { prev };
    },
    onError: (err: Error, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(listKey, ctx.prev);
      toast({ title: "Couldn't delete credential", description: err.message, variant: "destructive" });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: listKey });
    },
  });

  const groupedRequired = required
    .map((t) => ({
      type: t,
      rows: rows.filter((r) => r.credentialType === t),
    }));
  const additional = rows.filter((r) => !requiredSet.has(r.credentialType));

  return (
    <div className="space-y-4" data-testid="cred-detail-view">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Back to credentials list"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to staff credentials
      </button>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">{staff.firstName} {staff.lastName}</h2>
          <p className="text-xs text-muted-foreground capitalize">
            {staff.role?.replace(/_/g, " ")}
          </p>
        </div>
        <Button size="sm" variant="gradient" onClick={() => setAddOpen(true)} data-testid="cred-add-trigger">
          <Plus className="h-4 w-4 mr-1.5" />
          Add credential
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-md" />)}
        </div>
      ) : (
        <div className="space-y-6">
          <section data-testid="cred-required-group">
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Required for role</h3>
            <div className="space-y-2">
              {groupedRequired.map((g) => (
                <CredentialGroup
                  key={g.type}
                  credentialType={g.type}
                  rows={g.rows}
                  facilityNumber={facilityNumber}
                  warningDays={warningDays}
                  onDelete={(id) => deleteMutation.mutate(id)}
                  isRequired
                />
              ))}
            </div>
          </section>

          <section data-testid="cred-additional-group">
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Additional credentials</h3>
            {additional.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                No additional credentials recorded.
              </div>
            ) : (
              <div className="space-y-2">
                {Array.from(new Set(additional.map((r) => r.credentialType))).map((t) => (
                  <CredentialGroup
                    key={t}
                    credentialType={t}
                    rows={additional.filter((r) => r.credentialType === t)}
                    facilityNumber={facilityNumber}
                    warningDays={warningDays}
                    onDelete={(id) => deleteMutation.mutate(id)}
                    isRequired={false}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      <AddCredentialDialog
        key={addOpen ? "open" : "closed"}
        open={addOpen}
        onOpenChange={setAddOpen}
        facilityNumber={facilityNumber}
        staffId={staff.id}
      />
    </div>
  );
}

function CredentialGroup({
  credentialType,
  rows,
  facilityNumber,
  warningDays,
  onDelete,
  isRequired,
}: {
  credentialType: CredentialType;
  rows: StaffCredentialRow[];
  facilityNumber: string;
  warningDays: number;
  onDelete: (id: number) => void;
  isRequired: boolean;
}) {
  const label = CREDENTIAL_LABELS[credentialType];
  if (rows.length === 0) {
    return (
      <div
        className="rounded-lg border border-dashed p-3 flex items-center justify-between gap-2"
        data-testid={`cred-empty-${credentialType}`}
      >
        <div className="text-sm">
          <span className="font-medium">{label}</span>
          {isRequired && (
            <Badge variant="outline" className="ml-2 text-[10px] bg-red-50 text-red-700 border-red-200">
              Missing required
            </Badge>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border bg-white">
      {rows.map((row) => {
        const sev = credentialSeverity(row.expiresAt, warningDays);
        return (
          <div
            key={row.id}
            className="p-3 flex items-start gap-3 border-b last:border-b-0"
            data-testid="cred-row"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">{label}</span>
                <span
                  className={cn(
                    "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border capitalize",
                    SEVERITY_BADGE[sev],
                  )}
                >
                  {SEVERITY_LABEL[sev]}
                </span>
                {isRequired && (
                  <span className="text-[10px] text-muted-foreground">Required</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5 flex gap-3 flex-wrap">
                <span>
                  Issued {row.issuedAt ? new Date(row.issuedAt).toLocaleDateString() : "—"}
                </span>
                <span>
                  Expires {row.expiresAt ? new Date(row.expiresAt).toLocaleDateString() : "non-expiring"}
                </span>
                {row.verifiedBy && <span>Verified by {row.verifiedBy}</span>}
              </div>
              {row.note && (
                <p className="text-xs text-muted-foreground mt-1 italic">{row.note}</p>
              )}
              <div className="mt-2">
                <AttachEvidence
                  entityType="ops_staff_credential"
                  entityId={row.id}
                  facilityNumber={facilityNumber}
                  triggerLabel="Add certificate or proof"
                />
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <AuditTrailButton
                entityType="ops_staff_credential"
                entityId={row.id}
                facilityNumber={facilityNumber}
              />
              <button
                type="button"
                onClick={() => onDelete(row.id)}
                aria-label={`Delete ${label}`}
                className="rounded p-1 text-muted-foreground hover:text-destructive focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                data-testid="cred-delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// W3 Credentials — per-staff list (default view)
// ─────────────────────────────────────────────────────────────────────────────

function CredentialsListView({
  facilityNumber,
  staff,
  loadingStaff,
  onSelectStaff,
  warningDays,
}: {
  facilityNumber: string;
  staff: StaffMember[];
  loadingStaff: boolean;
  onSelectStaff: (s: StaffMember) => void;
  warningDays: number;
}) {
  // Read all credentials for the facility — bounded by staff count (~100 user
  // scale; <500 active rows in practice). One query + cache.
  const { data: credsEnv, isLoading: loadingCreds } = useQuery<{
    success: boolean;
    data: StaffCredentialRow[];
  } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/staff-credentials`],
    queryFn: async () => {
      const res = await fetch(
        `/api/ops/facilities/${facilityNumber}/staff-credentials?page=1&limit=100`,
        { credentials: "include" },
      );
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!facilityNumber,
    staleTime: 60_000,
  });

  const rows = credsEnv?.data ?? [];
  const summary = useMemo(
    () => summarizeStaffCredentials(staff, rows, warningDays),
    [staff, rows, warningDays],
  );

  const expiringSoonCount = Array.from(summary.values()).filter((s) => s.warning > 0).length;
  const expiredCount = Array.from(summary.values()).filter((s) => s.expired > 0).length;
  const missingCount = Array.from(summary.values()).filter((s) => s.missing > 0).length;

  const isLoading = loadingStaff || loadingCreds;

  return (
    <div className="space-y-4" data-testid="cred-list-view">
      <h2 className="text-base font-semibold" style={{ color: "#1E1B4B" }}>
        Staff credentials
      </h2>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-center">
          <p className="text-xl font-bold text-amber-700">{expiringSoonCount}</p>
          <p className="text-xs text-amber-700">Expiring soon</p>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-center">
          <p className="text-xl font-bold text-red-700">{expiredCount}</p>
          <p className="text-xs text-red-600">Expired</p>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-center">
          <p className="text-xl font-bold text-red-700">{missingCount}</p>
          <p className="text-xs text-red-600">Missing required</p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      ) : staff.length === 0 ? (
        <div
          className="rounded-lg border border-dashed p-10 text-center"
          data-testid="cred-empty"
        >
          <ShieldCheck className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            Add staff in the Directory tab to start tracking credentials.
          </p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Name</th>
                  <th className="text-left px-4 py-3 font-medium">Role</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Expiring</th>
                  <th className="text-left px-4 py-3 font-medium">Expired</th>
                  <th className="text-left px-4 py-3 font-medium">Missing</th>
                  <th className="text-right px-4 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {staff.map((s) => {
                  const sum = summary.get(s.id) ?? { expired: 0, warning: 0, missing: 0, worst: "ok" as const };
                  return (
                    <tr key={s.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-medium">{s.firstName} {s.lastName}</td>
                      <td className="px-4 py-3 capitalize text-muted-foreground">
                        {s.role?.replace(/_/g, " ")}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border capitalize",
                            SEVERITY_BADGE[sum.worst],
                          )}
                        >
                          {SEVERITY_LABEL[sum.worst]}
                        </span>
                      </td>
                      <td className="px-4 py-3 portal-num">{sum.warning}</td>
                      <td className="px-4 py-3 portal-num">{sum.expired}</td>
                      <td className="px-4 py-3 portal-num">{sum.missing}</td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onSelectStaff(s)}
                          aria-label={`View credentials for ${s.firstName} ${s.lastName}`}
                          data-testid={`cred-view-${s.id}`}
                        >
                          View credentials
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="md:hidden space-y-2">
            {staff.map((s) => {
              const sum = summary.get(s.id) ?? { expired: 0, warning: 0, missing: 0, worst: "ok" as const };
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSelectStaff(s)}
                  className="w-full text-left rounded-lg border p-3 hover:bg-muted/20 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label={`View credentials for ${s.firstName} ${s.lastName}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm">{s.firstName} {s.lastName}</span>
                    <span
                      className={cn(
                        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border capitalize",
                        SEVERITY_BADGE[sum.worst],
                      )}
                    >
                      {SEVERITY_LABEL[sum.worst]}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-1 text-xs text-muted-foreground">
                    <span className="capitalize">{s.role?.replace(/_/g, " ")}</span>
                    <span>Expiring {sum.warning}</span>
                    <span>Expired {sum.expired}</span>
                    <span>Missing {sum.missing}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export function StaffContent({ facilityNumber, onBack }: { facilityNumber: string; onBack?: () => void }) {
  const [addStaffOpen, setAddStaffOpen] = useState(false);
  const [addShiftOpen, setAddShiftOpen] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);

  const { data: staffEnvelope, isLoading: loadingStaff, error: staffError } = useQuery<{ success: boolean; data: StaffMember[] } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/staff`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
  });

  const { data: shiftsEnvelope, isLoading: loadingShifts } = useQuery<{ success: boolean; data: Shift[] } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/schedule`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
  });

  // Reg-settings drives CREDENTIAL_WARNING_DAYS for FE severity calc (parity
  // with the server-side default in evaluate-shift).
  const { data: regSettingsEnv } = useQuery<{ success: boolean; data: RegSettingRowLite[] } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/reg-settings`],
    queryFn: async () => {
      const res = await fetch(
        `/api/ops/facilities/${facilityNumber}/reg-settings`,
        { credentials: "include" },
      );
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!facilityNumber,
    staleTime: 60_000,
  });
  const warningDays = readWarningDays(regSettingsEnv?.data);

  const staff = staffEnvelope?.data ?? [];
  const shifts = shiftsEnvelope?.data ?? [];

  const now = Date.now();

  return (
    <div className="space-y-4">
      {onBack && (
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Overview
        </button>
      )}

      <h1 className="text-xl font-semibold" style={{ color: '#1E1B4B' }}>Staff</h1>

      <div className="portal-tabs">
      <Tabs defaultValue="directory">
        <TabsList className="w-full">
          <TabsTrigger value="directory" className="flex-1">Directory</TabsTrigger>
          <TabsTrigger value="schedule" className="flex-1">Schedule</TabsTrigger>
          <TabsTrigger value="credentials" className="flex-1" data-testid="cred-tab-trigger">
            Credentials
          </TabsTrigger>
        </TabsList>

        {/* Directory Tab */}
        <TabsContent value="directory" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button size="sm" variant="gradient" onClick={() => setAddStaffOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              Add Staff
            </Button>
          </div>

          {staffError && (
            <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
              Failed to load staff.
            </div>
          )}

          {loadingStaff ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : staff.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center">
              <Users className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No staff members yet.</p>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium">Name</th>
                      <th className="text-left px-4 py-3 font-medium">Role</th>
                      <th className="text-left px-4 py-3 font-medium">Status</th>
                      <th className="text-left px-4 py-3 font-medium">Hire Date</th>
                      <th className="text-left px-4 py-3 font-medium">License Expiry</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {staff.map((s) => {
                      const licExpired = s.licenseExpiry && s.licenseExpiry < now;
                      return (
                        <tr key={s.id} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3 font-medium">{s.firstName} {s.lastName}</td>
                          <td className="px-4 py-3">
                            <Badge variant="secondary" className="capitalize text-xs">
                              {s.role?.replace(/_/g, " ")}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              variant={s.status === "active" ? "default" : "outline"}
                              className="text-xs capitalize"
                            >
                              {s.status?.replace(/_/g, " ")}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {s.hireDate ? new Date(s.hireDate).toLocaleDateString() : "—"}
                          </td>
                          <td className="px-4 py-3">
                            {s.licenseExpiry ? (
                              <span className={cn("flex items-center gap-1 text-sm", licExpired ? "text-red-600" : "text-muted-foreground")}>
                                {licExpired && <AlertCircle className="h-3.5 w-3.5" />}
                                {new Date(s.licenseExpiry).toLocaleDateString()}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile card list */}
              <div className="md:hidden space-y-2">
                {staff.map((s) => {
                  const licExpired = s.licenseExpiry && s.licenseExpiry < now;
                  return (
                    <div key={s.id} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm">{s.firstName} {s.lastName}</span>
                        <Badge variant={s.status === "active" ? "default" : "outline"} className="text-xs capitalize">
                          {s.status?.replace(/_/g, " ")}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-1 text-xs text-muted-foreground">
                        <span className="capitalize">{s.role?.replace(/_/g, " ")}</span>
                        {s.licenseExpiry && (
                          <span className={cn(licExpired ? "text-red-600" : "")}>
                            {licExpired && "EXPIRED: "}Lic expires {new Date(s.licenseExpiry).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <AddStaffDialog open={addStaffOpen} onOpenChange={setAddStaffOpen} facilityNumber={facilityNumber} />
        </TabsContent>

        {/* Schedule Tab */}
        <TabsContent value="schedule" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button size="sm" variant="gradient" onClick={() => setAddShiftOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              Add Shift
            </Button>
          </div>

          {loadingShifts ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <WeeklySchedule shifts={shifts} />
          )}

          <AddShiftDialog
            open={addShiftOpen}
            onOpenChange={setAddShiftOpen}
            facilityNumber={facilityNumber}
            staff={staff}
          />
        </TabsContent>

        {/* Credentials Tab — W3 */}
        <TabsContent value="credentials" className="mt-4 space-y-4">
          {selectedStaff ? (
            <CredentialDetailView
              facilityNumber={facilityNumber}
              staff={selectedStaff}
              onBack={() => setSelectedStaff(null)}
              warningDays={warningDays}
            />
          ) : (
            <CredentialsListView
              facilityNumber={facilityNumber}
              staff={staff}
              loadingStaff={loadingStaff}
              onSelectStaff={setSelectedStaff}
              warningDays={warningDays}
            />
          )}
        </TabsContent>
      </Tabs>
      </div>
    </div>
  );
}
