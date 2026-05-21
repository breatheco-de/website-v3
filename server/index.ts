import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { fallbackRedirectMiddleware } from "./redirects";
import { initialDataMiddleware } from "./initial-data-middleware";
import compression from "compression";
import cookieParser from "cookie-parser";
import path from "path";
import { setAutoCommitCallback } from "./sync-state";
import { queueFileChange } from "./auto-commit";
import { databaseManager } from "./database";
// Note: gcs.initFromEnv() is called by media.initFromEnv() in routes.ts,
// which happens before sync-state needs it.

const app = express();

app.use(cookieParser());

app.use('/attached_assets', express.static(path.join(process.cwd(), 'attached_assets')));
app.use('/marketing-content/images', express.static(path.join(process.cwd(), 'marketing-content', 'images')));

app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
  level: 6,
}));

app.use((req, res, next) => {
  const ext = req.path.split('.').pop();
  if (['js', 'css', 'woff2', 'woff', 'ttf', 'png', 'jpg', 'jpeg', 'webp', 'svg', 'ico'].includes(ext || '')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (req.path.endsWith('.html') || req.path === '/') {
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  }
  next();
});

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));

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

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  setAutoCommitCallback(queueFileChange);
  log('[AutoCommit] Auto-commit callback registered');

  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // Fallback redirects: only fire for URLs that would otherwise 404
  // Registered before Vite's catch-all so they can intercept unknown routes
  app.use(fallbackRedirectMiddleware);

  app.use(initialDataMiddleware);

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
    databaseManager.warmup().catch((err) => {
      console.error("[DatabaseManager] Warmup error:", err);
    });
  });
})();
