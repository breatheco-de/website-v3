/**
 * `gtm_payload` on links leaving the checkout path. The context is remembered for the browser
 * tab so it survives hops on this site (program page -> /payment-component -> checkout).
 *
 * - Decision page: keeps the memory when its products cover the remembered ones, else replaces it.
 * - Awareness / consideration / post-enrollment page: clears it.
 * - Page with no stage: keeps it, and its outbound links use it.
 * - `gtm_payload` arriving in the page URL is remembered too (legacy full ids -> codes).
 * - Nothing is sent while the page has no tracking context (switch off, staff edit mode).
 */

import {
  GTM_PAYLOAD_PARAM,
  gtmPayloadToCodes,
  hasGtmPayloadPassAlongToken,
  hostMatchesSkipList,
  mergeGtmPayload,
  parseGtmPayload,
  productsCover,
  serializeGtmPayload,
  type GtmPayloadFields,
  type ParsedGtmPayload,
} from "@shared/gtm-payload";
import type { PageTrackingContext } from "@shared/tracking-context";
import {
  getPageTrackingContext,
  getVisitExperiment,
  hasPageTrackingContext,
  isStaffSession,
  subscribePageContext,
} from "@/lib/tracking";
import {
  ensureEcommerceProductLookup,
  getCachedGtmPayloadSkipDomains,
  getCachedTrackingKeys,
} from "@/lib/ecommerceProductMap";

export const GTM_PAYLOAD_STORAGE_KEY = "4g_gtm_payload";
export const GTM_PAYLOAD_TTL_MS = 30 * 60 * 1000;

const CONTEXT_KEYS = ["product", "persona", "product_persona", "funnel_stage", "content_key"] as const;

type Memory = { fields: GtmPayloadFields; set_at: number; content_key?: string };

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function readGtmPayloadMemory(now = Date.now()): Memory | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(GTM_PAYLOAD_STORAGE_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as Memory;
    if (!m || typeof m.set_at !== "number" || !m.fields || typeof m.fields !== "object") return null;
    if (now - m.set_at > GTM_PAYLOAD_TTL_MS) {
      s.removeItem(GTM_PAYLOAD_STORAGE_KEY);
      return null;
    }
    return m;
  } catch {
    return null;
  }
}

function writeMemory(m: Memory): void {
  try {
    storage()?.setItem(GTM_PAYLOAD_STORAGE_KEY, JSON.stringify(m));
  } catch {
    /* storage full or blocked */
  }
}

export function clearGtmPayloadMemory(): void {
  try {
    storage()?.removeItem(GTM_PAYLOAD_STORAGE_KEY);
  } catch {
    /* blocked */
  }
}

function contextFields(ctx: PageTrackingContext): GtmPayloadFields {
  const out: GtmPayloadFields = {};
  for (const key of CONTEXT_KEYS) {
    const value = ctx[key];
    if (typeof value === "string" && value) out[key] = value;
  }
  return out;
}

const needsKeys = (p: ParsedGtmPayload) => p.kind === "legacy_list" || p.kind === "legacy_ids";

function incomingPayload(): ParsedGtmPayload | null {
  if (typeof window === "undefined") return null;
  return parseGtmPayload(new URLSearchParams(window.location.search).get(GTM_PAYLOAD_PARAM));
}

function isCheckoutStage(stage: string | undefined): boolean {
  return !stage || stage === "decision";
}

/** Update the tab memory for the page that just set its context. */
export function applyPageContextToMemory(
  ctx: PageTrackingContext,
  incoming: ParsedGtmPayload | null,
  keys: Parameters<typeof gtmPayloadToCodes>[1],
  now = Date.now(),
): void {
  const stage = ctx.funnel_stage;
  if (!isCheckoutStage(stage)) {
    clearGtmPayloadMemory();
    return;
  }
  if (incoming) {
    const fields = gtmPayloadToCodes(incoming, keys);
    if (fields.product) writeMemory({ fields, set_at: now, content_key: String(fields.content_key ?? "") });
  }
  if (stage !== "decision") return;
  const own = contextFields(ctx);
  const memory = readGtmPayloadMemory(now);
  if (memory && productsCover(ctx.product, String(memory.fields.product ?? ""))) {
    writeMemory({ ...memory, set_at: now });
    return;
  }
  writeMemory({ fields: own, set_at: now, content_key: ctx.content_key });
}

let lastApplied = "";

function onContextChange(pathname: string): void {
  if (typeof window === "undefined" || !window.location || pathname !== window.location.pathname) return;
  if (!hasPageTrackingContext()) return;
  const ctx = getPageTrackingContext();
  const signature = `${pathname}${window.location.search}|${ctx.content_key ?? ""}|${ctx.funnel_stage ?? ""}`;
  if (signature === lastApplied) return;
  lastApplied = signature;
  const incoming = isCheckoutStage(ctx.funnel_stage) ? incomingPayload() : null;
  if (isCheckoutStage(ctx.funnel_stage)) void ensureEcommerceProductLookup();
  const cached = getCachedTrackingKeys();
  if (incoming && needsKeys(incoming) && !cached) {
    void ensureEcommerceProductLookup().then(() => {
      if (window.location.pathname !== pathname) return;
      applyPageContextToMemory(ctx, incoming, getCachedTrackingKeys()?.keys);
    });
    return;
  }
  applyPageContextToMemory(ctx, incoming, cached?.keys);
}

