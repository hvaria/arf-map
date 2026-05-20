// z-index map for the unified shell:
//   header        = 30
//   sub-toolbars  = 20 (rendered as siblings, e.g. FacilityPortal tabs)
//   panels        = 40
//   dialogs/sheets = 50
import { type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppHeaderAuth } from "@/hooks/useAppHeaderAuth";
import { AppHeaderBackButton } from "./AppHeaderBackButton";
import { AppHeaderAccountChip } from "./AppHeaderAccountChip";
import { AppHeaderMobileMenu } from "./AppHeaderMobileMenu";

export interface AppHeaderProps {
  /** Hide the right-side cluster (account chip + mobile menu + rightSlot). Back button and logo still render. */
  logoOnly?: boolean;
  /** Back-button target. Omit to skip the back affordance entirely. */
  backTo?: string;
  /** Visible label next to the back chevron. Defaults to "Back". */
  backLabel?: string;
  /** Override the default home route the logo links to. */
  logoHomeOverride?: string;
  /** "solid" (default, white bg) | "glass" (translucent — for MapPage). */
  variant?: "solid" | "glass";
  /** Content rendered immediately BEFORE the account chip (bell, refresh, etc.). */
  rightSlot?: ReactNode;
  /** Extra items rendered inside the mobile Sheet (e.g. notes bell). */
  mobileExtras?: ReactNode;
  /** Suppress the chip even when signed in (used on auth screens). */
  hideAccountChip?: boolean;
  /** Anonymous sign-in click handler. When set, used instead of routing. */
  onSignInOverride?: () => void;
}

export function AppHeader({
  logoOnly = false,
  backTo,
  backLabel = "Back",
  logoHomeOverride,
  variant = "solid",
  rightSlot,
  mobileExtras,
  hideAccountChip = false,
  onSignInOverride,
}: AppHeaderProps) {
  const auth = useAppHeaderAuth();
  const logoHome = logoHomeOverride ?? auth.homePath;
  // Hide the "Find jobs" link when the seeker is already on the find-
  // jobs surface — pointing a user at a link to the page they're on
  // is just noise. Covers both the new /jobs alias and the legacy /map.
  const [pathname] = useLocation();
  const isOnJobsSurface = pathname === "/jobs" || pathname === "/map";

  return (
    // The header owns its own safe-area handling so `position: sticky`
    // keeps the brand mark below the status bar / notch even when the
    // page scrolls. The global #root padding-top was removed (see
    // index.css) to prevent double-stacking on dashboard-style pages
    // where the AppHeader is the only safe-area-sensitive surface.
    <header
      className={cn(
        "sticky top-0 z-30",
        "shadow-[0_1px_3px_rgba(15,23,42,0.06),0_4px_12px_rgba(15,23,42,0.04)]",
        variant === "glass" ? "bg-white/85 backdrop-blur" : "bg-white",
      )}
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="h-16 flex items-center px-4 lg:px-6 gap-3">
        {/* Back button shows whenever a target is supplied, even in
            logoOnly shells — `logoOnly` only suppresses the right-side
            account chip / mobile menu, not navigation affordances. */}
        {backTo && (
          <AppHeaderBackButton to={backTo} label={backLabel} />
        )}

        <Link
          href={logoHome}
          className="flex items-center hover:opacity-90 transition-opacity"
          aria-label="Home"
        >
          {/* Two instances toggled by breakpoint so we get a slightly
              smaller mark on mobile without rerendering on resize. */}
          <span className="hidden sm:flex">
            <BrandLogo size={48} />
          </span>
          <span className="flex sm:hidden">
            <BrandLogo size={44} />
          </span>
        </Link>

        {/* Right-aligned cluster. `ml-auto` keeps the logo flush-left
            even when there's no left content; the gap matches the
            header's. */}
        <div className="ml-auto flex items-center gap-2">
          {!logoOnly && (
            <>
              {/* Persistent "Find jobs" link for signed-in seekers.
                  Operators don't see this — their nav lives in the
                  FacilityPortal tab strip. Hidden on mobile (the link
                  is still reachable from the dashboard's Find jobs
                  CTA + the mobile sheet's brand logo Home target) so
                  the header stays compact on narrow viewports. Also
                  hidden when the seeker is already on /jobs or /map —
                  pointing at the page you're on is noise. */}
              {auth.role === "jobseeker" && !isOnJobsSurface && (
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="hidden sm:inline-flex h-8 px-3 text-sm font-medium text-stone-700 hover:text-stone-900"
                >
                  <Link href="/jobs">Find jobs</Link>
                </Button>
              )}
              {rightSlot}
              {!hideAccountChip && (
                <div className="hidden sm:block">
                  <AppHeaderAccountChip onSignInOverride={onSignInOverride} />
                </div>
              )}
              <AppHeaderMobileMenu
                extras={mobileExtras}
                onSignInOverride={onSignInOverride}
              />
            </>
          )}
        </div>
      </div>
    </header>
  );
}
