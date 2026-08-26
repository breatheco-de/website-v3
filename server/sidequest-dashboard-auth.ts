/**
 * Short-lived HttpOnly cookie for staff-proxied Sidequest dashboard HTML navigations.
 * Does not store the Breathecode token — mint only after webmaster check.
 */

import * as crypto from "crypto";
import type { Request, Response } from "express";
import { SIDEQUEST_DASHBOARD_BASE_PATH } from "./jobs/queue";

export const SIDEQUEST_DASH_COOKIE_NAME = "sidequest_dash";

/** Cookie path must match the proxied UI so the browser sends it on /admin/sidequest/*. */
export const SIDEQUEST_DASH_COOKIE_PATH = SIDEQUEST_DASHBOARD_BASE_PATH;

const DEFAULT_TTL_SEC = 20 * 60; // 20 minutes (within 15–30 plan range)

function signingSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET required to sign sidequest dashboard cookies");
    }
    return "dev-sidequest-dash-cookie";
  }
  return secret;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", signingSecret()).update(payload).digest("hex");
}

export type SidequestDashCookiePayload = {
  exp: number;
  username?: string;
};

function encodeCookieValue(parts: SidequestDashCookiePayload): string {
  const username = parts.username?.trim() || "";
  const body = `${parts.exp}|${username}`;
  return `${body}|${sign(body)}`;
}

export function parseSidequestDashCookie(
  raw: string | undefined,
): SidequestDashCookiePayload | null {
  if (!raw || typeof raw !== "string") return null;
  const parts = raw.split("|");
  if (parts.length < 3) return null;
  const sig = parts[parts.length - 1];
  const username = parts.slice(1, -1).join("|"); // allow empty username
  const expStr = parts[0];
  const exp = Number(expStr);
  if (!Number.isFinite(exp)) return null;
  const body = `${expStr}|${username}`;
  const expected = sign(body);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(sig, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const now = Math.floor(Date.now() / 1000);
  if (exp < now) return null;
  return username ? { exp, username } : { exp };
}

function cookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: SIDEQUEST_DASH_COOKIE_PATH,
    maxAge: maxAgeMs,
  };
}

export function mintSidequestDashCookie(
  res: Response,
  opts?: { username?: string; ttlSec?: number },
): SidequestDashCookiePayload {
  const ttlSec = opts?.ttlSec ?? DEFAULT_TTL_SEC;
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload: SidequestDashCookiePayload = opts?.username
    ? { exp, username: opts.username }
    : { exp };
  res.cookie(SIDEQUEST_DASH_COOKIE_NAME, encodeCookieValue(payload), cookieOptions(ttlSec * 1000));
  return payload;
}

/** Slide the window forward on each authorized proxy hit. */
export function refreshSidequestDashCookie(
  res: Response,
  previous?: SidequestDashCookiePayload | null,
  ttlSec: number = DEFAULT_TTL_SEC,
): SidequestDashCookiePayload {
  return mintSidequestDashCookie(res, {
    username: previous?.username,
    ttlSec,
  });
}

export function verifySidequestDashCookie(
  req: Request,
): { ok: true; payload: SidequestDashCookiePayload } | { ok: false } {
  const raw = req.cookies?.[SIDEQUEST_DASH_COOKIE_NAME] as string | undefined;
  const payload = parseSidequestDashCookie(raw);
  if (!payload) return { ok: false };
  return { ok: true, payload };
}

export function clearSidequestDashCookie(res: Response): void {
  res.clearCookie(SIDEQUEST_DASH_COOKIE_NAME, {
    path: SIDEQUEST_DASH_COOKIE_PATH,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });
}
