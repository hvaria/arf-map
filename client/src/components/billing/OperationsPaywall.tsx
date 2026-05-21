/**
 * OperationsPaywall — full-content paywall shown in place of `<OperationsTab />`
 * for facility accounts whose subscription is not `active` or `trialing`.
 *
 * Phase 1 contract:
 *   - CTA hands off to Stripe Checkout via `POST /api/billing/checkout`. The
 *     server returns `{ url }` (hosted Stripe page) and we set
 *     `window.location.href = url` so the redirect carries the auth cookie.
 *     Stripe will bounce the user back to `#/facility-portal?billing=success`
 *     or `?billing=cancelled`; the portal handles those query params.
 *   - 503 `STRIPE_NOT_CONFIGURED` → inline alert so dev/staging without keys
 *     degrades gracefully instead of throwing.
 *   - 5xx / network errors → inline retry message.
 *   - Status-specific alerts (past_due, canceled, etc.) still apply; the
 *     "update payment method" action remains TODO until Phase 2 wires
 *     `POST /api/billing/portal` (Stripe Customer Portal).
 *
 * Pricing is centralized in `OPERATIONS_PRO_PRICE_LABEL` (lib/subscription.ts)
 * so Phase 4's annual plan extension touches one line.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Sparkles,
  Ticket,
  XCircle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import {
  OPERATIONS_PRO_PRICE_LABEL,
  type FacilitySubscription,
} from "@/lib/subscription";
import { getCsrfToken, refreshCsrfTokenFromMe } from "@/lib/csrfToken";

interface OperationsPaywallProps {
  subscription: FacilitySubscription | null;
}

/**
 * The headline benefits the Operations toolkit unlocks. Kept tight so the
 * scan reads in a single glance — these are taglines, not feature manuals.
 * Anchored to the modules that already ship in `OperationsTab` so we're
 * promising things the user will actually find on the other side.
 */
const BENEFITS: ReadonlyArray<{ title: string; detail: string }> = [
  {
    title: "Residents & care plans",
    detail: "Add residents, capture care plans, manage contacts.",
  },
  {
    title: "eMAR & med-pass",
    detail: "Scheduled medications, dose-by-dose audit trail, PRN logging.",
  },
  {
    title: "Tracker suite",
    detail:
      "ADL, vitals, toileting, hygiene, skin check, seizure, sleep, inventory, cleaning.",
  },
  {
    title: "Notes feed",
    detail: "Shift handoffs, urgent flags, threaded replies.",
  },
  {
    title: "Incidents & compliance",
    detail: "Log incidents, track licensing-grade compliance items.",
  },
  {
    title: "CRM, staff, tasks",
    detail: "Prospect pipeline, staff roster, daily task assignments.",
  },
];

/**
 * Top-of-page status hint, derived from the current `subscription.status`.
 * For Phase 1 we surface the situations the user can act on. The
 * "Update payment method" affordance referenced in past_due / unpaid is
 * still routed through "contact support" until Phase 2 wires the Stripe
 * Customer Portal (`POST /api/billing/portal`).
 */
function statusAlert(sub: FacilitySubscription | null) {
  const status = sub?.status ?? null;

  switch (status) {
    case "past_due":
      return {
        icon: AlertTriangle,
        title: "Payment failed",
        description:
          "Your last payment didn't go through. Update your card to keep using the Operations toolkit.",
      };
    case "unpaid":
      return {
        icon: AlertTriangle,
        title: "Payment overdue",
        description:
          "Your account is past due. Settle the outstanding invoice to restore access.",
      };
    case "canceled":
      return {
        icon: XCircle,
        title: "Subscription ended",
        description:
          "Your subscription has been cancelled. Resubscribe to regain access to Operations.",
      };
    case "incomplete":
    case "incomplete_expired":
      return {
        icon: AlertTriangle,
        title: "Checkout incomplete",
        description:
          "Your subscription setup didn't finish. Start it again to unlock Operations.",
      };
    case "paused":
      return {
        icon: AlertTriangle,
        title: "Subscription paused",
        description:
          "Your subscription is currently paused. Resume it to continue using Operations.",
      };
    default:
      // null / no-sub: no special alert — the marketing card carries the
      // message on its own.
      return null;
  }
}

interface CheckoutErrorBody {
  code?: string;
  message?: string;
}

/**
 * Frontend-visible failure modes from `POST /api/billing/checkout`. Server
 * `503 { code: "STRIPE_NOT_CONFIGURED" }` maps to "unavailable" (cannot be
 * retried without ops intervention); anything else is treated as a
 * recoverable transient error.
 */
type CheckoutError =
  | { kind: "unavailable" }
  | { kind: "generic"; message: string };

