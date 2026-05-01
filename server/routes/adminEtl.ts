import { Router, Request, Response, NextFunction } from "express";
import { getEnrichmentLogAsync } from "../storage";

export const adminEtlRouter = Router();

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Not authenticated" });
  next();
}

adminEtlRouter.get("/log", requireAuth, async (_req: Request, res: Response) => {
  res.json(await getEnrichmentLogAsync());
});
