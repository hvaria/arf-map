// NEW: expression-of-interest — typed wrapper for the sessionStorage pending action
export interface PendingAction {
  type: "express_interest";
  facilityId: string;
  facilityName: string;
}

const KEY = "pending_action";

export function setPendingAction(action: PendingAction): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(action));
  } catch {
    // sessionStorage unavailable (private browsing edge case) — fail silently
  }
}

export function getPendingAction(): PendingAction | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PendingAction;
  } catch {
    return null;
  }
}

export function clearPendingAction(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