export function OperationsPaywall({ subscription }: OperationsPaywallProps) {
  const alert = statusAlert(subscription);
  const AlertIcon = alert?.icon;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isStartingCheckout, setIsStartingCheckout] = useState(false);
  const [checkoutError, setCheckoutError] = useState<CheckoutError | null>(
    null,
  );

  // Bypass-code redemption (owner comp): collapsed by default, single
  // small input + submit. Lives next to the Upgrade CTA, not as a
  // prominent option, so the primary path remains paid Checkout.
  const [showCodeForm, setShowCodeForm] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [isRedeemingCode, setIsRedeemingCode] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  async function redeemCode() {
    const trimmed = codeInput.trim();
    if (!trimmed) {
      setCodeError("Enter a promo code.");
      return;
    }
    setCodeError(null);
    setIsRedeemingCode(true);
    try {
      // Headers built per-call so a token rotation between redeem+checkout
      // is picked up without re-mounting. Phase 1 CSRF — see lib/csrfToken.
      const buildHeaders = (): Record<string, string> => {
        const h: Record<string, string> = {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        };
        const csrf = getCsrfToken();
        if (csrf) h["X-CSRF-Token"] = csrf;
        return h;
      };
      const doPost = () =>
        fetch("/api/billing/redeem-code", {
          method: "POST",
          credentials: "include",
          headers: buildHeaders(),
          body: JSON.stringify({ code: trimmed }),
        });
      let res = await doPost();
      if (res.status === 403) {
        const probe = await res.clone().json().catch(() => null);
        if ((probe as { code?: string } | null)?.code === "CSRF_TOKEN_INVALID") {
          await refreshCsrfTokenFromMe("facility");
          res = await doPost();
        }
      }
      if (res.status === 503) {
        setCodeError("Promo codes aren't enabled on this environment.");
        return;
      }
      if (res.status === 429) {
        setCodeError("Too many attempts. Please wait a few minutes.");
        return;
      }
      if (!res.ok) {
        setCodeError("That code isn't valid.");
        return;
      }
      // Success — refetch session so the paywall unmounts on the next
      // render and Operations content takes over.
      await queryClient.invalidateQueries({ queryKey: ["/api/facility/me"] });
      toast({
        title: "Operations unlocked",
        description: "Your promo code has been applied.",
      });
    } catch {
      setCodeError("Could not redeem code. Please try again.");
    } finally {
      setIsRedeemingCode(false);
    }
  }

  async function startCheckout() {
    setCheckoutError(null);
    setIsStartingCheckout(true);
    try {
      // We deliberately use raw `fetch` instead of the `apiRequest` helper
      // from `@/lib/queryClient`: that helper throws on any non-2xx
      // without exposing the response body, and we need to distinguish
      // 503 STRIPE_NOT_CONFIGURED (non-retryable) from 500 CHECKOUT_FAILED
      // (retryable) to drive different UI. Headers still mirror the
      // helper (credentials + CSRF sentinel + per-session token).
      const buildHeaders = (): Record<string, string> => {
        const h: Record<string, string> = {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        };
        const csrf = getCsrfToken();
        if (csrf) h["X-CSRF-Token"] = csrf;
        return h;
      };
      const doPost = () =>
        fetch("/api/billing/checkout", {
          method: "POST",
          credentials: "include",
          headers: buildHeaders(),
        });
      let res = await doPost();
      if (res.status === 403) {
        const probe = await res.clone().json().catch(() => null);
        if ((probe as { code?: string } | null)?.code === "CSRF_TOKEN_INVALID") {
          await refreshCsrfTokenFromMe("facility");
          res = await doPost();
        }
      }

      if (res.status === 503) {
        // STRIPE_NOT_CONFIGURED — dev / staging without keys, or live ops
        // outage. Surface as a non-retryable inline alert.
        setCheckoutError({ kind: "unavailable" });
        return;
      }

      if (!res.ok) {
        // 401 from the gate would mean session expired mid-paywall; treat
        // as a generic retryable error (the parent page will redirect to
        // login on the next refetch anyway).
        let body: CheckoutErrorBody = {};
        try {
          body = (await res.json()) as CheckoutErrorBody;
        } catch {
          // ignore — body wasn't JSON
        }
        setCheckoutError({
          kind: "generic",
          message: body.message ?? "Could not start checkout.",
        });
        return;
      }

      const body = (await res.json()) as { url?: string };
      if (!body.url) {
        setCheckoutError({
          kind: "generic",
          message: "Checkout response was malformed.",
        });
        return;
      }

      // Hand off to Stripe's hosted page. Using `window.location.href`
      // (not `location.assign`) keeps the test mock simple and is the
      // same pattern other Stripe SDK examples use.
      window.location.href = body.url;
    } catch (err) {
      // Network failure / CORS / etc.
      setCheckoutError({
        kind: "generic",
        message:
          err instanceof Error
            ? err.message
            : "Could not start checkout. Please try again.",
      });
      toast({
        title: "Checkout failed",
        description: "Please try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setIsStartingCheckout(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto py-6">
      {alert && AlertIcon ? (
        <Alert variant="destructive" className="mb-6">
          <AlertIcon className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>{alert.title}</AlertTitle>
          <AlertDescription>{alert.description}</AlertDescription>
          {/* TODO(Phase 2): replace the implicit "contact support" path for
              past_due / unpaid with a button that opens the Stripe Customer
              Portal via `POST /api/billing/portal`. */}
        </Alert>
      ) : null}

      <Card
        className="border bg-white"
        style={{ borderColor: "var(--portal-border-subtle)" }}
      >
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Operations Pro
          </div>
          <CardTitle className="mt-2 text-2xl text-stone-900">
            Unlock the operations toolkit
          </CardTitle>
          <CardDescription className="text-sm">
            Run your facility day-to-day from a single dashboard — residents,
            medications, trackers, notes, compliance, and more.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <ul className="grid gap-3 sm:grid-cols-2">
            {BENEFITS.map((benefit) => (
              <li
                key={benefit.title}
                className="flex items-start gap-2.5 rounded-md border bg-stone-50/60 p-3"
                style={{ borderColor: "var(--portal-border-subtle)" }}
              >
                <CheckCircle2
                  className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-stone-900">
                    {benefit.title}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {benefit.detail}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          {/* Pricing block — the prominent conversion driver. Larger weight
              and a tighter rule above so the eye lands here right after the
              benefits scan. */}
          <div
            className="rounded-md border bg-stone-50 px-4 py-3"
            style={{ borderColor: "var(--portal-border-subtle)" }}
          >
            <p className="text-base font-semibold text-stone-900">
              {OPERATIONS_PRO_PRICE_LABEL}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Unlimited residents, unlimited staff seats, all modules
              included. Cancel anytime from Stripe.
            </p>
          </div>

          {checkoutError?.kind === "unavailable" ? (
            <Alert variant="destructive" data-testid="operations-paywall-unavailable">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              <AlertTitle>Payments are temporarily unavailable</AlertTitle>
              <AlertDescription>
                Please try again later or{" "}
                <a
                  href="mailto:support@arf-map.com"
                  className="underline underline-offset-2"
                >
                  contact support
                </a>{" "}
                for help activating your account.
              </AlertDescription>
            </Alert>
          ) : null}

          {checkoutError?.kind === "generic" ? (
            <Alert variant="destructive" data-testid="operations-paywall-error">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              <AlertTitle>Could not start checkout</AlertTitle>
              <AlertDescription>
                {checkoutError.message} Please try again.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-2">
            <Button
              type="button"
              onClick={startCheckout}
              disabled={isStartingCheckout}
              className="gap-1.5"
              data-testid="operations-paywall-cta"
              aria-label="Upgrade to Operations Pro"
            >
              {isStartingCheckout ? (
                <>
                  <Loader2
                    className="h-3.5 w-3.5 animate-spin"
                    aria-hidden="true"
                  />
                  Starting checkout…
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  Upgrade to Operations Pro
                </>
              )}
            </Button>

            <p className="text-xs text-muted-foreground">
              You'll be redirected to Stripe's secure hosted checkout.
            </p>
          </div>

          {/* Promo / bypass code — owner-issued comps that skip Stripe
              entirely. Collapsed by default so it doesn't dilute the
              paid CTA above. */}
          <div className="border-t pt-3" style={{ borderColor: "var(--portal-border-subtle)" }}>
            {!showCodeForm ? (
              <button
                type="button"
                onClick={() => setShowCodeForm(true)}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-stone-900 underline-offset-2 hover:underline"
                data-testid="operations-paywall-promo-toggle"
              >
                <Ticket className="h-3.5 w-3.5" aria-hidden="true" />
                Have a promo code?
              </button>
            ) : (
              <div className="space-y-2">
                <label className="text-xs font-medium text-stone-900 flex items-center gap-1.5">
                  <Ticket className="h-3.5 w-3.5" aria-hidden="true" />
                  Promo code
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    type="text"
                    value={codeInput}
                    onChange={(e) => setCodeInput(e.target.value)}
                    placeholder="Enter your code"
                    disabled={isRedeemingCode}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        redeemCode();
                      }
                    }}
                    data-testid="operations-paywall-promo-input"
                    className="sm:max-w-xs"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={redeemCode}
                    disabled={isRedeemingCode}
                    data-testid="operations-paywall-promo-submit"
                  >
                    {isRedeemingCode ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        Applying…
                      </>
                    ) : (
                      "Apply code"
                    )}
                  </Button>
                </div>
                {codeError ? (
                  <p
                    className="text-xs text-destructive"
                    data-testid="operations-paywall-promo-error"
                  >
                    {codeError}
                  </p>
                ) : null}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default OperationsPaywall;
