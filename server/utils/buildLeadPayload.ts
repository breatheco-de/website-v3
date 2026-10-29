import { getTrackingSettings } from "../settings";

/** Form / lookup aliases — remapped or omitted; never copied as-is onto the wire. */
const LEAD_BODY_ALIASES = new Set([
  "conversion_name",
  "program", // → course
  "consent_whatsapp", // → consent
  "ref", // folded into referral
]);

function isWireScalar(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/**
 * Builds a lead payload for Breathecode /v2/marketing/lead from raw form input.
 * Known BC fields stay hardcoded (program → course, tags/automations fallbacks, ref → referral).
 * Any other scalar on the input is merged through (e.g. hidden event_id).
 */
export function buildLeadPayload(
  leadData: Record<string, unknown>,
): Record<string, unknown> {
  const conversionName =
    typeof leadData.conversion_name === "string" ? leadData.conversion_name : "";
  const matchingEvent = conversionName
    ? getTrackingSettings().conversion_events.find((e) => e.name === conversionName)
    : undefined;

  const tagsFromInput =
    typeof leadData.tags === "string"
      ? leadData.tags
      : Array.isArray(leadData.tags) && leadData.tags.length
        ? leadData.tags.filter((t): t is string => typeof t === "string").join(",")
        : null;

  const effectiveTags: string =
    tagsFromInput ||
    (matchingEvent?.tags?.length ? matchingEvent.tags.join(",") : null) ||
    "website-lead";

  const effectiveAutomations: string =
    (typeof leadData.automations === "string" && leadData.automations) ||
    matchingEvent?.automations ||
    "strong";

  const payload: Record<string, unknown> = {
    first_name: leadData.first_name || null,
    last_name: leadData.last_name || null,
    phone: leadData.phone || null,
    email: leadData.email,
    location: leadData.location || null,
    course: leadData.program || null,
    consent: leadData.consent_whatsapp || false,
    sms_consent: leadData.sms_consent || false,
    consent_email: leadData.consent_email || false,
    comment: leadData.comment || null,
    client_comments: leadData.client_comments || null,
    current_download: leadData.current_download || null,
    utm_url: leadData.utm_url || null,
    utm_source: leadData.utm_source || null,
    utm_medium: leadData.utm_medium || null,
    utm_campaign: leadData.utm_campaign || null,
    utm_content: leadData.utm_content || null,
    utm_term: leadData.utm_term || null,
    utm_placement: leadData.utm_placement || null,
    utm_plan: leadData.utm_plan || null,
    gclid: leadData.gclid || null,
    fbclid: leadData.fbclid || null,
    msclkid: leadData.msclkid || null,
    ttclid: leadData.ttclid || null,
    referral: leadData.referral || leadData.ref || null,
    referral_key: leadData.referral_key || null,
    coupon: leadData.coupon || null,
    latitude: leadData.latitude || null,
    longitude: leadData.longitude || null,
    city: leadData.city || null,
    country: leadData.country || null,
    language: leadData.language || "en",
    utm_language: leadData.language || "en",
    browser_lang: leadData.browser_lang || null,
    tags: effectiveTags,
    automations: effectiveAutomations,
    action: "submit",
    token: leadData.token || null,
  };

  const extraConsent: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(leadData)) {
    if (
      key.startsWith("consent_") &&
      key !== "consent_whatsapp" &&
      key !== "consent_email" &&
      typeof value === "boolean"
    ) {
      extraConsent[key] = value;
    }
  }

  const out: Record<string, unknown> = { ...payload, ...extraConsent };

  for (const [key, value] of Object.entries(leadData)) {
    if (LEAD_BODY_ALIASES.has(key)) continue;
    if (Object.prototype.hasOwnProperty.call(out, key)) continue;
    if (!isWireScalar(value)) continue;
    if (value === "") continue;
    out[key] = value;
  }

  return Object.fromEntries(
    Object.entries(out).filter(
      ([_, value]) => value !== null && value !== undefined && value !== "",
    ),
  );
}
