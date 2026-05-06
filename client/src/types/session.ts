/**
 * Shared session shape — the response from /api/facility/me.
 *
 * Lives here so all 16+ portal pages can import it instead of declaring
 * their own (subtly different) local interfaces. Currently 8/16 had drifted
 * to include `role?: string`; the rest didn't.
 */
export interface SessionUser {
  id: number;
  facilityNumber: string;
  username: string;
  role?: string;
}
