/**
 * Whether an optional consent channel (SMS / WhatsApp) should show, given a
 * country include/exclude list matched to the form-calculated location's
 * country_code. Legacy `sms_usa_only: true` → include [US].
 */

import { normalizeCountryCode } from "./consent";

export type ConsentCountriesMode = "include" | "exclude";

export type WithCountryCode = { country_code?: string | null } | null | undefined;

function knownCode(raw: unknown): string | null {
  const code = normalizeCountryCode(raw);
  return code && code !== "XX" ? code : null;
}

/**
 * Country for consent filters: form location first, then session when the form
 * has no location yet, then geo. Locations with `XX` (remote / rest-of-*) fall
 * through to geo (same order as legacy `isUsVisitor`).
 */
export function resolveConsentCountryCode(opts: {
  formLocation?: WithCountryCode;
  sessionLocation?: WithCountryCode;
  geo?: WithCountryCode;
}): string | null {
  const fromForm = knownCode(opts.formLocation?.country_code);
  if (fromForm) return fromForm;
  if (!opts.formLocation) {
    const detected = knownCode(opts.sessionLocation?.country_code);
    if (detected) return detected;
  }
  // Form location set but XX/unknown, or no session country → geo
  return knownCode(opts.geo?.country_code);
}

export function normalizeCountriesList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const el of raw) {
    const code = normalizeCountryCode(el);
    if (code && code !== "XX" && !out.includes(code)) out.push(code);
  }
  return out;
}

export function normalizeCountriesMode(raw: unknown): ConsentCountriesMode {
  return raw === "exclude" ? "exclude" : "include";
}

/**
 * Effective SMS country filter from a consent block, including legacy
 * `sms_usa_only: true` → include [US] when `sms_countries` is absent.
 */
export function resolveSmsCountryFilter(consent: Record<string, unknown> | null | undefined): {
  countries: string[];
  mode: ConsentCountriesMode;
} {
  const c = consent ?? {};
  const hasCountriesKey = Object.prototype.hasOwnProperty.call(c, "sms_countries");
  const countries = normalizeCountriesList(c.sms_countries);
  if (countries.length > 0 || (hasCountriesKey && Array.isArray(c.sms_countries))) {
    return {
      countries,
      mode: normalizeCountriesMode(c.sms_countries_mode),
    };
  }
  if (c.sms_usa_only === true) {
    return { countries: ["US"], mode: "include" };
  }
  return { countries: [], mode: "include" };
}

export function resolveWhatsappCountryFilter(consent: Record<string, unknown> | null | undefined): {
  countries: string[];
  mode: ConsentCountriesMode;
} {
  const c = consent ?? {};
  return {
    countries: normalizeCountriesList(c.whatsapp_countries),
    mode: normalizeCountriesMode(c.whatsapp_countries_mode),
  };
}

/**
 * Whether a channel checkbox should show.
 * - Channel off → hide
 * - No countries (unrestricted) → show if on
 * - Countries set but country unknown → hide
 * - include → country in list; exclude → country not in list
 */
export function shouldShowConsentChannel(opts: {
  channelOn: boolean;
  countries: string[];
  mode?: ConsentCountriesMode | null;
  countryCode: string | null | undefined;
}): boolean {
  if (!opts.channelOn) return false;
  const countries = opts.countries.map((c) => c.toUpperCase()).filter(Boolean);
  if (countries.length === 0) return true;
  const country = knownCode(opts.countryCode);
  if (!country) return false;
  const mode = opts.mode === "exclude" ? "exclude" : "include";
  const inList = countries.includes(country);
  return mode === "include" ? inList : !inList;
}

/**
 * Soft-warn helper: true when both SMS and WhatsApp are on and there exists at
 * least one ISO country that would show both (overlap risk for max-2).
 * Conservative: unrestricted (empty list) overlaps every country the other side shows.
 */
export function consentChannelsOverlap(opts: {
  smsOn: boolean;
  smsCountries: string[];
  smsMode?: ConsentCountriesMode | null;
  whatsappOn: boolean;
  whatsappCountries: string[];
  whatsappMode?: ConsentCountriesMode | null;
  /** Catalog of known country codes to test; if empty, only detects empty-list overlaps. */
  catalogCountries?: string[];
}): boolean {
  if (!opts.smsOn || !opts.whatsappOn) return false;
  const sms = {
    countries: opts.smsCountries.map((c) => c.toUpperCase()).filter(Boolean),
    mode: (opts.smsMode === "exclude" ? "exclude" : "include") as ConsentCountriesMode,
  };
  const wa = {
    countries: opts.whatsappCountries.map((c) => c.toUpperCase()).filter(Boolean),
    mode: (opts.whatsappMode === "exclude" ? "exclude" : "include") as ConsentCountriesMode,
  };
  // Both unrestricted → overlap everywhere
  if (sms.countries.length === 0 && wa.countries.length === 0) return true;
  const catalog =
    opts.catalogCountries && opts.catalogCountries.length > 0
      ? opts.catalogCountries.map((c) => c.toUpperCase()).filter(Boolean)
      : Array.from(new Set([...sms.countries, ...wa.countries]));
  if (catalog.length === 0) return true;
  for (const code of catalog) {
    const smsShows = shouldShowConsentChannel({
      channelOn: true,
      countries: sms.countries,
      mode: sms.mode,
      countryCode: code,
    });
    const waShows = shouldShowConsentChannel({
      channelOn: true,
      countries: wa.countries,
      mode: wa.mode,
      countryCode: code,
    });
    if (smsShows && waShows) return true;
  }
  // Unrestricted side vs filtered: unrestricted shows for every code the other shows
  if (sms.countries.length === 0 || wa.countries.length === 0) {
    const filtered = sms.countries.length === 0 ? wa : sms;
    if (filtered.mode === "include" && filtered.countries.length > 0) return true;
    if (filtered.mode === "exclude" && filtered.countries.length > 0) {
      // exclude US still shows for other catalog countries if any exist outside the list
      return catalog.some(
        (code) =>
          shouldShowConsentChannel({
            channelOn: true,
            countries: filtered.countries,
            mode: filtered.mode,
            countryCode: code,
          }),
      );
    }
  }
  return false;
}
