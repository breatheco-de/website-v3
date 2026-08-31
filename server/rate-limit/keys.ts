import type { Request } from "express";
import { createHash } from "crypto";
import { extractToken } from "../routes/_helpers.js";

function mcpServerSecret(): string {
  return process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY || "";
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

function bearerToken(req: Request): string {
  const authHeader = req.headers.authorization || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
}

function isMcpLoopback(req: Request): boolean {
  const secret = mcpServerSecret();
  if (!secret) return false;
  return bearerToken(req) === secret;
}

/**
 * Identity bucket for per-user rate limits.
 * Order: x-mcp-author → MCP anonymous → staff token → IP.
 */
export function rateLimitIdentityKey(req: Request): string {
  const mcpAuthor = req.headers["x-mcp-author"];
  if (typeof mcpAuthor === "string" && mcpAuthor.trim()) {
    return `user:${mcpAuthor.trim()}`;
  }

  if (isMcpLoopback(req)) {
    return "mcp:anonymous";
  }

  const token = extractToken(req);
  if (token) {
    return `token:${hashToken(token)}`;
  }

  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  return `ip:${ip}`;
}

export function bucketKey(
  policyId: string,
  scope: "identity" | "global",
  identityKey: string,
  windowMs: number,
  nowMs = Date.now(),
): string {
  const windowStart = Math.floor(nowMs / windowMs) * windowMs;
  const subject = scope === "global" ? "global" : identityKey;
  return `${policyId}:${scope}:${subject}:${windowStart}`;
}

export function windowRetryAfterSec(windowMs: number, nowMs = Date.now()): number {
  const windowStart = Math.floor(nowMs / windowMs) * windowMs;
  const windowEnd = windowStart + windowMs;
  return Math.max(1, Math.ceil((windowEnd - nowMs) / 1000));
}
