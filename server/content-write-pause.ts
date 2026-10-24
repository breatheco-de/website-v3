/**
 * Short pause on staff and agent writes while a deploy pushes the last unpushed content and
 * switches releases. Public visitors (lead forms, events) are never paused: they carry no
 * staff token. In memory only: a restart (the new release) starts unpaused.
 */

import type { NextFunction, Request, Response } from "express";

export const SITE_UPDATING_CODE = "site_updating";
export const DEFAULT_PAUSE_SECONDS = 180;
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

let pausedUntil = 0;
let inFlight = 0;

export function isContentWritePaused(now = Date.now()): boolean {
  return pausedUntil > now;
}

export function pauseContentWrites(seconds = DEFAULT_PAUSE_SECONDS): void {
  pausedUntil = Date.now() + seconds * 1000;
}

export function resumeContentWrites(): void {
  pausedUntil = 0;
}

export function pauseRemainingSeconds(now = Date.now()): number {
  return pausedUntil > now ? Math.max(1, Math.ceil((pausedUntil - now) / 1000)) : 0;
}

export function contentWritesInFlight(): number {
  return inFlight;
}

/** Wait until writes that started before the pause have finished. Returns how many are still running. */
export async function waitForContentWritesInFlight(maxMs = 15_000): Promise<number> {
  const deadline = Date.now() + maxMs;
  while (inFlight > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  return inFlight;
}

/** Staff (Token / X-Debug-Token) or MCP (Bearer secret) mutating API call, outside internal and auth routes. */
export function isPausableWriteRequest(req: Request): boolean {
  if (!MUTATING.has(req.method)) return false;
  const p = req.path;
  if (!p.startsWith("/api/") || p.startsWith("/api/internal/") || p.startsWith("/api/auth/")) return false;
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Token ") || req.headers["x-debug-token"]) return true;
  const mcpSecret = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY || "";
  return !!mcpSecret && auth === `Bearer ${mcpSecret}`;
}

export function contentWritePauseMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!isPausableWriteRequest(req)) {
    next();
    return;
  }
  const now = Date.now();
  if (isContentWritePaused(now)) {
    const retryAfter = pauseRemainingSeconds(now);
    res.setHeader("Retry-After", String(retryAfter));
    res.status(503).json({
      code: SITE_UPDATING_CODE,
      error: "The site is updating. Try again in a minute.",
      retry_after_seconds: retryAfter,
    });
    return;
  }
  inFlight++;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    inFlight--;
  };
  res.on("finish", finish);
  res.on("close", finish);
  next();
}

/** Test helper. */
export function _resetContentWritePauseForTests(): void {
  pausedUntil = 0;
  inFlight = 0;
}
