// OnboardingWizard — Phase 1 step machine for the post-signup
// "complete your profile" flow. Route: #/jobs/onboard.
//
// Architectural notes:
//   - Single submit point. None of the per-step components talk to the
//     API — the shell collects state into a draft, persists each
//     transition to localStorage["seeker.onboardingDraft"], and fires a
//     single PUT + Promise.allSettled(POST credentials) when the user
//     hits "Finish" on the bio step.
//   - Auth-guarded. Unauth → /job-seeker. Already-complete profile
//     → /jobseeker/dashboard. "Dismissed" flag → /jobseeker/dashboard.
//   - Step transitions own the dot-indicator. The terminal
//     FindingMatchesStep hides the dots in favor of a skeleton + spinner.
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import type { JobSeekerCredential, CredentialKind } from "@shared/schema";
import type { JobSeekerProfile } from "@/lib/seekerProfileTypes";
import { cn } from "@/lib/utils";
import {
  clearOnboardingDraft,
  isOnboardingDismissed,
  loadOnboardingDraft,
  markOnboardingDismissed,
  saveOnboardingDraft,
} from "@/lib/seekerLocalStorage";
import { BrandLoader } from "@/components/BrandLoader";

import LocationStep from "./steps/LocationStep";
import CredentialsStep from "./steps/CredentialsStep";
import ExperienceStep from "./steps/ExperienceStep";
import BioPreviewStep from "./steps/BioPreviewStep";
import FindingMatchesStep from "./steps/FindingMatchesStep";

type Step = "location" | "credentials" | "experience" | "bio" | "finding";

// User-facing steps for the progress dots — "finding" is intentionally
// excluded; the terminal step replaces the chrome with its own skeleton.
const VISIBLE_STEPS: Step[] = ["location", "credentials", "experience", "bio"];

/**
 * profileLooksComplete — the wizard's "have we already collected enough?"
 * heuristic. If the seeker has a ZIP, a yearsExperience value, AND at
 * least one credential, we treat onboarding as done and bounce them to
 * the dashboard. Anything weaker than this and the dashboard would
 * still feel "blank" — we want at least one of each shape.
 */
function profileLooksComplete(
  profile: JobSeekerProfile | null | undefined,
  credentials: JobSeekerCredential[] | undefined,
): boolean {
  if (!profile) return false;
  if (!profile.zipCode || profile.yearsExperience == null) return false;
  if (!credentials || credentials.length === 0) return false;
  return true;
}

