/**
 * Centralized tracking module for analytics and conversion events.
 * Abstracts GTM/dataLayer and provides type-safe event tracking.
 */

import { getUserIdFromCookie } from "./sessionBootstrap";
import { useQuery } from "@tanstack/react-query";

export type ConversionName = string;

// General tracking events (non-conversion)
export const TRACKING_EVENTS = [
  "page_view",
  "experiment_exposure",
  "cta_click",
  "video_play",
  "scroll_depth",
] as const;

export type TrackingEventName = typeof TRACKING_EVENTS[number];

/** Ecommerce funnel events (client dataLayer + off-site catalog). */
export const ECOMMERCE_EVENTS = [
  "view_item",
  "add_to_cart",
  "view_item_list",
  "select_item",
  "click_begin_checkout",
  "begin_checkout",
  "purchase",
] as const;

export type EcommerceEventName = (typeof ECOMMERCE_EVENTS)[number];

/** Events fired from this site (begin_checkout + purchase are off-site / learn POS). */
export const ECOMMERCE_EVENTS_WIRED = [
  "view_item",
  "add_to_cart",
  "view_item_list",
  "select_item",
  "click_begin_checkout",
] as const;

export type EcommerceWiredEventName = (typeof ECOMMERCE_EVENTS_WIRED)[number];

// All valid event names
export type EventName = ConversionName | TrackingEventName | EcommerceEventName;

export interface EcommercePayload {
  item_id?: string;
  item_name?: string;
  item_category?: string;
  program_id?: string;
  plan_id?: string;
  /** Enrollment selector plans[].id (e.g. basic / pro) — not learn.4geeks billing plan */
  selected_plan_option?: string;
  /** Selected cohort start date ISO (enrollment date mode) */
  cohort_date?: string;
  /** Enrollment addon.id when enabled */
  addon_id?: string;
  /** Plan-mode display amount string (e.g. "129"), or date-mode summary.price_amount */
  amount?: string;
  /** Plan-mode period display string (e.g. "/month") — aligns with learn.4geeks period_label */
  period_label?: string;
  item_list_name?: string;
  path?: string;
  component_type?: string;
  component_variant?: string;
  currency?: string;
  [key: string]: string | number | boolean | undefined | object;
}

export type ProductLookup = (programId: string) =>
  | { product_id: string; name?: string; active?: boolean; content_type?: string }
  | undefined;

let productLookup: ProductLookup | null = null;

/** Register product resolver used by trackEcommerce purchasable gate. */
export function setEcommerceProductLookup(fn: ProductLookup | null): void {
  productLookup = fn;
}

export function getEcommerceProductLookup(): ProductLookup | null {
  return productLookup;
}

/**
 * Resolve a program/content slug to an active purchasable product.
 */
export function resolveEcommerceProduct(
  programId: string | undefined | null,
): { product_id: string; name?: string; content_type?: string } | null {
  if (!programId || !productLookup) return null;
  const p = productLookup(programId);
  if (!p || p.active === false) return null;
  return { product_id: p.product_id, name: p.name, content_type: p.content_type };
}

/**
 * Track an ecommerce funnel event. No-ops unless a purchasable product resolves
 * (via program_id / item_id + registered product lookup).
 */
export function trackEcommerce(
  eventName: EcommerceWiredEventName,
  payload: EcommercePayload = {},
): void {
  const programId =
    (typeof payload.program_id === "string" && payload.program_id) || undefined;

  let itemId = typeof payload.item_id === "string" ? payload.item_id : undefined;
  let itemName = typeof payload.item_name === "string" ? payload.item_name : undefined;
  let itemCategory =
    typeof payload.item_category === "string" ? payload.item_category : undefined;

  if (productLookup) {
    const product =
      (programId ? resolveEcommerceProduct(programId) : null) ||
      (itemId ? resolveEcommerceProduct(itemId) : null);
    if (!product) {
      console.log(`[Tracking] Ecommerce skipped (no purchasable product): ${eventName}`, payload);
      return;
    }
    itemId = product.product_id;
    itemName = itemName || product.name;
    itemCategory = itemCategory || product.content_type || "program";
  } else if (!itemId && !programId) {
    console.log(`[Tracking] Ecommerce skipped (no product lookup / ids): ${eventName}`, payload);
    return;
  }

  pushToDataLayer({
    event: eventName,
    user_id: getUserIdFromCookie() ?? undefined,
    ...payload,
    item_id: itemId,
    item_name: itemName,
    item_category: itemCategory,
    program_id: programId || payload.program_id,
  });

  console.log(`[Tracking] Ecommerce: ${eventName}`, { ...payload, item_id: itemId });
}

