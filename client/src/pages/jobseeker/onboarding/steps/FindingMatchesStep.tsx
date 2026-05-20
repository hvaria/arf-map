// FindingMatchesStep — wizard step 5 (terminal). 1.5s brand-mark
// loader then auto-navigate to the seeker dashboard. The wait pattern
// signals "we did work" even though Phase 1 doesn't actually surface
// a matches feed yet.
import { useEffect } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import { BrandLoader } from "@/components/BrandLoader";

const REDIRECT_DELAY_MS = 1500;

export function FindingMatchesStep() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    const t = window.setTimeout(() => {
      setLocation("/jobseeker/dashboard", { replace: true });
    }, REDIRECT_DELAY_MS);
    return () => window.clearTimeout(t);
    // setLocation is stable per wouter — no need to depend on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      <div className="text-center space-y-3 flex flex-col items-center">
        <BrandLoader size="lg" />
        <h2 className="text-xl font-semibold" style={{ color: "#1E1B4B" }}>
          Finding matches near you…
        </h2>
        <p className="text-sm text-stone-500">
          We're lining up roles that fit your profile.
        </p>
      </div>

      <div className="space-y-3" aria-hidden="true">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    </motion.div>
  );
}

export default FindingMatchesStep;
