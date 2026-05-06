/**
 * Idempotency middleware for the single-entry POST.
 *
 * The contract: every tracker write carries a caller-generated UUID
 * `clientId` in the body. Resubmitting the same `clientId` returns the
 * existing row with `duplicate: true` instead of inserting a new one.
 *
 * This middleware does the *pre-check*. The unique index on
 * (facility_number, client_id) is the final safety net.
 *
 * For the bulk endpoint, idempotency is handled inside the storage
 * transaction (per item), NOT here.
 */

import type { NextFunction, Request, Response } from "express";

import {
  findEntryByClientId,
  type HydratedTrackerEntryRow,
} from "../trackerStorage";
import type { FacilityAccount } from "@shared/schema";

const UUID_RX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Augments `res.locals` with a typed `duplicateEntry` slot. We avoid creating
 * a new ambient `.d.ts` and rely on caller casts where strictly needed —
 * this declaration is module-scoped via `declare global` patterns elsewhere
 * in the codebase, but for trackers we keep the cast local to the route
 * handler to avoid polluting the global namespace for everyone.
 */
export type TrackerLocals = {
  duplicateEntry?: HydratedTrackerEntryRow;
};

export async function trackerIdempotencyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const clientId = (req.body as { clientId?: unknown } | undefined)?.clientId;
  if (typeof clientId !== "string" || !UUID_RX.test(clientId)) {
    res.status(400).json({
      success: false,
      error: "clientId is required and must be a valid UUID",
    });
    return;
  }

  const user = req.user as FacilityAccount | undefined;
  const facilityNumber = user?.facilityNumber;
  if (!facilityNumber) {
    // Should never happen — `requireFacilityAuth` runs upstream — but fail
    // safe rather than silently dropping the idempotency check.
    res.status(401).json({ success: false, error: "Not authenticated" });
    return;
  }

  try {
    const existing = await findEntryByClientId(facilityNumber, clientId);
    if (existing) {
      (res.locals as TrackerLocals).duplicateEntry = existing;
    }
    next();
  } catch (err) {
    next(err);
  }
}