// Payload types for different events
export interface ConversionPayload {
  /** Plaintext email for GTM DLVs / ESP tags */
  email?: string;
  /** SHA-256 truncated hash — kept for older GTM variables named email_hash */
  email_hash?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  formentry_id?: string | number;
  attribution_id?: string;
  referral_key?: string;
  program?: string;
  /** Ecommerce product_id — dual-written when conversion product resolve succeeds */
  item_id?: string;
  /** Content slug for analytics — dual-written with item_id */
  program_id?: string;
  plan?: string;
  location?: string;
  region?: string;
  coupon?: string;
  client_comments?: string;
  current_download?: string;
  consent_email?: boolean;
  consent_sms?: boolean;
  consent_whatsapp?: boolean;
  consent_general?: boolean;
  [key: string]: string | number | boolean | undefined;
}

export interface TrackingPayload {
  [key: string]: string | number | boolean | undefined | object;
}

// User context for session-level data
export interface VisitorContext {
  user_id?: string;
  location_city?: string;
  location_country?: string;
  location_slug?: string;
  language?: string;
  latitude?: number;
  longitude?: number;
  utm?: {
    utm_campaign?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_content?: string;
    utm_term?: string;
    gclid?: string;
    referral_code?: string;
  };
}

export interface WebhookConfig {
  url: string;
  method?: "POST" | "GET";
  auth_header?: string;
}

export interface ConsentDefaults {
  marketing?: boolean;
  sms?: boolean;
  whatsapp?: boolean;
  sms_usa_only?: boolean;
  marketing_text?: string;
  sms_text?: string;
  show_terms?: boolean;
  terms_url?: string;
  privacy_url?: string;
  [key: string]: boolean | string | undefined;
}

export interface SuccessDefaults {
  message?: string;
  url?: string;
}

export interface ConversionEventEntry {
  name: string;
  /** Short staff one-liner; agents primarily use when_to_use / when_not_to_use. */
  description?: string;
  /** Visitor proposition — when this conversion_name fits (required on save). */
  when_to_use?: string;
  /** Confusable neighbors — when not to use this name (required on save). */
  when_not_to_use?: string;
  automations?: string;
  tags?: string[];
  consent?: ConsentDefaults;
  webhook?: WebhookConfig;
  success?: SuccessDefaults;
}

export interface TrackingWebhook {
  url: string;
  method?: string;
  auth_header?: string;
}

export interface TrackingSettingsResponse {
  conversion_events: ConversionEventEntry[];
  webhook?: TrackingWebhook;
  has_env_webhook?: boolean;
}

// Extend Window to include dataLayer
declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
  }
}

/**
 * React hook that returns the list of configured conversion event names from the API.
 */
export function useConversionNames(): { names: string[]; isLoading: boolean } {
  const { data, isLoading } = useQuery<TrackingSettingsResponse>({
    queryKey: ["/api/settings/tracking"],
  });

  return {
    names: data?.conversion_events.map((e) => e.name) ?? [],
    isLoading,
  };
}

/**
 * Fetch conversion event names from the API (async, one-shot).
 */
