/**
 * `gtm_payload`: the visitor's product / persona context on links that leave the checkout path
 * (learn.4geeks.com checkout, partner sites). Same param name the hand-written links already use.
 *
 * v1 value = JSON object with `v: 1`, short codes in `product` / `persona` / `product_persona`
 * (the keys the legacy object used), plus extras alongside. Older values arrive in two shapes:
 * a funnel list from `{{ funnel.products }}` (array of bindings or "all") and a three-key full-id
 * object from `{{ entry.funnel_products_encoded_ids }}`.
 */

import { normalizeFunnelBinding, type FunnelProductBinding } from "./funnel";
import { buildFunnelTrackingContext, parseTrackingList, type TrackingKeyLookup } from "./tracking-context";
import type { TrackingKeyIndex } from "./tracking-keys";

export const GTM_PAYLOAD_PARAM = "gtm_payload";
export const GTM_PAYLOAD_VERSION = 1;

/** Keys this site writes. Receivers forward any key that passes the caps below. */
export const GTM_PAYLOAD_KEYS = [
  "product",
  "persona",
  "product_persona",
  "funnel_stage",
  "content_key",
  "experiment_id",
  "variant",
  "ts",
  "is_staff",
] as const;

export const GTM_PAYLOAD_KEY_PATTERN = /^[a-z0-9_]{1,40}$/;
export const GTM_PAYLOAD_VALUE_MAX = 100;
export const GTM_PAYLOAD_MAX_KEYS = 16;
export const GTM_PAYLOAD_SKIP_DOMAINS_MAX = 50;

export type GtmPayloadValue = string | number | boolean;
export type GtmPayloadFields = Record<string, GtmPayloadValue>;

const LEGACY_ID_KEYS = ["product", "persona", "product_persona"] as const;

export type ParsedGtmPayload =
  /** Written by this site (or a reader that kept `v`). */
  | { kind: "v1"; fields: GtmPayloadFields }
  /** `{{ funnel.products }}`: the page funnel list as stored. */
  | { kind: "legacy_list"; bindings: FunnelProductBinding[] | "all" }
  /** `{{ entry.funnel_products_encoded_ids }}`: exactly the three keys, full ids. */
  | { kind: "legacy_ids"; fields: GtmPayloadFields }
  /** Anything else staff typed: explicit overrides, key by key. */
  | { kind: "custom"; fields: GtmPayloadFields };

/** Receiver caps: key pattern, 100-char values, scalar values only, at most 16 keys. */
export function sanitizeGtmPayloadFields(raw: Record<string, unknown>): GtmPayloadFields {
  const out: GtmPayloadFields = {};
  let count = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (count >= GTM_PAYLOAD_MAX_KEYS) break;
    if (!GTM_PAYLOAD_KEY_PATTERN.test(key)) continue;
    if (typeof value === "string") out[key] = value.slice(0, GTM_PAYLOAD_VALUE_MAX);
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "boolean") out[key] = value;
    else continue;
    count++;
  }
  return out;
}

function tryJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Read a `gtm_payload` value (already URL-decoded once). Null when empty or unreadable. */
export function parseGtmPayload(raw: string | null | undefined): ParsedGtmPayload | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  if (text === "all") return { kind: "legacy_list", bindings: "all" };
  let value = tryJson(text);
  if (value === undefined && /^%(7B|5B)/i.test(text)) {
    try {
      value = tryJson(decodeURIComponent(text));
    } catch {
      value = undefined;
    }
  }
  if (value === "all") return { kind: "legacy_list", bindings: "all" };
  if (Array.isArray(value)) {
    const bindings = value.map(normalizeFunnelBinding).filter((b): b is FunnelProductBinding => !!b);
    return { kind: "legacy_list", bindings };
  }
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const { v, ...rest } = obj;
  const fields = sanitizeGtmPayloadFields(rest);
  if (v === GTM_PAYLOAD_VERSION) return { kind: "v1", fields };
  const keys = Object.keys(fields);
  if (keys.length === LEGACY_ID_KEYS.length && LEGACY_ID_KEYS.every((k) => typeof fields[k] === "string")) {
    return { kind: "legacy_ids", fields };
  }
  return { kind: "custom", fields };
}

/** JSON for the URL (`URLSearchParams` encodes it). `v` first. */
export function serializeGtmPayload(fields: GtmPayloadFields): string {
  const { v: _v, ...rest } = fields;
  return JSON.stringify({ v: GTM_PAYLOAD_VERSION, ...sanitizeGtmPayloadFields(rest) });
}

