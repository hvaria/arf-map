/**
 * Shared session shape — the response from /api/facility/me.
 *
 * Lives here so all 16+ portal pages can import it instead of declaring
 * their own (subtly different) local interfaces. Currently 8/16 had drifted
 * to include `role?: string`; the rest didn't.
 *
 * `subscription` was added in the Operations paywall (Phase 0). It is
 * optional because (a) older server builds won't include it and (b) the
 * subscription gate on the client treats missing/null as "not active",
 * so consumers never need to distinguish "field absent" from "no
 * subscription record".
 */
import type { FacilitySubscription } from "@/lib/subscription";

export interface SessionUser {
  id: number;
  facilityNumber: string;
  username: string;
  role?: string;
  subscription?: FacilitySubscription | null;
}
