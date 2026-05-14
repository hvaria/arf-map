import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, ShieldCheck } from "lucide-react";
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
import { apiRequest } from "@/lib/queryClient";
import type { JobSeekerCredential, CredentialKind } from "@shared/schema";
import {
  CREDENTIAL_LABEL,
  CredentialBadge,
  useCredentials,
} from "@/components/CredentialBadge";

const KIND_ORDER: CredentialKind[] = [
  "CNA",
  "LVN",
  "RN",
  "RCFE_ADMIN",
  "ARF_ADMIN",
  "DSP_YEAR_1",
  "DSP_YEAR_2",
  "MED_TECH",
  "MANDATED_REPORTER",
  "RCFE_40_HOUR",
  "LIVE_SCAN",
  "TB",
  "CPR",
  "FIRST_AID",
  "OTHER",
];

interface FormState {
  kind: CredentialKind;
  label: string;
  licenseNumber: string;
  issuingAuthority: string;
  issuedAt: string;
  expiresAt: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  kind: "CNA",
  label: "",
  licenseNumber: "",
  issuingAuthority: "",
  issuedAt: "",
  expiresAt: "",
  notes: "",
};

function fromCredential(c: JobSeekerCredential): FormState {
  return {
    kind: c.kind as CredentialKind,
    label: c.label ?? "",
    licenseNumber: c.licenseNumber ?? "",
    issuingAuthority: c.issuingAuthority ?? "",
    issuedAt: c.issuedAt ?? "",
    expiresAt: c.expiresAt ?? "",
    notes: c.notes ?? "",
  };
}

// Strip empty strings so we send `undefined` (omit) to the server —
// matches credentialInputSchema's `.optional()` shape and prevents
// "" from clobbering a previously-set value on PUT.
function toPayload(form: FormState) {
  const trim = (s: string) => (s.trim() === "" ? undefined : s.trim());
  return {
    kind: form.kind,
    label: trim(form.label),
    licenseNumber: trim(form.licenseNumber),
    issuingAuthority: trim(form.issuingAuthority),
    issuedAt: trim(form.issuedAt),
    expiresAt: trim(form.expiresAt),
    notes: trim(form.notes),
  };
}

function is409(err: unknown): boolean {
  // throwIfResNotOk surfaces the server message; the server returns
  // a 409 with a body containing "already" in the message. Defensive:
  // also match status code substring if it ever leaks through.
  const msg = err instanceof Error ? err.message : String(err);
  return /already/i.test(msg) || /409/.test(msg);
}

/**
 * CredentialsSection — rendered inside ProfileEditor only.
 *
 * Surfaces the seeker's saved credentials as expandable rows with a
 * single inline form for both create + edit (kept inline to avoid a
 * nested dialog inside the profile editor sheet). Mirrors the
 * Operations-tab visual language: portal-eyebrow heading, gradient
 * primary action, soft indigo surface tiles for empty/info states.
 */
