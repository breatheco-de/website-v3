import type { Request, Response } from "express";
import crypto from "crypto";

/** v2: assignments carry `run`; the v1 cookie (`4g_versioning`) is ignored so everyone is re-split once. */
export const VERSIONING_COOKIE_NAME = "4g_versioning_v2";
/** First test seen this visit (`experiment_id|variant`), 30-minute rolling, set by the client. */
export const VISIT_EXPERIMENT_COOKIE_NAME = "4g_visit_exp";
const USER_COOKIE_NAME = "4g_user_id";
const LEGACY_USER_COOKIE_NAME = "4g_visitor_id";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const USER_MAX_AGE = 180 * 24 * 60 * 60 * 1000;

export interface VersioningAssignment {
  contentType: string;
  slug: string;
  locale: string;
  /** Variant slug or `"default"`. */
  variantSlug: string;
  /** Test run (`started_at`) the assignment belongs to; null for legacy configs. */
  run?: string | null;
  assignedAt: number;
}

export interface VersioningCookie {
  userId: string;
  assignments: VersioningAssignment[];
}

function generateUserId(): string {
  return crypto.randomUUID();
}

export function hashUserId(userId: string): string {
  return crypto.createHash("sha256").update(userId).digest("hex").substring(0, 16);
}

/**
 * Parent Domain for sibling subdomain sharing (`learn.4geeks.com` → `.4geeks.com`).
 * Omit for localhost / IPs / single-label hosts.
 */
export function getParentCookieDomain(hostname: string): string | undefined {
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) ||
    hostname.includes(":")
  ) {
    return undefined;
  }
  const parts = hostname.split(".").filter(Boolean);
  if (parts.length < 2) return undefined;
  return `.${parts.slice(-2).join(".")}`;
}

export function readUserId(req: Request, res: Response): string {
  // Read new cookie first, fall back to legacy cookie for backward compatibility
  const existing = req.cookies?.[USER_COOKIE_NAME] || req.cookies?.[LEGACY_USER_COOKIE_NAME];

  const userId = existing || generateUserId();

  // Always rewrite the cookie with httpOnly: false so that client-side JS
  // can read and own the identity. This also migrates legacy HttpOnly cookies
  // (created by the old server-only flow) to client-readable ones without
  // changing the user's identity, and refreshes the max-age window.
  const domain = getParentCookieDomain(req.hostname);
  res.cookie(USER_COOKIE_NAME, userId, {
    maxAge: USER_MAX_AGE,
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    ...(domain ? { domain } : {}),
  });

  return userId;
}

export function getVersioningCookie(req: Request): VersioningCookie | null {
  try {
    const cookieValue = req.cookies?.[VERSIONING_COOKIE_NAME];
    if (!cookieValue) return null;
    const decoded = Buffer.from(cookieValue, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded);
    if (!parsed.userId && !parsed.visitorId && !parsed.sessionId) return null;
    // Support legacy visitorId and sessionId fields for backwards compatibility
    const userId = parsed.userId || parsed.visitorId || parsed.sessionId;
    return { userId, assignments: Array.isArray(parsed.assignments) ? parsed.assignments : [] } as VersioningCookie;
  } catch {
    return null;
  }
}

export function setVersioningCookie(
  res: Response,
  userId: string,
  assignments: VersioningAssignment[]
): void {
  const cookie: VersioningCookie = { userId, assignments };
  const encoded = Buffer.from(JSON.stringify(cookie)).toString("base64");
  res.cookie(VERSIONING_COOKIE_NAME, encoded, {
    maxAge: COOKIE_MAX_AGE,
    httpOnly: true,
    sameSite: "lax",
  });
}

/** Parse `4g_visit_exp` (`experiment_id|variant`). */
export function getVisitExperimentCookie(req: Request): { experiment_id: string; variant: string } | null {
  const raw = req.cookies?.[VISIT_EXPERIMENT_COOKIE_NAME];
  if (typeof raw !== "string" || !raw) return null;
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  const sep = value.lastIndexOf("|");
  if (sep <= 0 || sep === value.length - 1) return null;
  return { experiment_id: value.slice(0, sep).slice(0, 300), variant: value.slice(sep + 1).slice(0, 100) };
}

export function buildUserContext(req: Request, userId: string): {
  session_id: string;
  language: string;
} {
  const language = (req.query.locale as string) || (req.query.lang as string) || "en";
  return { session_id: userId, language };
}