if (typeof window !== "undefined" && window.location) {
  subscribePageContext(onContextChange);
  onContextChange(window.location.pathname);
}

/** Payload for an outbound click from the page on screen, or null when none applies. */
export function buildGtmPayloadForClick(now = Date.now()): GtmPayloadFields | null {
  if (!hasPageTrackingContext()) return null;
  if (!isCheckoutStage(getPageTrackingContext().funnel_stage)) return null;
  const memory = readGtmPayloadMemory(now);
  if (!memory) return null;
  const fields: GtmPayloadFields = { ...memory.fields };
  const visit = getVisitExperiment();
  if (visit) {
    fields.experiment_id = visit.experiment_id;
    fields.variant = visit.variant;
  }
  fields.ts = now;
  if (isStaffSession()) fields.is_staff = true;
  return fields;
}

function splitHref(href: string): { base: string; query: string; hash: string } {
  const hashIdx = href.indexOf("#");
  const hash = hashIdx === -1 ? "" : href.slice(hashIdx);
  const beforeHash = hashIdx === -1 ? href : href.slice(0, hashIdx);
  const qIdx = beforeHash.indexOf("?");
  return {
    base: qIdx === -1 ? beforeHash : beforeHash.slice(0, qIdx),
    query: qIdx === -1 ? "" : beforeHash.slice(qIdx + 1),
    hash,
  };
}

/** Set `gtm_payload` on `href`, merging with a value already there (other params untouched). */
export function setGtmPayloadParam(
  href: string,
  auto: GtmPayloadFields,
  opts: { passAlong?: boolean } = {},
): string {
  const { base, query, hash } = splitHref(href);
  const pairs = query.split("&").filter(Boolean);
  const isPayloadPair = (p: string) => p.split("=")[0] === GTM_PAYLOAD_PARAM;
  const existingRaw = new URLSearchParams(pairs.filter(isPayloadPair).join("&")).get(GTM_PAYLOAD_PARAM);
  const existing = opts.passAlong ? null : parseGtmPayload(existingRaw);
  const value = serializeGtmPayload(mergeGtmPayload(auto, existing));
  const kept = pairs.filter((p) => !isPayloadPair(p));
  kept.push(`${GTM_PAYLOAD_PARAM}=${encodeURIComponent(value)}`);
  return `${base}?${kept.join("&")}${hash}`;
}

function skipped(hostname: string): boolean {
  const skip = getCachedGtmPayloadSkipDomains();
  return skip === null || hostMatchesSkipList(hostname, skip);
}

/**
 * Outbound `http(s)` link to another host on the checkout path: add / merge `gtm_payload`.
 * `rawHref` is the authored href (before `{qs:}` tokens resolve), used to spot pass-along links.
 */
export function withGtmPayload(rawHref: string, href: string): string {
  if (typeof window === "undefined" || !/^https?:\/\//i.test(href)) return href;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }
  if (url.host === window.location.host) return href;
  if (skipped(url.hostname)) return href;
  const auto = buildGtmPayloadForClick();
  if (!auto) return href;
  return setGtmPayloadParam(href, auto, { passAlong: hasGtmPayloadPassAlongToken(rawHref) });
}

/** Internal paths on the current page that the server redirects to another host. */
let externalRedirects: { pathname: string; map: Record<string, string> } | null = null;

export function setPageExternalRedirects(map: unknown, pathname: string): void {
  if (!map || typeof map !== "object" || Array.isArray(map)) {
    externalRedirects = null;
    return;
  }
  const clean: Record<string, string> = {};
  for (const [path, host] of Object.entries(map as Record<string, unknown>)) {
    if (typeof host === "string" && path.startsWith("/")) clean[path] = host;
  }
  externalRedirects = { pathname, map: clean };
}

function normalizePath(path: string): string {
  const p = path.split("?")[0]!.split("#")[0]!;
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
}

/** Target host when this internal href redirects off-site (current page only), else null. */
export function getExternalRedirectHost(href: string): string | null {
  if (!externalRedirects || typeof window === "undefined") return null;
  if (externalRedirects.pathname !== window.location.pathname) return null;
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  const path = normalizePath(href);
  const host = externalRedirects.map[path] ?? externalRedirects.map[path.toLowerCase()] ?? null;
  return host && host !== window.location.host ? host : null;
}

/** Internal href that redirects off-site: add `gtm_payload` so the server 301 carries it. */
export function withRedirectGtmPayload(href: string): string {
  const host = getExternalRedirectHost(href);
  if (!host || skipped(host)) return href;
  const auto = buildGtmPayloadForClick();
  return auto ? setGtmPayloadParam(href, auto) : href;
}
