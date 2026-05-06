/**
 * Tracker definitions sub-router.
 *
 * Mounted at `/api/ops/trackers/definitions` by routes.ts. Both endpoints
 * read from the in-memory registry (not the DB) — the
 * `tracker_definitions` table exists for join convenience and audit
 * lineage, but the canonical source of truth is the registry shipped in
 * the bundle.
 *
 * The `payloadSchema` Zod object is stripped before serialization (see
 * `serializeDefinitionForClient`); the client carries its own copy.
 */

import { Router } from "express";

import {
  getDefinition,
  listSerializedDefinitions,
  serializeDefinitionForClient,
} from "../registry";

export const definitionsRouter = Router();

definitionsRouter.get("/", (_req, res) => {
  res.json({ success: true, data: listSerializedDefinitions() });
});

definitionsRouter.get("/:slug", (req, res) => {
  const def = getDefinition(req.params.slug);
  if (!def || def.isActive === false) {
    return res.status(404).json({ success: false, error: "Not found" });
  }
  return res.json({ success: true, data: serializeDefinitionForClient(def) });
});
