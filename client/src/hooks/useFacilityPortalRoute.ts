/**
 * useFacilityPortalRoute — URL-driven state for the facility portal shell.
 *
 * Promotes the facility-portal tab, the Operations sub-view, the selected
 * tracker slug, and the selected resident (+ inner resident tab) from
 * `useState` into the hash URL. Hard refresh now restores the exact view
 * the operator was on; Back/Forward traverses naturally.
 *
 * Canonical URL shapes (all hash-routed, Capacitor-friendly):
 *
 *   #/facility-portal                                          — details tab
 *   #/facility-portal/jobs                                     — jobs tab
 *   #/facility-portal/applicants                               — applicants tab
 *   #/facility-portal/operations                               — ops overview
 *   #/facility-portal/operations/:subView                      — sub-view
 *   #/facility-portal/operations/tracker                       — tracker picker
 *   #/facility-portal/operations/tracker/:slug                 — selected tracker
 *   #/facility-portal/operations/residents/:residentId         — resident profile
 *   #/facility-portal/operations/residents/:residentId/:tab    — resident profile tab
 *
 * Query params (e.g. `?billing=success` from Stripe) live inside the hash
 * after a `?` — the existing readHashParams/clearHashParams helpers in
 * FacilityPortal.tsx still own them. This hook strips the `?…` portion
 * before parsing path segments, so the two systems compose cleanly.
 *
 * Validation: invalid sub-view → null (overview); non-numeric residentId →
 * null (residents list); invalid residentTab → "details". This keeps a
 * fat-fingered URL graceful instead of throwing.
 *
 * Notes deep-link at `#/facility-portal/notes` is NOT routed through this
 * hook — App.tsx mounts `NotesPage` as a separate <Route> above the portal
 * routes, so the parser here treats "notes" as not-our-concern (parses as
 * tab="details" but the hook is never mounted because NotesPage owns it).
 */
import { useCallback, useSyncExternalStore } from "react";

// ── Public types ─────────────────────────────────────────────────────────────

export type PortalTab = "details" | "jobs" | "applicants" | "operations";

export type SubView =
  | "residents"
  | "emar"
  | "tasks"
  | "incidents"
  | "crm"
  | "billing"
  | "staff"
  | "compliance"
  | "audit_readiness"
  | "reports"
  | "calendar"
  | "tracker";

export type ResidentTab =
  | "details"
  | "assessments"
  | "care-plan"
  | "meds"
  | "incidents";

export interface FacilityPortalRoute {
  tab: PortalTab;
  subView: SubView | null;
  trackerSlug: string | null;
  residentId: number | null;
  residentTab: ResidentTab;
}

export interface FacilityPortalRouteApi extends FacilityPortalRoute {
  navigate: (patch: Partial<FacilityPortalRoute>, opts?: { replace?: boolean }) => void;
}

// ── Constants ────────────────────────────────────────────────────────────────

// SubView keys as they appear in URLs. `audit_readiness` is a JS identifier
// internally but URL slugs use dashes for readability.
const URL_TO_SUBVIEW: Record<string, SubView> = {
  residents: "residents",
  emar: "emar",
  tasks: "tasks",
  incidents: "incidents",
  crm: "crm",
  billing: "billing",
  staff: "staff",
  compliance: "compliance",
  "audit-readiness": "audit_readiness",
  reports: "reports",
  calendar: "calendar",
  tracker: "tracker",
};

const SUBVIEW_TO_URL: Record<SubView, string> = {
  residents: "residents",
  emar: "emar",
  tasks: "tasks",
  incidents: "incidents",
  crm: "crm",
  billing: "billing",
  staff: "staff",
  compliance: "compliance",
  audit_readiness: "audit-readiness",
  reports: "reports",
  calendar: "calendar",
  tracker: "tracker",
};

const VALID_RESIDENT_TABS: ReadonlySet<ResidentTab> = new Set<ResidentTab>([
  "details",
  "assessments",
  "care-plan",
  "meds",
  "incidents",
]);

// ── Pure parser ──────────────────────────────────────────────────────────────

/**
 * Parse a wouter hash-location string into a FacilityPortalRoute.
 *
 * Wouter's useHashLocation returns the path with a leading slash, optionally
 * followed by `?query`. We strip the query portion first since query params
 * are owned by readHashParams in FacilityPortal.tsx — different concern.
 *
 * Anything outside the `/facility-portal/...` subtree returns the default
 * shape; this hook is only mounted inside the portal so out-of-tree calls
 * shouldn't happen, but the parser is defensive.
 */