/**
 * Value to send when the link already has a `gtm_payload`. Pass-along shapes (v1, legacy list,
 * legacy three-key ids) are replaced by `auto`; custom keys win over `auto` key by key.
 */
export function mergeGtmPayload(auto: GtmPayloadFields, existing: ParsedGtmPayload | null): GtmPayloadFields {
  if (!existing || existing.kind !== "custom") return { ...auto };
  return { ...auto, ...existing.fields };
}

const pick = (ctx: Record<string, unknown>): GtmPayloadFields => {
  const out: GtmPayloadFields = {};
  for (const key of LEGACY_ID_KEYS) {
    const value = ctx[key];
    if (typeof value === "string" && value) out[key] = value;
  }
  return out;
};

const ALL_FIELDS: GtmPayloadFields = { product: "all", persona: "all", product_persona: "all" };
const NONE_FIELDS: GtmPayloadFields = { product: "none", persona: "none", product_persona: "none" };

function bindingsFromIds(fields: GtmPayloadFields): FunnelProductBinding[] {
  const out: FunnelProductBinding[] = [];
  const seen = new Set<string>();
  const add = (product: string, persona?: string) => {
    const key = `${product}\0${persona ?? ""}`;
    if (!product || seen.has(key)) return;
    seen.add(key);
    out.push(persona ? { product, persona } : { product });
  };
  for (const pair of parseTrackingList(String(fields.product_persona ?? "")).values) {
    const at = pair.indexOf(":");
    if (at < 0) add(pair.trim());
    else add(pair.slice(0, at).trim(), pair.slice(at + 1).trim() || undefined);
  }
  for (const product of parseTrackingList(String(fields.product ?? "")).values) {
    if (!out.some((b) => b.product === product)) add(product);
  }
  return out;
}

/**
 * Product / persona keys as short codes for any parsed value. Legacy full ids are translated
 * with the site's tracking keys (unknown ids stay as written). Custom values return only the
 * keys they set.
 */
export function gtmPayloadToCodes(
  parsed: ParsedGtmPayload,
  index: TrackingKeyIndex | TrackingKeyLookup | null | undefined,
): GtmPayloadFields {
  if (parsed.kind === "v1" || parsed.kind === "custom") return { ...parsed.fields };
  if (parsed.kind === "legacy_list") {
    if (parsed.bindings === "all") return { ...ALL_FIELDS };
    if (parsed.bindings.length === 0) return { ...NONE_FIELDS };
    return pick(buildFunnelTrackingContext({ products: parsed.bindings }, { contentType: "", contentSlug: "" }, index));
  }
  const product = String(parsed.fields.product ?? "");
  if (product === "all") return { ...ALL_FIELDS };
  if (product === "none" || !product) return { ...NONE_FIELDS };
  const bindings = bindingsFromIds(parsed.fields);
  if (bindings.length === 0) return { ...NONE_FIELDS };
  return pick(buildFunnelTrackingContext({ products: bindings }, { contentType: "", contentSlug: "" }, index));
}

/**
 * Rule 6a: a decision page keeps the remembered context when its products cover every
 * remembered product (or are `all`); otherwise it replaces it.
 */
export function productsCover(current: string | undefined, remembered: string | undefined): boolean {
  const cur = parseTrackingList(current);
  const mem = parseTrackingList(remembered);
  if (cur.sentinel === "all") return true;
  if (mem.values.length === 0) return false;
  const set = new Set(cur.values);
  return mem.values.every((code) => set.has(code));
}

/** `example.com`, `https://pay.example.com/x` → host-like domain; null when not a domain. */
export function normalizeSkipDomain(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.split(/[/?#]/)[0] ?? "";
  s = s.replace(/^\*\./, "").replace(/:\d+$/, "").replace(/\.$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return null;
  return s;
}

export function normalizeSkipDomains(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const d = normalizeSkipDomain(item);
    if (d && !out.includes(d)) out.push(d);
    if (out.length >= GTM_PAYLOAD_SKIP_DOMAINS_MAX) break;
  }
  return out;
}

/** True when `host` is a listed domain or a subdomain of one. */
export function hostMatchesSkipList(host: string, domains: readonly string[]): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  return domains.some((d) => h === d || h.endsWith(`.${d}`));
}

/** A raw href that passes the incoming value along (`gtm_payload={qs:gtm_payload|…}`). */
export function hasGtmPayloadPassAlongToken(rawHref: string): boolean {
  return /[?&#]gtm_payload=\{qs:/i.test(rawHref) || /[?&#]gtm_payload=%7Bqs:/i.test(rawHref);
}
