/**
 * client/src/components/legal/LegalAcceptanceModal.tsx
 *
 * Blocking modal that fires when the current session has a non-empty
 * `pendingAcceptances` list — either because we just loaded /me and the
 * server reports unaccepted versions, OR because a mutation just returned
 * `409 LEGAL_REACCEPT_REQUIRED`.
 *
 * Rules (per Phase 4 brief):
 *  - No close X, ESC disabled, click-outside disabled.
 *  - Renders the markdown of each pending doc inline.
 *  - One "I accept" checkbox per pending doc.
 *  - "Accept & Continue" enabled only when every checkbox is checked.
 *  - "Log out" is the escape hatch — the user can decline by signing out.
 *
 * Mounted globally in App.tsx so it appears on top of every page. Reads
 * its state from the module-level `legalState` store, which is fed by
 * both `AuthContext` (seeker) and `useSession` (facility).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import {
  LEGAL_DOCS,
  type LegalDocResponse,
  type LegalDocSlug,
} from "@/lib/legal";
import {
  clearPendingAcceptances,
  getLegalState,
  subscribeLegalState,
  type LegalState,
} from "@/lib/legalState";
import { useAuth } from "@/context/AuthContext";
import { useSession } from "@/hooks/useSession";
import { MarkdownView } from "./MarkdownView";

function useLegalStateSubscription(): LegalState {
  const [snap, setSnap] = useState<LegalState>(() => getLegalState());
  useEffect(() => subscribeLegalState(setSnap), []);
  return snap;
}

/**
 * One legal doc's body + acceptance checkbox.
 */
function LegalDocSection({
  slug,
  checked,
  onChange,
}: {
  slug: LegalDocSlug;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  const meta = LEGAL_DOCS[slug];
  const { data, isLoading, isError } = useQuery<LegalDocResponse | null>({
    queryKey: [`/api/legal/${slug}`],
    queryFn: getQueryFn({ on401: "throw" }),
    staleTime: 60 * 60 * 1000, // 1h — versioned content, rarely changes
  });

  const id = `accept-${slug}`;
  return (
    <section className="space-y-3">
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold text-stone-900">{meta.title}</h3>
        <span className="text-[11px] text-muted-foreground font-mono">
          v{data?.version ?? meta.version}
        </span>
      </header>
      <div className="max-h-72 overflow-y-auto rounded-md border border-stone-200 bg-stone-50/40 p-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading {meta.title}…</p>
        ) : isError || !data ? (
          <p className="text-sm text-destructive">
            Failed to load this document. You can still review it at{" "}
            <a
              href={`#/legal/${slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary hover:underline"
            >
              the dedicated page
            </a>
            .
          </p>
        ) : (
          <MarkdownView source={data.content} className="prose-sm" />
        )}
      </div>
      <label htmlFor={id} className="flex items-start gap-2.5 cursor-pointer select-none">
        <Checkbox
          id={id}
          checked={checked}
          onCheckedChange={(v) => onChange(v === true)}
          aria-label={`I accept the ${meta.title}`}
          className="mt-0.5"
        />
        <span className="text-sm text-stone-700">
          I have read and accept the <span className="font-medium">{meta.title}</span>.
        </span>
      </label>
    </section>
  );
}

export function LegalAcceptanceModal() {
  const legal = useLegalStateSubscription();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { logout, user: seeker } = useAuth();
  const { data: facility } = useSession();

  // Once acceptance succeeds we want to close even before the /me refetch
  // settles, so we keep a local "just accepted" flag. The store's pending
  // list will catch up via the invalidate below.
  const [acceptedThisSession, setAcceptedThisSession] = useState(false);
  const [checked, setChecked] = useState<Record<LegalDocSlug, boolean>>({
    terms: false,
    privacy: false,
    aup: false,
  });

  // Reset per-doc checkboxes whenever the pending list changes shape.
  const pendingKey = legal.pending.join(",");
  useEffect(() => {
    setChecked({ terms: false, privacy: false, aup: false });
    setAcceptedThisSession(false);
  }, [pendingKey, legal.forcedOpenNonce]);

  const acceptMutation = useMutation({
    mutationFn: async () => {
      // POST /api/legal/accept — BE owns this endpoint (Phase 4 spec).
      // If the BE didn't expose this exact path the request will 404;
      // surface a clear error in that case so the operator notices the
      // contract gap rather than a silent infinite-modal.
      await apiRequest("POST", "/api/legal/accept", {
        documents: legal.pending,
      });
    },
    onSuccess: async () => {
      setAcceptedThisSession(true);
      // Refetch whichever /me applies so the next render reads an empty
      // pending list. Both invalidations are safe — one will 401 silently.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["/api/jobseeker/me"] }),
        qc.invalidateQueries({ queryKey: ["/api/facility/me"] }),
      ]);
      toast({ title: "Thanks — your acceptance has been recorded." });
    },
    onError: (err: Error) => {
      toast({
        title: "Could not record your acceptance",
        description: err.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  const allChecked = useMemo(
    () => legal.pending.every((slug) => checked[slug]),
    [legal.pending, checked],
  );

  // The modal is open when there is something pending and we haven't
  // just accepted them. We deliberately ignore `forcedOpenNonce` for the
  // open-decision because the pending list IS the truth — the nonce only
  // exists to reset internal checkbox state when the trigger source changes.
  const open = legal.pending.length > 0 && !acceptedThisSession;

  const handleLogout = useCallback(async () => {
    try {
      if (seeker) {
        await logout();
      } else if (facility) {
        // Facility uses its own /api/facility/logout endpoint.
        await apiRequest("POST", "/api/facility/logout");
        clearPendingAcceptances("facility");
        await qc.invalidateQueries({ queryKey: ["/api/facility/me"] });
      } else {
        // Neither session present (rare) — defensively clear both slots
        // so a stale pending list can't trap the user.
        clearPendingAcceptances("seeker");
        clearPendingAcceptances("facility");
      }
    } catch {
      // Best-effort — UX guard, not a security boundary. Even if logout
      // fails, the modal stays up and the user can retry.
    }
  }, [seeker, facility, logout, qc]);

  if (!open) return null;

  return (
    <Dialog open={open} modal>
      <DialogContent
        hideCloseButton
        // Block ESC + click-outside dismissal so this stays a hard gate.
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>Please review our updated terms</DialogTitle>
          <DialogDescription>
            We've updated the {legal.pending.length === 1 ? "document" : "documents"} below.
            You'll need to accept {legal.pending.length === 1 ? "it" : "all of them"} to
            continue using the app.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {legal.pending.map((slug) => (
            <LegalDocSection
              key={slug}
              slug={slug}
              checked={!!checked[slug]}
              onChange={(v) => setChecked((c) => ({ ...c, [slug]: v }))}
            />
          ))}
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleLogout}
            disabled={acceptMutation.isPending}
            className="sm:mr-auto"
          >
            Log out
          </Button>
          <Button
            type="button"
            onClick={() => acceptMutation.mutate()}
            disabled={!allChecked || acceptMutation.isPending}
          >
            {acceptMutation.isPending ? "Recording…" : "Accept & Continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
