// WalkthroughPage — 3-card swipe intro shown to brand-new job seekers
// before they hit the auth/register surface. Route: #/jobs/welcome.
//
// Behaviors (architect spec):
//   - One card visible at a time; horizontal swipe (either direction)
//     advances forward. There is no "skip vs like" semantic in Phase 1.
//   - "Get started" CTA and "Skip" link both set
//     localStorage["seeker.walkthroughSeen"] = "1" and navigate to
//     /#/job-seeker.
//   - On mount: if the flag is already "1" AND the URL does NOT contain
//     ?force=1, redirect to /#/jobs (the map). ?force=1 always shows it.
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import { MapPin, ShieldCheck, Sparkles, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SwipeCard } from "@/components/jobseeker/SwipeCard";
import { cn } from "@/lib/utils";
import {
  isWalkthroughSeen,
  markWalkthroughSeen,
} from "@/lib/seekerLocalStorage";

// Read query params from the hash URL. wouter's useSearch() reads
// window.location.search which is empty under hash routing — same
// reasoning as the readHashParams() helper in FacilityPortal.tsx.
function readHashParams(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams();
  const hash = window.location.hash;
  const qIdx = hash.indexOf("?");
  if (qIdx === -1) return new URLSearchParams();
  return new URLSearchParams(hash.slice(qIdx + 1));
}

interface SlideCopy {
  heading: string;
  body: string;
  Icon: LucideIcon;
}

// Copy is locked by the resolved-question block in the kickoff prompt —
// do NOT edit without product sign-off.
const SLIDES: readonly SlideCopy[] = [
  {
    heading: "Find care jobs near you",
    body: "We surface CNA, LVN, HHA and admin openings at licensed facilities within your area.",
    Icon: MapPin,
  },
  {
    heading: "Show off your credentials",
    body: "Tap the licenses and clearances you hold — we match you to roles that need them.",
    Icon: ShieldCheck,
  },
  {
    heading: "Get matched to facilities instantly",
    body: "We do the searching. You decide where to apply.",
    Icon: Sparkles,
  },
] as const;

export default function WalkthroughPage() {
  const [, setLocation] = useLocation();
  const [index, setIndex] = useState(0);

  // Redirect-away guard. Read once on mount — flag flips after the user
  // finishes; we don't want the page to redirect itself out mid-flow.
  useEffect(() => {
    const force = readHashParams().get("force") === "1";
    if (isWalkthroughSeen() && !force) {
      setLocation("/jobs", { replace: true });
    }
    // Intentionally only on mount — flag is immutable for this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = () => {
    markWalkthroughSeen();
    setLocation("/job-seeker");
  };

  const advance = () => {
    if (index >= SLIDES.length - 1) {
      finish();
      return;
    }
    setIndex((i) => i + 1);
  };

  const current = SLIDES[index];

  return (
    <div
      className="min-h-screen flex flex-col bg-gradient-to-b from-indigo-50 via-white to-white"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      {/* Pagination dots — top-center. */}
      <div className="flex items-center justify-center gap-2 pt-6 pb-4">
        {SLIDES.map((_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={cn(
              "h-1.5 rounded-full transition-all",
              i === index ? "w-6 bg-indigo-600" : "w-1.5 bg-stone-300",
            )}
          />
        ))}
      </div>

      {/* Card area — single visible card, swipe advances. AnimatePresence
          handles the cross-fade between cards. */}
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <AnimatePresence mode="wait">
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.22 }}
            >
              <SwipeCard onSwipe={() => advance()}>
                <div className="rounded-3xl bg-white shadow-xl border border-stone-100 p-8 text-center">
                  <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-100">
                    <current.Icon
                      className="h-8 w-8 text-indigo-600"
                      aria-hidden="true"
                    />
                  </div>
                  <h1
                    className="text-2xl font-bold mb-3"
                    style={{ color: "#1E1B4B" }}
                  >
                    {current.heading}
                  </h1>
                  <p className="text-sm leading-relaxed text-stone-600">
                    {current.body}
                  </p>
                </div>
              </SwipeCard>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* CTA + Skip. "Get started" is the affirmative path; both routes
          flip the seen-flag and land on /job-seeker. */}
      <div
        className="px-6 pb-8 space-y-3"
        style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}
      >
        <Button className="w-full h-12 text-base" onClick={finish}>
          Get started
        </Button>
        <button
          type="button"
          onClick={finish}
          className="w-full text-sm text-stone-500 hover:text-stone-700"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
