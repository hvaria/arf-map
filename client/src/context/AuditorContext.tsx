/**
 * AuditorContext — Wave 3 Phase 3.2.
 *
 * Provided by <AuditorPage> at `/#/auditor/:token`. Children inside the
 * auditor shell see a non-null context with the bearer token + facility
 * scope; everywhere else (the admin facility-portal session) the context
 * is null and `useIsWritable()` returns true.
 *
 * Pattern citations (Implementation Contract §2.5):
 *   - React context + provider + null-default pattern:
 *       client/src/context/AuthContext.tsx:1-60
 *
 * Security note: the token is intentionally kept in memory + URL only.
 * Never persist to localStorage — refresh drops it; auditor copies the
 * URL again. The matching backend route validates the token + audit-logs
 * every visit.
 */
import { createContext, useContext, type ReactNode } from "react";

export interface AuditorContextValue {
  token: string;
  facilityNumber: string;
  expiresAt: number;
  audience: string;
  audienceLabel?: string;
  readOnly: true;
}

const AuditorContext = createContext<AuditorContextValue | null>(null);

export function AuditorProvider({
  value,
  children,
}: {
  value: AuditorContextValue;
  children: ReactNode;
}) {
  return (
    <AuditorContext.Provider value={value}>{children}</AuditorContext.Provider>
  );
}

export function useAuditorContext(): AuditorContextValue | null {
  return useContext(AuditorContext);
}

/**
 * Convenience for components that have to gate write-actions. Returns
 * `true` when there is NO auditor session — i.e., the user is the
 * facility admin with full rights. Returns `false` when inside an
 * auditor shell (read-only mode).
 */
export function useIsWritable(): boolean {
  const auditor = useContext(AuditorContext);
  return !auditor;
}

/**
 * Build the standard Authorization header for auditor-mode requests.
 * The matching server middleware accepts `Authorization: Bearer <token>`
 * for any `/api/ops/auditor/*` endpoint.
 */
export function buildAuditorHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}