export function parseFacilityPortalUrl(location: string): FacilityPortalRoute {
  // Strip query string — query params (?billing=success, ?paywall=1) are
  // handled by the existing readHashParams helper, not by this router.
  const qIdx = location.indexOf("?");
  const path = qIdx === -1 ? location : location.slice(0, qIdx);

  // Normalize: drop leading slash, split on slashes, drop trailing empties.
  const segments = path.split("/").filter((s) => s.length > 0);

  // Expect first segment to be "facility-portal". If not, return defaults
  // (caller is misusing this hook outside the portal).
  if (segments[0] !== "facility-portal") {
    return {
      tab: "details",
      subView: null,
      trackerSlug: null,
      residentId: null,
      residentTab: "details",
    };
  }

  const rawTab = segments[1];

  // Bare /facility-portal → details tab.
  if (rawTab === undefined) {
    return {
      tab: "details",
      subView: null,
      trackerSlug: null,
      residentId: null,
      residentTab: "details",
    };
  }

  // The notes deep-link is handled by its own <Route> in App.tsx; this hook
  // shouldn't be running on that page. Be defensive — fall through to the
  // default details shape rather than treating "notes" as a tab.
  if (rawTab === "notes") {
    return {
      tab: "details",
      subView: null,
      trackerSlug: null,
      residentId: null,
      residentTab: "details",
    };
  }

  // Simple tabs: jobs, applicants, details.
  if (rawTab === "jobs" || rawTab === "applicants" || rawTab === "details") {
    return {
      tab: rawTab,
      subView: null,
      trackerSlug: null,
      residentId: null,
      residentTab: "details",
    };
  }

  if (rawTab !== "operations") {
    // Unknown tab → graceful fallback to details.
    return {
      tab: "details",
      subView: null,
      trackerSlug: null,
      residentId: null,
      residentTab: "details",
    };
  }

  // Operations sub-tree.
  const rawSubView = segments[2];
  if (rawSubView === undefined) {
    return {
      tab: "operations",
      subView: null,
      trackerSlug: null,
      residentId: null,
      residentTab: "details",
    };
  }

  const subView = URL_TO_SUBVIEW[rawSubView];
  if (subView === undefined) {
    // Unknown sub-view → land at ops overview (graceful).
    return {
      tab: "operations",
      subView: null,
      trackerSlug: null,
      residentId: null,
      residentTab: "details",
    };
  }

  // Tracker sub-tree: /operations/tracker[/:slug]
  if (subView === "tracker") {
    const slug = segments[3] ?? null;
    return {
      tab: "operations",
      subView: "tracker",
      trackerSlug: slug && slug.length > 0 ? slug : null,
      residentId: null,
      residentTab: "details",
    };
  }

  // Residents sub-tree: /operations/residents[/:residentId[/:tab]]
  if (subView === "residents") {
    const rawResidentId = segments[3];
    if (rawResidentId === undefined) {
      return {
        tab: "operations",
        subView: "residents",
        trackerSlug: null,
        residentId: null,
        residentTab: "details",
      };
    }
    // Numeric resident id — anything else → fall back to the list view
    // (silently ignore garbage like /residents/abc).
    const idNum = Number(rawResidentId);
    if (!Number.isFinite(idNum) || !Number.isInteger(idNum) || idNum <= 0) {
      return {
        tab: "operations",
        subView: "residents",
        trackerSlug: null,
        residentId: null,
        residentTab: "details",
      };
    }
    const rawResidentTab = segments[4];
    const residentTab: ResidentTab =
      rawResidentTab && VALID_RESIDENT_TABS.has(rawResidentTab as ResidentTab)
        ? (rawResidentTab as ResidentTab)
        : "details";
    return {
      tab: "operations",
      subView: "residents",
      trackerSlug: null,
      residentId: idNum,
      residentTab,
    };
  }

  // All other sub-views — leaf segments are ignored.
  return {
    tab: "operations",
    subView,
    trackerSlug: null,
    residentId: null,
    residentTab: "details",
  };
}

// ── URL builder ──────────────────────────────────────────────────────────────

/**
 * Build the canonical hash path (without the leading "#") for a given route.
 * Always returns "/facility-portal" prefix. Defaults are omitted from the
 * tail so the URL stays clean — e.g. tab="details" produces just
 * "/facility-portal", not "/facility-portal/details".
 */
