/**
 * client/src/components/account/AccountSettingsPanel.tsx
 *
 * CCPA + email-change UI surface used by both the seeker dashboard and
 * the facility portal. Self-contained so each portal can drop it into an
 * existing section without sprawling new top-level routes.
 *
 * BE endpoints (Phase 4 spec):
 *   POST /api/account/data-export
 *   POST /api/account/delete-request
 *   POST /api/account/email-change/initiate { newEmail }
 *   POST /api/account/email-change/verify   { otp }
 *
 * All four flow through `apiRequest()` so CSRF + legal-reaccept handling
 * stay consistent with the rest of the app.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Mail, Download, Trash2, ShieldAlert } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

export interface AccountSettingsPanelProps {
  /**
   * Audience hint — used only to scope the cache invalidation after a
   * successful email change. Defaults to "seeker".
   */
  audience?: "seeker" | "facility";
  /** Email the request was last initiated for — populated after initiate. */
}

export function AccountSettingsPanel({ audience = "seeker" }: AccountSettingsPanelProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // ── Data export ────────────────────────────────────────────────────────
  const exportMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/account/data-export");
      // BE returns { requestId, etaDays } per spec; tolerate missing fields.
      try {
        return (await res.json()) as { requestId?: string; etaDays?: number };
      } catch {
        return {} as { requestId?: string; etaDays?: number };
      }
    },
    onSuccess: (data) => {
      toast({
        title: "Export request received",
        description: data.requestId
          ? `Request ${data.requestId} — we'll email you within ${data.etaDays ?? 45} days.`
          : `We'll email you within ${data.etaDays ?? 45} days.`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't submit the export request",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // ── Delete request ─────────────────────────────────────────────────────
  const [deleteOpen, setDeleteOpen] = useState(false);
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/account/delete-request");
      try {
        return (await res.json()) as { requestId?: string };
      } catch {
        return {} as { requestId?: string };
      }
    },
    onSuccess: (data) => {
      setDeleteOpen(false);
      toast({
        title: "Delete request received",
        description: data.requestId
          ? `Request ${data.requestId} — we'll process this within 45 days and email you when it's complete.`
          : "We'll process this within 45 days and email you when it's complete.",
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't submit the delete request",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // ── Email change ───────────────────────────────────────────────────────
  const [emailStep, setEmailStep] = useState<"initiate" | "verify">("initiate");
  const [newEmail, setNewEmail] = useState("");
  const [otp, setOtp] = useState("");

  const initiateMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/account/email-change/initiate", {
        newEmail,
      }),
    onSuccess: () => {
      setEmailStep("verify");
      toast({
        title: "Check your new email",
        description: `We sent a 6-digit code to ${newEmail}.`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't start the email change",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const verifyMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/account/email-change/verify", {
        otp,
      }),
    onSuccess: async () => {
      setEmailStep("initiate");
      const oldNewEmail = newEmail;
      setNewEmail("");
      setOtp("");
      // Refetch the appropriate /me so the new email shows everywhere.
      await qc.invalidateQueries({
        queryKey: audience === "facility" ? ["/api/facility/me"] : ["/api/jobseeker/me"],
      });
      toast({
        title: "Email updated",
        description: `Your account email is now ${oldNewEmail}.`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't verify the code",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="space-y-4">
      {/* ── Change email ───────────────────────────────────────────────── */}
      <Card>
        <CardContent className="pt-5 space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50">
              <Mail className="h-4 w-4 text-indigo-700" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-stone-900">Change email</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                We'll send a 6-digit code to the new address to confirm it's yours.
              </p>
            </div>
          </div>

          {emailStep === "initiate" ? (
            <div className="space-y-2">
              <Label htmlFor="account-new-email">New email address</Label>
              <div className="flex gap-2">
                <Input
                  id="account-new-email"
                  type="email"
                  placeholder="new@example.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
                <Button
                  type="button"
                  onClick={() => initiateMutation.mutate()}
                  disabled={
                    !newEmail.includes("@") || initiateMutation.isPending
                  }
                >
                  {initiateMutation.isPending ? "Sending…" : "Send code"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="account-email-otp">
                Verification code sent to{" "}
                <span className="font-medium text-foreground">{newEmail}</span>
              </Label>
              <div className="flex gap-2">
                <Input
                  id="account-email-otp"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="123456"
                  className="font-mono tracking-widest"
                  value={otp}
                  onChange={(e) =>
                    setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                />
                <Button
                  type="button"
                  onClick={() => verifyMutation.mutate()}
                  disabled={otp.length !== 6 || verifyMutation.isPending}
                >
                  {verifyMutation.isPending ? "Verifying…" : "Confirm"}
                </Button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEmailStep("initiate");
                  setOtp("");
                }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                ← Use a different email
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Download my data ───────────────────────────────────────────── */}
      <Card>
        <CardContent className="pt-5 space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50">
              <Download className="h-4 w-4 text-indigo-700" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-stone-900">Download my data</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Under CCPA you can request a copy of the personal data we hold
                about you. We'll email a download link within 45 days.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending}
          >
            {exportMutation.isPending ? "Submitting…" : "Request data export"}
          </Button>
        </CardContent>
      </Card>

      {/* ── Delete account ─────────────────────────────────────────────── */}
      <Card>
        <CardContent className="pt-5 space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-50">
              <Trash2 className="h-4 w-4 text-rose-700" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-stone-900">Delete my account</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Request permanent deletion of your account and personal data.
                This action cannot be undone once it's processed.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            className="text-rose-700 hover:bg-rose-50 hover:text-rose-800 border-rose-200"
            onClick={() => setDeleteOpen(true)}
            disabled={deleteMutation.isPending}
          >
            Request account deletion
          </Button>

          <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5 text-rose-600" aria-hidden="true" />
                  Delete this account?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This sends a deletion request to our team. We'll process it
                  within 45 days and email you when it's complete. You'll be
                  signed out and lose access to your data.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleteMutation.isPending}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    deleteMutation.mutate();
                  }}
                  disabled={deleteMutation.isPending}
                  className="bg-rose-600 hover:bg-rose-700 focus:ring-rose-600"
                >
                  {deleteMutation.isPending ? "Submitting…" : "Yes, delete my account"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
