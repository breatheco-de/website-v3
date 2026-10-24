/**
 * Loopback deploy hooks: push unpushed content before a release switch, and pause staff/agent
 * writes for the last seconds of a deploy. Called by scripts/deploy.sh on the VPS.
 */

import type { Express, Request, Response } from "express";
import { api } from "../rate-limit/api.js";
import { flushUnpushedContent } from "../content-flush";
import {
  DEFAULT_PAUSE_SECONDS,
  contentWritesInFlight,
  isContentWritePaused,
  pauseContentWrites,
  pauseRemainingSeconds,
  resumeContentWrites,
  waitForContentWritesInFlight,
} from "../content-write-pause";
import { child } from "../logger";

const log = child({ module: "routes/internal-content" });
const MAX_PAUSE_SECONDS = 600;

function isLoopback(req: Request): boolean {
  const addr = req.socket?.remoteAddress ?? "";
  const loop = addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
  const forwarded =
    !!req.headers["x-forwarded-for"] ||
    !!req.headers["x-real-ip"] ||
    !!req.headers["cf-connecting-ip"] ||
    !!req.headers.forwarded;
  return loop && !forwarded;
}

function bearer(req: Request): string {
  const header = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

/** Loopback + Bearer SESSION_SECRET (deploy script). */
export function isDeployHookRequest(req: Request): boolean {
  const secret = process.env.SESSION_SECRET || "";
  return isLoopback(req) && !!secret && bearer(req) === secret;
}

/** Loopback + SESSION_SECRET or the MCP server secret (read-only pause state). */
function isPauseReadRequest(req: Request): boolean {
  if (!isLoopback(req)) return false;
  const token = bearer(req);
  if (!token) return false;
  const secrets = [process.env.SESSION_SECRET, process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY].filter(
    (s): s is string => !!s,
  );
  return secrets.includes(token);
}

let flushRunning = false;

export function registerInternalContentRoutes(app: Express): void {
  api.post(
    app,
    "/api/internal/content/flush",
    { rate: "exempt", reason: "loopback deploy hook" },
    async (req: Request, res: Response) => {
      if (!isDeployHookRequest(req)) {
        res.status(403).json({ ok: false, error: "loopback deploy hook only" });
        return;
      }
      if (flushRunning) {
        res.status(409).json({ ok: false, error: "A content flush is already running" });
        return;
      }
      flushRunning = true;
      const deploySha = typeof req.body?.deploy_sha === "string" ? req.body.deploy_sha.slice(0, 64) : null;
      const pause = req.body?.pause_writes === true;
      try {
        let stillWriting = 0;
        if (pause) {
          const seconds = Math.min(
            MAX_PAUSE_SECONDS,
            Number.isFinite(req.body?.pause_seconds) ? Math.max(1, Number(req.body.pause_seconds)) : DEFAULT_PAUSE_SECONDS,
          );
          pauseContentWrites(seconds);
          stillWriting = await waitForContentWritesInFlight();
        }
        const report = await flushUnpushedContent();
        log.info(
          { deploySha, pause, ok: report.ok, sites: report.sites.map((s) => ({ site: s.site, pushed: s.pushed, remaining: s.remaining.length })) },
          "[deploy] content flush",
        );
        res.json({
          ...report,
          paused: isContentWritePaused(),
          ...(stillWriting ? { writes_still_running: stillWriting } : {}),
        });
      } catch (err) {
        log.error({ err, deploySha }, "[deploy] content flush failed");
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err), paused: isContentWritePaused() });
      } finally {
        flushRunning = false;
      }
    },
  );

  api.post(
    app,
    "/api/internal/content/resume-writes",
    { rate: "exempt", reason: "loopback deploy hook" },
    async (req: Request, res: Response) => {
      if (!isDeployHookRequest(req)) {
        res.status(403).json({ ok: false, error: "loopback deploy hook only" });
        return;
      }
      resumeContentWrites();
      res.json({ ok: true, paused: false });
    },
  );

  api.get(
    app,
    "/api/internal/content/write-pause",
    { rate: "exempt", reason: "loopback pause state for MCP file writers" },
    async (req: Request, res: Response) => {
      if (!isPauseReadRequest(req)) {
        res.status(403).json({ ok: false, error: "loopback only" });
        return;
      }
      res.json({
        paused: isContentWritePaused(),
        retry_after_seconds: pauseRemainingSeconds(),
        in_flight: contentWritesInFlight(),
      });
    },
  );
}