export async function fetchConversionNames(): Promise<string[]> {
  try {
    const res = await fetch("/api/settings/tracking");
    if (!res.ok) return [];
    const data: TrackingSettingsResponse = await res.json();
    return data.conversion_events.map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Hash an email address for privacy (SHA-256 truncated)
 * Used to track conversions without exposing PII
 */
export async function hashEmail(email: string): Promise<string> {
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    // Fallback: simple hash for SSR or unsupported browsers
    return btoa(email.toLowerCase().trim()).substring(0, 16);
  }
  
  const encoder = new TextEncoder();
  const data = encoder.encode(email.toLowerCase().trim());
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  return hashHex.substring(0, 16);
}

/**
 * Push data to GTM dataLayer
 */
function pushToDataLayer(data: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  
  if (!window.dataLayer) {
    window.dataLayer = [];
  }
  
  window.dataLayer.push(data);
  
  console.log("[Tracking] dataLayer.push:", data);
}

/**
 * Validate that a conversion event name is in the provided list.
 * When no list is provided the check is skipped (permissive).
 */
export function isValidConversionName(name: string, conversionNames?: string[]): boolean {
  if (!conversionNames) return true;
  return conversionNames.includes(name);
}

export function isValidEventName(name: string): boolean {
  return (
    TRACKING_EVENTS.includes(name as TrackingEventName) ||
    ECOMMERCE_EVENTS.includes(name as EcommerceEventName)
  );
}

/**
 * Track a conversion event (form submissions, signups, etc.)
 */
export function trackConversion(
  eventName: ConversionName,
  payload: ConversionPayload = {}
): void {
  pushToDataLayer({
    event: eventName,
    user_id: getUserIdFromCookie() ?? undefined,
    ...payload,
  });

  console.log(`[Tracking] Conversion: ${eventName}`, payload);
}

/**
 * Track a general event (page views, clicks, etc.)
 */
export function track(
  eventName: EventName,
  payload: TrackingPayload = {}
): void {
  pushToDataLayer({
    event: eventName,
    user_id: getUserIdFromCookie() ?? undefined,
    ...payload,
  });

  console.log(`[Tracking] Event: ${eventName}`, payload);
}

/**
 * Set user context data in dataLayer (called once after session bootstrap)
 */
export function setVisitorContext(context: VisitorContext): void {
  pushToDataLayer({
    user_id: context.user_id,
    visitor_location_city: context.location_city,
    visitor_location_country: context.location_country,
    visitor_location_slug: context.location_slug,
    visitor_language: context.language,
    visitor_latitude: context.latitude,
    visitor_longitude: context.longitude,
    ...context.utm,
  });

  console.log("[Tracking] User context set:", context);
}

/**
 * Resolve the webhook to fire for a conversion using the three-level priority chain:
 *   1. formWebhook  — highest priority, set directly on the form component
 *   2. per-event    — tracking.conversion_events[name].webhook
 *   3. global       — tracking.webhook
 * Returns null when no webhook is configured at any level (silent no-op).
 */
export function resolveWebhook(
  formWebhook: WebhookConfig | undefined | null,
  conversionName: string,
  settings: TrackingSettingsResponse | null | undefined
): WebhookConfig | null {
  if (formWebhook?.url) return formWebhook;

  if (settings) {
    const eventEntry = settings.conversion_events.find((e) => e.name === conversionName);
    if (eventEntry?.webhook?.url) return eventEntry.webhook;
    if (settings.webhook?.url) return settings.webhook;
  }

  return null;
}

/**
 * Sample lead payload — mirrors the full payload shape built in LeadFormDefault.tsx.
 * Used as the single source of truth for the UI "Sample payload" display and
 * the webhook test button. Update this when the form payload shape changes.
 */
export const SAMPLE_LEAD_PAYLOAD: Record<string, unknown> = {
  email: "jane.doe@example.com",
  first_name: "Jane",
  last_name: "Doe",
  phone: "+13055550100",
  program: "ai-engineering",
  location: "miami-usa",
  region: "us",
  coupon: "",
  current_download: "",
  language: "en",
  browser_lang: "en-US",
  latitude: "25.7617",
  longitude: "-80.1918",
  city: "Miami",
  country: "US",
  utm_url: "https://example.com/en/apply?utm_source=google",
  utm_source: "google",
  utm_medium: "cpc",
  utm_campaign: "brand-2024",
  utm_content: "hero-cta",
  utm_term: "ai bootcamp",
  utm_placement: "",
  utm_plan: "",
  ppc_tracking_id: "",
  referral: "",
  referral_key: "",
  tags: "website-lead",
  automations: "strong",
  consent_email: true,
  sms_consent: false,
  consent_whatsapp: false,
  token: "<turnstile_token>",
};

/**
 * Builds a sample lead payload for the webhook test button and payload viewer.
 * Spreads SAMPLE_LEAD_PAYLOAD and merges in any caller-provided overrides so that
 * session-derived fields (UTM, geo, language) and section-specific YML values
 * (program, tags, automations, consent) replace the generic placeholders.
 */
export function buildSamplePayload(
  overrides?: Partial<Record<string, unknown>>
): Record<string, unknown> {
  return { ...SAMPLE_LEAD_PAYLOAD, ...overrides };
}

/** Form fields eligible for conversion dataLayer pushes (PII + lead context). */
export type FormSubmissionTrackingData = {
  email?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  program?: string;
  item_id?: string;
  program_id?: string;
  plan?: string;
  location?: string;
  region?: string;
  coupon?: string;
  client_comments?: string;
  current_download?: string;
  consent_email?: boolean;
  consent_sms?: boolean;
  consent_whatsapp?: boolean;
  consent_general?: boolean;
  formentry_id?: string | number;
  attribution_id?: string;
  referral_key?: string;
  [key: string]: string | number | boolean | undefined;
};

/**
 * Helper to track form submission — pushes conversion event + collected form fields.
 */
export async function trackFormSubmission(
  conversionName: ConversionName,
  formData: FormSubmissionTrackingData
): Promise<void> {
  const payload: ConversionPayload = {};

  const setString = (key: keyof ConversionPayload, value: string | undefined) => {
    if (typeof value === "string" && value.trim() !== "") {
      payload[key] = value;
    }
  };

  setString("first_name", formData.first_name);
  setString("last_name", formData.last_name);
  setString("phone", formData.phone);
  setString("program", formData.program);
  setString("item_id", formData.item_id);
  setString("program_id", formData.program_id);
  setString("plan", formData.plan);
  setString("location", formData.location);
  setString("region", formData.region);
  setString("coupon", formData.coupon);
  setString("client_comments", formData.client_comments);
  setString("current_download", formData.current_download);
  setString("attribution_id", formData.attribution_id);
  setString("referral_key", formData.referral_key);

  if (formData.formentry_id !== undefined && formData.formentry_id !== "") {
    payload.formentry_id = formData.formentry_id;
  }
  for (const [key, value] of Object.entries(formData)) {
    if (key.startsWith("consent_") && typeof value === "boolean") {
      payload[key] = value;
    }
  }

  // Plaintext email for GTM; hash kept under email_hash for legacy DLVs
  if (formData.email) {
    const normalized = formData.email.toLowerCase().trim();
    payload.email = normalized;
    payload.email_hash = await hashEmail(normalized);
  }

  trackConversion(conversionName, payload);
}
