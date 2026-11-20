/**
 * Resolves effective form defaults by merging conversion event defaults into the form section.
 * Form-level YML values always take precedence; missing fields fall back to event defaults.
 *
 * This merge happens at read/resolve time — no YML files are modified.
 */

import { joinFormSettingsPath } from "./joinFormSettingsPath";

export interface ConsentDefaults {
  marketing?: boolean;
  sms?: boolean;
  whatsapp?: boolean;
  sms_usa_only?: boolean;
  sms_countries?: string[];
  sms_countries_mode?: "include" | "exclude";
  whatsapp_countries?: string[];
  whatsapp_countries_mode?: "include" | "exclude";
  marketing_text?: string;
  sms_text?: string;
  show_terms?: boolean;
  terms_url?: string;
  privacy_url?: string;
  [key: string]: boolean | string | string[] | undefined;
}

export interface ConversionEventDefaults {
  name: string;
  automations?: string;
  tags?: string[];
  consent?: ConsentDefaults;
  webhook?: {
    url: string;
    method?: "POST" | "GET";
    headers?: Record<string, string>;
    fail_silently?: boolean;
  };
  success?: {
    message?: string;
    url?: string;
  };
}

/**
 * Deep-merges conversion event defaults into a form section's settings.
 * The `formSettingsPath` indicates the path within the section where form
 * settings live (e.g. "form" or "settings.form"). For fields under
 * `formSettingsPath.consent.*`, form-level values win; event defaults fill gaps.
 *
 * For automations and tags: form-level value wins if set; event default is the fallback.
 *
 * Returns a new section object (shallow copy at top level).
 */
export function resolveFormDefaults(
  formSection: Record<string, unknown>,
  conversionEvent: ConversionEventDefaults | null | undefined,
  formSettingsPath: string = "form"
): Record<string, unknown> {
  if (!conversionEvent) return formSection;

  const get = (obj: Record<string, unknown>, path: string): unknown => {
    const keys = path.split(".");
    let cur: unknown = obj;
    for (const key of keys) {
      if (cur == null || typeof cur !== "object") return undefined;
      cur = (cur as Record<string, unknown>)[key];
    }
    return cur;
  };

  const set = (
    obj: Record<string, unknown>,
    path: string,
    value: unknown
  ): Record<string, unknown> => {
    const keys = path.split(".");
    const result = { ...obj };
    let cur: Record<string, unknown> = result;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      cur[key] = cur[key] != null && typeof cur[key] === "object"
        ? { ...(cur[key] as Record<string, unknown>) }
        : {};
      cur = cur[key] as Record<string, unknown>;
    }
    cur[keys[keys.length - 1]] = value;
    return result;
  };

  let result = { ...formSection };
  const fp = (relative: string) => joinFormSettingsPath(formSettingsPath, relative);

  if (conversionEvent.automations !== undefined) {
    const existing = get(result, fp("automations"));
    if (existing === undefined || existing === null || existing === "") {
      result = set(result, fp("automations"), conversionEvent.automations);
    }
  }

  if (conversionEvent.tags !== undefined && conversionEvent.tags.length > 0) {
    const existing = get(result, fp("tags"));
    const hasFormTags =
      (Array.isArray(existing) && existing.length > 0) ||
      (typeof existing === "string" && existing.trim() !== "");
    if (!hasFormTags) {
      result = set(result, fp("tags"), conversionEvent.tags);
    }
  }

  if (conversionEvent.webhook?.url) {
    const existingUrl = get(result, fp("webhook.url"));
    if (!existingUrl) {
      result = set(result, fp("webhook"), conversionEvent.webhook);
    }
  }

  if (conversionEvent.success) {
    const existingUrl = get(result, fp("success.url"));
    const existingMessage = get(result, fp("success.message"));
    const hasFormSuccess =
      (typeof existingUrl === "string" && existingUrl.trim() !== "") ||
      (typeof existingMessage === "string" && existingMessage.trim() !== "");
    if (!hasFormSuccess) {
      const success: { message?: string; url?: string } = {};
      if (conversionEvent.success.url?.trim()) success.url = conversionEvent.success.url.trim();
      if (conversionEvent.success.message?.trim()) success.message = conversionEvent.success.message.trim();
      if (success.url || success.message) {
        result = set(result, fp("success"), success);
      }
    }
  }

  if (conversionEvent.consent) {
    const consentDefaults = conversionEvent.consent;
    const topLevelConsentKeys = new Set(["show_terms", "terms_url", "privacy_url"]);
    /** Empty country lists on the form inherit the event (do not wipe limits). */
    const emptyInheritsEvent = new Set([
      "sms_countries",
      "whatsapp_countries",
    ]);
    for (const [field, value] of Object.entries(consentDefaults)) {
      if (value === undefined || topLevelConsentKeys.has(field)) continue;
      const existing = get(result, fp(`consent.${field}`));
      const treatAsUnset =
        existing === undefined ||
        existing === null ||
        (emptyInheritsEvent.has(field) && Array.isArray(existing) && existing.length === 0);
      if (treatAsUnset) {
        result = set(result, fp(`consent.${field}`), value);
      }
    }
    if (consentDefaults.show_terms !== undefined) {
      const existing = get(result, fp("show_terms"));
      if (existing === undefined || existing === null) {
        result = set(result, fp("show_terms"), consentDefaults.show_terms);
      }
    }
    if (consentDefaults.terms_url) {
      const existing = get(result, fp("terms_url"));
      if (!existing) {
        result = set(result, fp("terms_url"), consentDefaults.terms_url);
      }
    }
    if (consentDefaults.privacy_url) {
      const existing = get(result, fp("privacy_url"));
      if (!existing) {
        result = set(result, fp("privacy_url"), consentDefaults.privacy_url);
      }
    }
  }

  return result;
}