export function CredentialsSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: credentials } = useCredentials();
  const list = credentials ?? [];

  type FormMode =
    | { kind: "closed" }
    | { kind: "create" }
    | { kind: "edit"; id: number };
  const [mode, setMode] = useState<FormMode>({ kind: "closed" });
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["/api/jobseeker/credentials"] });

  const createMutation = useMutation({
    mutationFn: (payload: ReturnType<typeof toPayload>) =>
      apiRequest("POST", "/api/jobseeker/credentials", payload),
    onSuccess: () => {
      invalidate();
      toast({ title: "Credential added" });
      setMode({ kind: "closed" });
      setForm(EMPTY_FORM);
    },
    onError: (err: Error) => {
      if (is409(err)) {
        toast({
          title: "Already on file",
          description: "You already have this credential.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Couldn't save credential",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: number;
      payload: ReturnType<typeof toPayload>;
    }) => apiRequest("PUT", `/api/jobseeker/credentials/${id}`, payload),
    onSuccess: () => {
      invalidate();
      toast({ title: "Credential updated" });
      setMode({ kind: "closed" });
      setForm(EMPTY_FORM);
    },
    onError: (err: Error) => {
      if (is409(err)) {
        toast({
          title: "Already on file",
          description: "You already have this credential.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Couldn't update credential",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("DELETE", `/api/jobseeker/credentials/${id}`),
    onSuccess: () => {
      invalidate();
      toast({ title: "Credential removed" });
    },
    onError: (err: Error) =>
      toast({
        title: "Couldn't remove credential",
        description: err.message,
        variant: "destructive",
      }),
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isFormOpen = mode.kind !== "closed";

  const handleAddClick = () => {
    setForm(EMPTY_FORM);
    setMode({ kind: "create" });
  };

  const handleEditClick = (c: JobSeekerCredential) => {
    setForm(fromCredential(c));
    setMode({ kind: "edit", id: c.id });
  };

  const handleCancel = () => {
    setMode({ kind: "closed" });
    setForm(EMPTY_FORM);
  };

  const handleSubmit = () => {
    // Mirrors credentialInputSchema.superRefine — server rejects the
    // same case, but catching it client-side avoids a round trip.
    if (form.kind === "OTHER" && form.label.trim() === "") {
      toast({
        title: "Label required",
        description: 'Enter a name when kind is "Other".',
        variant: "destructive",
      });
      return;
    }
    const payload = toPayload(form);
    if (mode.kind === "create") {
      createMutation.mutate(payload);
    } else if (mode.kind === "edit") {
      updateMutation.mutate({ id: mode.id, payload });
    }
  };

  return (
    <div>
      <h4 className="portal-eyebrow mb-1">Licenses, trainings &amp; clearances</h4>
      <p className="text-[11px] text-muted-foreground mb-3">
        TB, CPR, Live Scan and similar are only shared with a facility when you apply.
      </p>

      {/* Existing rows */}
      {list.length > 0 && (
        <ul className="space-y-2 mb-3">
          {list.map((c) => (
            <li
              key={c.id}
              className="rounded-lg p-2.5 flex items-start gap-3"
              style={{ background: "#F0F4FF", border: "1px solid #E0E7FF" }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <CredentialBadge credential={c} />
                  {c.licenseNumber && (
                    <span className="text-[11px] portal-num text-muted-foreground">
                      #{c.licenseNumber}
                    </span>
                  )}
                </div>
                {(c.issuingAuthority || c.issuedAt || c.expiresAt) && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {c.issuingAuthority && <span>{c.issuingAuthority}</span>}
                    {c.issuingAuthority && (c.issuedAt || c.expiresAt) && " · "}
                    {c.issuedAt && <span className="portal-num">issued {c.issuedAt}</span>}
                    {c.issuedAt && c.expiresAt && " · "}
                    {c.expiresAt && <span className="portal-num">expires {c.expiresAt}</span>}
                  </p>
                )}
                {c.notes && (
                  <p className="mt-1 text-[11px] text-stone-600 leading-snug">{c.notes}</p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => handleEditClick(c)}
                  aria-label={`Edit ${CREDENTIAL_LABEL[c.kind as CredentialKind] ?? c.kind}`}
                  disabled={isFormOpen}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-destructive hover:text-destructive"
                  onClick={() => deleteMutation.mutate(c.id)}
                  aria-label={`Remove ${CREDENTIAL_LABEL[c.kind as CredentialKind] ?? c.kind}`}
                  disabled={deleteMutation.isPending || isFormOpen}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Empty state — when there are no credentials AND the form
          is not currently open, nudge with a soft surface tile. */}
      {list.length === 0 && !isFormOpen && (
        <div
          className="rounded-lg p-3 mb-3 flex items-center gap-2 text-[12px]"
          style={{ background: "#F0F4FF", border: "1px solid #E0E7FF", color: "#4F46E5" }}
        >
          <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Add your licenses, trainings, or clearances so facilities can match you faster.
          </span>
        </div>
      )}

      {/* Inline create / edit form */}
      {isFormOpen ? (
        <div className="rounded-lg border border-stone-200 bg-white p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Kind</Label>
              <Select
                value={form.kind}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, kind: v as CredentialKind }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KIND_ORDER.map((k) => (
                    <SelectItem key={k} value={k}>
                      {CREDENTIAL_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {form.kind === "OTHER" && (
              <div className="space-y-1.5">
                <Label>
                  Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  placeholder="e.g. Notary Public"
                  value={form.label}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, label: e.target.value }))
                  }
                  maxLength={120}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>License / certificate #</Label>
              <Input
                placeholder="Optional"
                value={form.licenseNumber}
                onChange={(e) =>
                  setForm((f) => ({ ...f, licenseNumber: e.target.value }))
                }
                maxLength={64}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Issuing authority</Label>
              <Input
                placeholder="e.g. CA Dept. of Public Health"
                value={form.issuingAuthority}
                onChange={(e) =>
                  setForm((f) => ({ ...f, issuingAuthority: e.target.value }))
                }
                maxLength={120}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Issued</Label>
              <input
                type="date"
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={form.issuedAt}
                onChange={(e) =>
                  setForm((f) => ({ ...f, issuedAt: e.target.value }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label>Expires</Label>
              <input
                type="date"
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={form.expiresAt}
                onChange={(e) =>
                  setForm((f) => ({ ...f, expiresAt: e.target.value }))
                }
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea
              placeholder="Anything a facility should know about this credential…"
              rows={2}
              maxLength={500}
              value={form.notes}
              onChange={(e) =>
                setForm((f) => ({ ...f, notes: e.target.value }))
              }
            />
            <p className="text-xs text-muted-foreground text-right">
              {form.notes.length}/500
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
        <Button
          variant="gradient"
          size="sm"
          onClick={handleAddClick}
          type="button"
        >
          <Plus className="h-4 w-4" />
          Add a license or training
        </Button>
      )}
    </div>
  );
}
