import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { storage } from "./storage";
import { comparePassword } from "./auth";
import { sqlite } from "./db/index";
import { SqliteSessionStore } from "./session/sqliteSessionStore";
import { getCachedFacilities } from "./services/facilitiesService";
import type { FacilityAccount } from "@shared/schema";

declare global {
  namespace Express {
    interface User extends FacilityAccount {}
  }
}

const app = express();
const httpServer = createServer(app);

// fly.io (and most reverse proxies) terminate TLS at the edge and forward HTTP
// internally. Without this, req.secure = false and express-session silently skips
// setting the Set-Cookie header when cookie.secure = true, breaking all sessions.
app.set('trust proxy', 1);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "arf-map-facility-portal-secret",
    resave: false,
    saveUninitialized: false,
    // Production-safe SQLite session store — survives server restarts.
    // Swap for connect-pg-simple (PostgreSQL) or connect-redis as you scale.
    store: new SqliteSessionStore(sqlite),
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
              sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days default; overridable per-session
    },
  }),
);

app.use(passport.initialize());
app.use(passport.session());

passport.use(
  new LocalStrategy(async (username, password, done) => {
    try {
      const account = await storage.getFacilityAccountByUsername(username);
      if (!account) return done(null, false, { message: "Invalid credentials" });
      const valid = await comparePassword(password, account.password);
      if (!valid) return done(null, false, { message: "Invalid credentials" });
      return done(null, account);
    } catch (err) {
      return done(err);
    }
  }),
);

passport.serializeUser((user, done) => {
  done(null, (user as FacilityAccount).id);
});

passport.deserializeUser(async (id: number, done) => {
  try {
    const account = await storage.getFacilityAccount(id);
    done(null, account ?? false);
  } catch (err) {
    done(err);
  }
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      // Skip serializing large array responses (e.g. /api/facilities) to avoid blocking the event loop
      if (capturedJsonResponse && !Array.isArray(capturedJsonResponse)) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      } else if (Array.isArray(capturedJsonResponse)) {
        logLine += ` :: [${capturedJsonResponse.length} items]`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
    log(`[email] RESEND_API_KEY set: ${!!process.env.RESEND_API_KEY}`);

    // Pre-warm facility cache in the background so the first user request is instant
    if (!process.env.SKIP_PREWARM) {
      getCachedFacilities()
        .then((f) => log(`[facilitiesService] pre-warmed ${f.length} facilities`))
        .catch((err) => log(`[facilitiesService] pre-warm failed: ${err.message}`));
    }
  });
})();