export default function OnboardingWizard() {
  const { user, isReady } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  // Server state — both queries 401-tolerant so the redirect guard below
  // is the single source of truth for "should this page even render".
  const { data: profile } = useQuery<JobSeekerProfile | null>({
    queryKey: ["/api/jobseeker/profile"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!user,
    staleTime: 60000,
  });
  const { data: credentials } = useQuery<JobSeekerCredential[] | null>({
    queryKey: ["/api/jobseeker/credentials"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!user,
    staleTime: 30000,
  });

  // Wizard state. Seeded from the persisted draft on first render so a
  // navigation away + back doesn't lose progress.
  const initialDraft = useMemo(() => loadOnboardingDraft(), []);
  const [step, setStep] = useState<Step>("location");
  const [zipCode, setZipCode] = useState<string>(initialDraft.zipCode ?? "");
  const [selectedCreds, setSelectedCreds] = useState<CredentialKind[]>(
    initialDraft.credentials ?? [],
  );
  const [yearsExperience, setYearsExperience] = useState<number | null>(
    initialDraft.yearsExperience ?? null,
  );
  const [bio, setBio] = useState<string>(initialDraft.bio ?? "");

  // Redirect guards. Runs on every relevant state change so a late
  // /profile fetch that resolves AFTER the wizard mounted still bounces
  // the seeker forward.
  useEffect(() => {
    if (!isReady) return;
    if (!user) {
      setLocation("/job-seeker", { replace: true });
      return;
    }
    if (isOnboardingDismissed()) {
      setLocation("/jobseeker/dashboard", { replace: true });
      return;
    }
    // profile may still be loading (undefined) — only redirect when we
    // have a definitive read AND it satisfies the completeness heuristic.
    if (profile && credentials && profileLooksComplete(profile, credentials)) {
      setLocation("/jobseeker/dashboard", { replace: true });
    }
  }, [isReady, user, profile, credentials, setLocation]);

  // Persist the draft on every step transition's `value` so a refresh
  // mid-flow doesn't blow it away.
  useEffect(() => {
    saveOnboardingDraft({
      zipCode,
      credentials: selectedCreds,
      yearsExperience,
      bio,
    });
  }, [zipCode, selectedCreds, yearsExperience, bio]);

  // ── Final submit ───────────────────────────────────────────────────────
  // One PUT for the profile (mirrors SeekerProfileEditor's payload shape,
  // BUT only sends the fields the wizard collects — firstName/lastName/
  // address/city/state stay untouched). Then a parallel POST per selected
  // credential; 409s (duplicate) are silently tolerated.
  const submitMutation = useMutation({
    mutationFn: async () => {
      // 1. Save profile fields collected by the wizard.
      await apiRequest("PUT", "/api/jobseeker/profile", {
        zipCode: zipCode || undefined,
        yearsExperience: yearsExperience ?? undefined,
        bio: bio || undefined,
      });

      // 2. Fan out credential creates. We use Promise.allSettled so a
      // single 409 (already exists) doesn't sink the whole batch — the
      // architect explicitly said tolerate-and-continue. Any non-409
      // failure is collected and surfaced as a single warning toast
      // AFTER the profile save has succeeded.
      const results = await Promise.allSettled(
        selectedCreds.map((kind) =>
          apiRequest("POST", "/api/jobseeker/credentials", { kind }),
        ),
      );
      const fatalFailures = results.filter(
        (r) => r.status === "rejected" && !isDuplicateError(r.reason),
      );
      return { fatalFailures };
    },
    onSuccess: ({ fatalFailures }) => {
      qc.invalidateQueries({ queryKey: ["/api/jobseeker/profile"] });
      qc.invalidateQueries({ queryKey: ["/api/jobseeker/credentials"] });
      clearOnboardingDraft();
      if (fatalFailures.length > 0) {
        toast({
          title: "Some credentials didn't save",
          description: `${fatalFailures.length} couldn't be added — you can retry from your profile.`,
          variant: "destructive",
        });
      }
      setStep("finding");
    },
    onError: (err: any) => {
      toast({
        title: "We couldn't save your profile",
        description: err?.message ?? "Please try again.",
        variant: "destructive",
      });
      // Stay on BioPreviewStep, leave draft intact so retry is one tap.
    },
  });

  // Skip-for-now wires through the header — sets the dismissed flag and
  // bounces to the dashboard. The flag is cleared on logout() so a fresh
  // sign-in always gets another chance at onboarding.
  const handleSkip = () => {
    markOnboardingDismissed();
    setLocation("/jobseeker/dashboard", { replace: true });
  };

  // Brand-mark loader while the auth check is still pending — mirrors
  // DashboardPage so the user sees the same visual on every wait.
  if (!isReady || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FFF8F1]">
        <BrandLoader size="md" label="Loading…" />
      </div>
    );
  }

  const visibleIdx = VISIBLE_STEPS.indexOf(step);

  return (
    <div
      className="min-h-screen bg-white flex flex-col"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      {/* Header: progress dots (only during the user-facing steps) +
          "Skip for now". On the terminal step the header is hidden so
          the skeleton owns the screen. */}
      {step !== "finding" && (
        <div className="px-5 pt-5 pb-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {VISIBLE_STEPS.map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === visibleIdx
                    ? "w-6 bg-indigo-600"
                    : i < visibleIdx
                      ? "w-1.5 bg-indigo-400"
                      : "w-1.5 bg-stone-200",
                )}
              />
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSkip}
            className="text-stone-500 hover:text-stone-700"
          >
            Skip for now
          </Button>
        </div>
      )}

      {/* Body — single visible step. */}
      <main className="flex-1 px-5 pb-8">
        <div className="mx-auto max-w-md pt-2">
          {step === "location" && (
            <LocationStep
              value={{ zipCode }}
              onChange={({ zipCode: z }) => setZipCode(z)}
              onNext={() => setStep("credentials")}
              onSkip={handleSkip}
            />
          )}
          {step === "credentials" && (
            <CredentialsStep
              value={{ credentials: selectedCreds }}
              onChange={({ credentials: c }) => setSelectedCreds(c)}
              onNext={() => setStep("experience")}
              onBack={() => setStep("location")}
              onSkip={handleSkip}
            />
          )}
          {step === "experience" && (
            <ExperienceStep
              value={{ yearsExperience }}
              onChange={({ yearsExperience: y }) => setYearsExperience(y)}
              onNext={() => setStep("bio")}
              onBack={() => setStep("credentials")}
              onSkip={handleSkip}
            />
          )}
          {step === "bio" && (
            <BioPreviewStep
              value={{ bio }}
              onChange={({ bio: b }) => setBio(b)}
              templateInputs={{
                credentials: selectedCreds,
                yearsExperience,
                zipCode,
              }}
              submitting={submitMutation.isPending}
              onNext={() => submitMutation.mutate()}
              onBack={() => setStep("experience")}
              onSkip={handleSkip}
            />
          )}
          {step === "finding" && <FindingMatchesStep />}
        </div>
      </main>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * isDuplicateError — the credentials POST returns 409 with a message
 * that mentions "already have". apiRequest throws an Error whose
 * message is the server's `message` field, so we sniff the message.
 * Loose enough that a future message tweak doesn't break the silent-
 * tolerate behavior.
 */
function isDuplicateError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return /already\s+have/i.test(msg);
}
