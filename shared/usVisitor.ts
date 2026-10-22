/**
 * US check behind `consent.sms_usa_only` (SMS checkbox only for US visitors).
 * Uses two-letter country codes, in order: the location the visitor picked, then the
 * detected session location. A location whose country is unknown (`XX`, e.g. `remote`)
 * falls through to the visitor's own geo country.
 */

import { normalizeCountryCode } from "./consent";

type WithCountryCode = { country_code?: string | null } | null | undefined;

function knownCode(raw: unknown): string | null {
  const code = normalizeCountryCode(raw);
  return code && code !== "XX" ? code : null;
}

export function isUsVisitor(opts: {
  selectedLocation?: WithCountryCode;
  sessionLocation?: WithCountryCode;
  geo?: WithCountryCode;
}): boolean {
  const picked = knownCode(opts.selectedLocation?.country_code);
  if (picked) return picked === "US";
  if (!opts.selectedLocation) {
    const detected = knownCode(opts.sessionLocation?.country_code);
    if (detected) return detected === "US";
  }
  return knownCode(opts.geo?.country_code) === "US";
}
