import { useEffect } from "react";
import { useRoute, useLocation } from "wouter";

// In-flow browsing opens <JobDetailModal> from <JobsPanel>; we never
// route to a standalone job-detail page anymore. Direct / shared-link
// arrivals to `/#/jobs/:externalId` would otherwise hit a dead route, so
// this component stays mounted under that path and does two things:
//
//   1. Stash the job external id in sessionStorage so JobsPanel can pick
//      it up on mount and open the modal automatically (mirrors the
//      pendingAction handoff used by ExpressInterestButton).
//   2. Redirect to /map (replace history so the back button skips
//      this redirector and the user lands on their previous page).
//
// Phase 7 note: the URL param is the public `external_id` (nanoid string),
// not the legacy integer PK. Legacy bookmarked integer URLs are silently
// dropped — JobsPanel sees no pending key and shows the unselected map.
//
// No UI is rendered — the redirect happens before paint.
const PENDING_JOB_MODAL_KEY = "pending_job_modal";
const EXTERNAL_ID_REGEX = /^[A-Za-z0-9_-]{4,32}$/;

export default function JobDetailPage() {
  const [match, params] = useRoute<{ id: string }>("/jobs/:id");
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (match && params?.id && EXTERNAL_ID_REGEX.test(params.id)) {
      try {
        sessionStorage.setItem(PENDING_JOB_MODAL_KEY, params.id);
      } catch {
        // sessionStorage unavailable (private browsing) — silently
        // skip the handoff; the modal will just not auto-open.
      }
    }
    setLocation("/map", { replace: true });
  }, []);

  return null;
}