export function buildFacilityPortalUrl(route: FacilityPortalRoute): string {
  const parts: string[] = ["facility-portal"];

  if (route.tab === "operations") {
    parts.push("operations");
    if (route.subView !== null) {
      if (route.subView === "tracker") {
        parts.push("tracker");
        if (route.trackerSlug !== null && route.trackerSlug.length > 0) {
          parts.push(route.trackerSlug);
        }
      } else if (route.subView === "residents") {
        parts.push("residents");
        if (route.residentId !== null) {
          parts.push(String(route.residentId));
          if (route.residentTab !== "details") {
            parts.push(route.residentTab);
          }
        }
      } else {
        parts.push(SUBVIEW_TO_URL[route.subView]);
      }
    }
  } else if (route.tab !== "details") {
    // jobs / applicants — append as a single segment.
    parts.push(route.tab);
  }
  // tab === "details" → bare /facility-portal.

  return "/" + parts.join("/");
}

// ── External store: subscribe to hashchange ─────────────────────────────────

function getHashLocation(): string {
  if (typeof window === "undefined") return "/";
  // Mirror wouter's hash-location reader: strip the leading "#" and ensure a
  // leading "/" so the parser always sees a normalized path.
  return "/" + window.location.hash.replace(/^#?\/?/, "");
}

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

function getServerSnapshot(): string {
  return "/";
}

/**
 * Write a route patch to the URL.
 *
 * Uses window.history.pushState + a synthetic hashchange event (same
 * technique as useNotesUrlState) so we can preserve any in-hash query
 * params (e.g. `?billing=success` from Stripe) instead of clobbering them
 * the way wouter's navigate() would.
 */
function writeRoute(next: FacilityPortalRoute, opts?: { replace?: boolean }) {
  if (typeof window === "undefined") return;

  const path = buildFacilityPortalUrl(next);

  // Preserve any existing query portion inside the hash. The mount-time
  // effect in FacilityPortal already clears billing/paywall on first read,
  // but if a user clicks a tab before that effect runs we don't want to
  // drop the param mid-flight.
  const currentHash = window.location.hash;
  const qIdx = currentHash.indexOf("?");
  const querySuffix = qIdx === -1 ? "" : currentHash.slice(qIdx);

  const nextHash = `#${path}${querySuffix}`;
  if (nextHash === currentHash) return;

  const oldURL = window.location.href;
  const nextUrl = `${window.location.pathname}${window.location.search}${nextHash}`;
  if (opts?.replace) {
    window.history.replaceState(null, "", nextUrl);
  } else {
    window.history.pushState(null, "", nextUrl);
  }
  const newURL = window.location.href;

  const event =
    typeof HashChangeEvent !== "undefined"
      ? new HashChangeEvent("hashchange", { oldURL, newURL })
      : new Event("hashchange");
  window.dispatchEvent(event);
}

// ── React hook ───────────────────────────────────────────────────────────────

export function useFacilityPortalRoute(): FacilityPortalRouteApi {
  const location = useSyncExternalStore(
    subscribe,
    getHashLocation,
    getServerSnapshot,
  );
  const state = parseFacilityPortalUrl(location);

  const navigate = useCallback(
    (patch: Partial<FacilityPortalRoute>, opts?: { replace?: boolean }) => {
      // Read live URL so consecutive synchronous patches accumulate the
      // same way useNotesUrlState does.
      const current = parseFacilityPortalUrl(getHashLocation());
      const merged: FacilityPortalRoute = {
        tab: patch.tab ?? current.tab,
        subView:
          patch.subView !== undefined ? patch.subView : current.subView,
        trackerSlug:
          patch.trackerSlug !== undefined
            ? patch.trackerSlug
            : current.trackerSlug,
        residentId:
          patch.residentId !== undefined
            ? patch.residentId
            : current.residentId,
        residentTab: patch.residentTab ?? current.residentTab,
      };

      // Cross-axis invariants: switching tabs/sub-views should clear
      // unrelated leaf state so the URL doesn't carry stale segments that
      // would confuse the parser on round-trip.
      //
      //   • Leaving operations clears subView/trackerSlug/residentId.
      //   • Switching sub-views away from tracker clears trackerSlug.
      //   • Switching sub-views away from residents clears residentId/Tab.
      const clearTrackerLeaf = merged.subView !== "tracker";
      const clearResidentLeaf = merged.subView !== "residents";
      const final: FacilityPortalRoute = {
        tab: merged.tab,
        subView: merged.tab === "operations" ? merged.subView : null,
        trackerSlug:
          merged.tab === "operations" && !clearTrackerLeaf
            ? merged.trackerSlug
            : null,
        residentId:
          merged.tab === "operations" && !clearResidentLeaf
            ? merged.residentId
            : null,
        residentTab:
          merged.tab === "operations" && !clearResidentLeaf
            ? merged.residentTab
            : "details",
      };

      writeRoute(final, opts);
    },
    [],
  );

  return {
    ...state,
    navigate,
  };
}
