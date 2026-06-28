import "dotenv/config";
import express, { Response, NextFunction } from 'express';
import type { Request } from 'express';
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { startInatAutoSync } from "./inatScheduler";
import { backfillSubspeciesRecords } from "./inat";
import { storage, sqlite } from "./storage";
import { createServer } from "node:http";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "15mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "15mb" }));

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
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  // One-shot backfill for legacy iNat records where species_id was left null
  // because the row was identified at the subspecies rank.
  try {
    backfillSubspeciesRecords();
  } catch (e) {
    console.error("[inat backfill] failed:", (e as Error).message);
  }

  // One-shot backfill: every existing account auto-follows Will Hunt (id=2),
  // matching the rule applied to all new signups. createFollow is idempotent
  // and short-circuits on self-follow, so re-running this on every boot is
  // safe and effectively a no-op once the table is saturated.
  try {
    const rows = sqlite
      .prepare("SELECT id FROM users WHERE id != 2")
      .all() as Array<{ id: number }>;
    let added = 0;
    for (const r of rows) {
      const before = storage.isFollowing(r.id, 2);
      storage.createFollow(r.id, 2);
      if (!before && storage.isFollowing(r.id, 2)) added++;
    }
    if (added > 0) {
      log(`auto-follow Will Hunt: added ${added} new follow row(s)`, "backfill");
    }
  } catch (e) {
    console.error("[follow backfill] failed:", (e as Error).message);
  }

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
  // Bind to all interfaces by default so platforms like Render (which scan for
  // an open port on 0.0.0.0) can route traffic to the container. HOST env var
  // lets specific hosts override (e.g. the original Replit setup used 127.0.0.1
  // to avoid a platform port-forwarding conflict — set HOST=127.0.0.1 there).
  const host = process.env.HOST || "0.0.0.0";
  httpServer.listen(
    {
      port,
      host,
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
      // Seed Willhunt as super-admin if he exists and has no role yet.
      try {
        const w = storage.getUserByUsername("Willhunt");
        if (w && (((w as any).role) || "none") === "none") {
          storage.setUserRole(w.id, "super-admin");
          log("seeded Willhunt as super-admin");
        }
      } catch (err) {
        log(`seed failed: ${(err as any)?.message || err}`);
      }
      // Kick off the background iNaturalist auto-sync. Runs hourly,
      // re-syncs any connected user whose last import is > 1h old.
      // Disable via DISABLE_INAT_SCHEDULER=1 to debug crashes / save memory.
      if (process.env.DISABLE_INAT_SCHEDULER === "1") {
        log("iNat auto-sync DISABLED via DISABLE_INAT_SCHEDULER=1");
      } else {
        startInatAutoSync();
      }
    },
  );
})();
