/**
 * Server-side ad context cookie (`4g_ads`): HttpOnly, 30 days, parent domain.
 * Holds the latest campaign set, click ids, fbp/fbc, first-touch set and
 * first/last paid landing. Written only after tracking consent; read by /api/leads/webhook-delivery.
 * No name / email / phone ever.
 */

import type { Request, Response } from "express";
import {
  AD_CONTEXT_COOKIE_NAME,
  AD_CONTEXT_MAX_AGE_DAYS,
  CONSENT_COOKIE_NAME,
  isGrantedDecision,
  parseConsentCookie,
} from "@shared/consent";
import { MARKETING_UTM_KEYS, type PaidLandingRef, type UTMParams } from "@shared/session";
import { adIdFromTag, normalizeLandingPath, PAID_LOOKBACK_DAYS } from "@shared/paid-traffic";
import { getParentCookieDomain } from "../versioning/cookie-utils";

const VALUE_MAX = 200;
const COOKIE_MAX_BYTES = 3500;

export type AdContext = {
  v: 1;
  utm: UTMParams;
  first_touch?: UTMParams;
  first_paid?: PaidLandingRef;
  last_paid?: PaidLandingRef;
  updated_at: number;
};

function cleanUtm(raw: unknown): UTMParams {
  const out: UTMParams = {};
  if (!raw || typeof raw !== "object") return out;
  const rec = raw as Record<string, unknown>;
  for (const key of MARKETING_UTM_KEYS) {
    const v = rec[key];
    if (typeof v === "string" && v.trim()) (out as Record<string, string>)[key] = v.trim().slice(0, VALUE_MAX);
  }
  return out;
}

function cleanLanding(raw: unknown, now: number): PaidLandingRef | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const host = typeof r.host === "string" ? r.host.trim().toLowerCase().slice(0, 120) : "";
  const path = typeof r.path === "string" ? normalizeLandingPath(r.path).slice(0, 300) : "";
  const at = typeof r.at === "number" && Number.isFinite(r.at) ? r.at : NaN;
  if (!host || !path || !Number.isFinite(at)) return undefined;
  if (at > now + 3_600_000 || at < now - PAID_LOOKBACK_DAYS * 86_400_000) return undefined;
  const platform = typeof r.platform === "string" ? r.platform.slice(0, 20) : null;
  const out: PaidLandingRef = { host, path, at, platform };
  for (const k of ["campaign_id", "adset_id", "ad_id"] as const) {
    const id = typeof r[k] === "string" ? adIdFromTag(r[k] as string) : null;
    if (id) out[k] = id;
  }
  return out;
}

export function parseAdContextCookie(raw: string | undefined | null): AdContext | null {
  if (!raw) return null;
  try {
    const json = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<AdContext>;
    if (json?.v !== 1 || typeof json.utm !== "object") return null;
    return {
      v: 1,
      utm: cleanUtm(json.utm),
      first_touch: json.first_touch ? cleanUtm(json.first_touch) : undefined,
      first_paid: json.first_paid,
      last_paid: json.last_paid,
      updated_at: typeof json.updated_at === "number" ? json.updated_at : 0,
    };
  } catch {
    return null;
  }
}

export function readAdContext(req: Request): AdContext | null {
  return parseAdContextCookie(req.cookies?.[AD_CONTEXT_COOKIE_NAME]);
}

export function hasTrackingConsentCookie(req: Request): boolean {
  const parsed = parseConsentCookie(req.cookies?.[CONSENT_COOKIE_NAME]);
  return !!parsed && isGrantedDecision(parsed.decision);
}

/** Merge a client update into the stored context (first-* write-once, last-* newest wins). */
export function mergeAdContext(
  existing: AdContext | null,
  body: { utm?: unknown; first_touch?: unknown; paid_landing?: unknown },
  now: number = Date.now(),
): AdContext {
  const incomingUtm = cleanUtm(body.utm);
  const pl = (body.paid_landing ?? {}) as { first?: unknown; last?: unknown };
  const inFirst = cleanLanding(pl.first, now);
  const inLast = cleanLanding(pl.last, now);
  const prevLast = existing?.last_paid;
  const last = inLast && (!prevLast || inLast.at >= prevLast.at) ? inLast : prevLast;
  const firstTouch =
    existing?.first_touch && Object.keys(existing.first_touch).length > 0
      ? existing.first_touch
      : body.first_touch
        ? cleanUtm(body.first_touch)
        : undefined;
  return {
    v: 1,
    utm: Object.keys(incomingUtm).length > 0 ? incomingUtm : existing?.utm ?? {},
    first_touch: firstTouch,
    first_paid: existing?.first_paid ?? inFirst ?? inLast,
    last_paid: last,
    updated_at: now,
  };
}

export function serializeAdContext(ctx: AdContext): string | null {
  let value = Buffer.from(JSON.stringify(ctx), "utf8").toString("base64url");
  if (value.length <= COOKIE_MAX_BYTES) return value;
  const slim: AdContext = { ...ctx, first_touch: undefined };
  value = Buffer.from(JSON.stringify(slim), "utf8").toString("base64url");
  return value.length <= COOKIE_MAX_BYTES ? value : null;
}

function cookieOptions(req: Request) {
  const domain = getParentCookieDomain(req.hostname);
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(domain ? { domain } : {}),
  };
}

export function writeAdContext(req: Request, res: Response, ctx: AdContext): boolean {
  const value = serializeAdContext(ctx);
  if (!value) return false;
  res.cookie(AD_CONTEXT_COOKIE_NAME, value, {
    ...cookieOptions(req),
    maxAge: AD_CONTEXT_MAX_AGE_DAYS * 86_400_000,
  });
  return true;
}

export function clearAdContext(req: Request, res: Response): void {
  res.clearCookie(AD_CONTEXT_COOKIE_NAME, cookieOptions(req));
}
