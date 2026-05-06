/**
 * Tracker module — top-level Express router.
 *
 * Mounted at `/trackers` by `opsRouter` (server/ops/opsRouter.ts), so it
 * inherits opsRouter's `requireFacilityAuth` and the IDOR guard for any
 * `:facilityNumber` URL params (the latter is a no-op on these routes since
 * none use that param). Effective URL: /api/ops/trackers/...
 *
 * No local auth middleware — running it here too would double-auth every
 * tracker request and couple two middleware chains. (M4)
 *
 * Mount paths (composed):
 *   GET    /api/ops/trackers/definitions
 *   GET    /api/ops/trackers/definitions/:slug
 *   GET    /api/ops/trackers/:slug/entries
 *   POST   /api/ops/trackers/:slug/entries
 *   POST   /api/ops/trackers/:slug/entries/bulk
 *   GET    /api/ops/trackers/entries/:id
 *   PATCH  /api/ops/trackers/entries/:id
 *   DELETE /api/ops/trackers/entries/:id
 *   GET    /api/ops/trackers/entries/:id/versions
 */

import { Router } from "express";

import { definitionsRouter } from "./definitions/definitionsRouter";
import { entriesRouter } from "./entries/entriesRouter";

export const trackerRouter = Router();

trackerRouter.use("/definitions", definitionsRouter);
trackerRouter.use("/", entriesRouter);
