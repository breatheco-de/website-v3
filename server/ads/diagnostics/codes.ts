/**
 * Ads validators and their issue codes. `verify` is required and explicit for every code:
 * how a fix is confirmed (Re-check now, after the next successful Sync, or after N fresh days
 * of post-fix data with a minimum amount of data). Emitting a code that is not declared here
 * fails that validator for the Run (see `assertDeclaredCodes`).
 */

import type { IssueCodeDefinition, ValidatorMetadata } from "../../../scripts/validation/shared/types";
import type { AdsIssueCode, AdsIssuePlatform, UtmIssueCode } from "@shared/ads-diagnostics-rules";
import type { AdsMinData, AdsVerify } from "@shared/ads-issues";

type InstantOrSync = { kind: "instant" } | { kind: "after_sync"; platform: "meta" | "google" | "target" };

/** `fresh_days` codes must declare `min_data` — enforced by the type, so the build fails without it. */
export type AdsIssueCodeDefinition = IssueCodeDefinition &
  (
    | { verify: InstantOrSync; min_data?: AdsMinData }
    | { verify: { kind: "fresh_days"; days: number; lag_days: number }; min_data: AdsMinData }
  );

export type AdsValidatorName = "ads-meta" | "ads-google" | "ads-shared";

export interface AdsValidator extends Omit<ValidatorMetadata, "issueCodes" | "name"> {
  name: AdsValidatorName;
  platform: AdsIssuePlatform;
  issueCodes: Partial<Record<AdsIssueCode, AdsIssueCodeDefinition>>;
}

const instant = { kind: "instant" } as const;
const afterMeta = { kind: "after_sync", platform: "meta" } as const;
const afterGoogle = { kind: "after_sync", platform: "google" } as const;
const traffic = (days = 3, lag_days = 2) => ({ kind: "fresh_days", days, lag_days }) as const;

const UTM_CODE_TITLES: Record<UtmIssueCode, string> = {
  utm_unfilled_macro: "Tracking placeholder reached GA4 unfilled",
  utm_case_mixed: "Tracking values in mixed case",
  utm_bad_chars: "Tracking values with spaces or odd characters",
  utm_medium_nonstandard: "Medium GA4 doesn't count as paid",
  utm_source_alias: "Source outside the UTM convention",
  utm_medium_off_convention: "Medium outside the UTM convention",
  utm_campaign_pattern: "Campaign name doesn't match the pattern",
  utm_missing_ids: "Tracking ids missing",
};

/** Every validator owns UTM codes for its platform's traffic; verify depends on where the evidence comes from. */
function utmCodes(def: Omit<AdsIssueCodeDefinition, "title">): Record<UtmIssueCode, AdsIssueCodeDefinition> {
  return Object.fromEntries(
    (Object.keys(UTM_CODE_TITLES) as UtmIssueCode[]).map((code) => [code, { ...def, title: UTM_CODE_TITLES[code] } as AdsIssueCodeDefinition]),
  ) as Record<UtmIssueCode, AdsIssueCodeDefinition>;
}

export const ADS_META_VALIDATOR: AdsValidator = {
  name: "ads-meta",
  platform: "meta",
  description: "Meta ads: access, tracking parameters, landing pages, pixel and lead conversions.",
  apiExposed: false,
  estimatedDuration: "medium",
  category: "ads",
  issueCodes: {
    meta_access_failed: { title: "Meta rejected our access", verify: afterMeta },
    meta_sync_failing: { title: "Meta sync keeps failing", verify: afterMeta },
    lead_conversion_stopped: { title: "Picked lead conversion stopped reporting", verify: afterMeta },
    spend_zero_visits: { title: "Ads spend but no visits", verify: traffic(), min_data: { metric: "clicks", value: 20 } },
    tracking_params_unverified: {
      title: "Not enough data to confirm tracking",
      verify: traffic(),
      min_data: { metric: "clicks", value: 30 },
    },
    clicks_visits_low: { title: "Few ad clicks become visits", verify: traffic(), min_data: { metric: "clicks", value: 100 } },
    unclear_share_high: {
      title: "Many Meta visits cannot be classified",
      verify: traffic(),
      min_data: { metric: "sessions", value: 50 },
    },
    unrecognized_campaign: { title: "Campaign we can't see", verify: traffic(), min_data: { metric: "sessions", value: 10 } },
    pixel_not_reporting_leads: {
      title: "Meta pixel is not reporting leads",
      verify: traffic(5, 1),
      min_data: { metric: "clicks", value: 100 },
    },
    lead_conversions_overlap: {
      title: "Lead conversions counted twice",
      verify: traffic(7, 1),
      min_data: { metric: "leads", value: 10 },
    },
    pixel_events_lockstep: {
      title: "Pixel events fire together",
      verify: traffic(7, 1),
      min_data: { metric: "clicks", value: 50 },
    },
    landing_not_live: { title: "Ad links to a page that isn't live", verify: instant },
    ad_url_redirects: { title: "Ad points to an old URL", verify: instant },
    missing_tracking_params: { title: "Ads missing tracking parameters", verify: instant },
    tracking_params_unchecked: { title: "Couldn't check tracking parameters", verify: instant },
    non_paid_medium: { title: "Ads tagged as unpaid traffic", verify: instant },
    off_site_destination: { title: "Ads send people off-site", verify: instant },
    instant_form_destination: { title: "Meta Instant Forms", verify: instant },
    unmanaged_destination: { title: "Ads land on a page we don't manage", verify: instant },
    account_landing_location_mismatch: {
      title: "Ad account locations don't match the page",
      verify: afterMeta,
    },
    account_landing_location_missing: {
      title: "Ad account limited, page has no Locations",
      verify: afterMeta,
    },
    ...utmCodes({ verify: afterMeta }),
  },
};

export const ADS_SHARED_VALIDATOR: AdsValidator = {
  name: "ads-shared",
  platform: "shared",
  description: "Checks that aren't about one ad platform: lead records vs GA4 and consent.",
  apiExposed: false,
  estimatedDuration: "fast",
  category: "ads",
  issueCodes: {
    ga4_ledger_gap: { title: "GA4 and our lead records disagree", verify: traffic(5, 2), min_data: { metric: "leads", value: 10 } },
    ledger_not_recording: {
      title: "Our site stopped recording paid leads",
      verify: traffic(3, 2),
      min_data: { metric: "sessions", value: 20 },
    },
    consent_rate_drop: { title: "Fewer visitors accept tracking", verify: traffic(7, 1), min_data: { metric: "sessions", value: 100 } },
    ads_config_unreadable: { title: "Ads settings file can't be read", verify: instant },
    utm_convention_invalid: { title: "UTM convention has non-standard values", verify: instant },
    ...utmCodes({ verify: traffic(3, 2), min_data: { metric: "sessions", value: 10 } }),
  },
};

export const ADS_GOOGLE_VALIDATOR: AdsValidator = {
  name: "ads-google",
  platform: "google",
  description: "Google Ads: BigQuery transfer, accounts, visit matching and Google-reported leads.",
  apiExposed: false,
  estimatedDuration: "medium",
  category: "ads",
  issueCodes: {
    google_sync_failing: { title: "Google Ads sync keeps failing", verify: afterGoogle },
    google_transfer_stale: { title: "Google Ads transfer is late", verify: afterGoogle },
    google_transfer_missing_account: { title: "Google Ads account not in the transfer", verify: afterGoogle },
    google_history_short: { title: "Google history is short", verify: afterGoogle },
    google_account_not_connected: { title: "Google Ads account not connected", verify: afterGoogle },
    google_auto_tagging_off: { title: "Auto-tagging is off", verify: afterGoogle },
    google_gclid_join_unavailable: { title: "Can't join Google clicks to GA4 visits", verify: afterGoogle },
    google_destination_policy: { title: "Spend that doesn't reach the site", verify: afterGoogle },
    google_ga4_not_linked: { title: "GA4 isn't linked to Google Ads", verify: traffic(), min_data: { metric: "clicks", value: 50 } },
    spend_zero_visits: { title: "Google ads spend but no visits", verify: traffic(), min_data: { metric: "clicks", value: 20 } },
    google_conversions_not_reporting: {
      title: "Google Ads isn't counting leads",
      verify: traffic(5, 2),
      min_data: { metric: "clicks", value: 100 },
    },
    account_landing_location_mismatch: {
      title: "Ad account locations don't match the page",
      verify: afterGoogle,
    },
    account_landing_location_missing: {
      title: "Ad account limited, page has no Locations",
      verify: afterGoogle,
    },
    ...utmCodes({ verify: afterGoogle }),
  },
};

export const ADS_VALIDATORS: Record<AdsValidatorName, AdsValidator> = {
  "ads-meta": ADS_META_VALIDATOR,
  "ads-google": ADS_GOOGLE_VALIDATOR,
  "ads-shared": ADS_SHARED_VALIDATOR,
};

/** Shared checks ride on the Meta check (same report build). */
export const ADS_VALIDATORS_BY_PLATFORM: Record<"meta" | "google", AdsValidatorName[]> = {
  meta: ["ads-meta", "ads-shared"],
  google: ["ads-google"],
};

export function adsValidatorFor(platform: AdsIssuePlatform): AdsValidatorName {
  return platform === "google" ? "ads-google" : platform === "shared" ? "ads-shared" : "ads-meta";
}

export function getAdsCodeDefinition(validator: string, code: string): AdsIssueCodeDefinition | null {
  const v = ADS_VALIDATORS[validator as AdsValidatorName];
  return (v?.issueCodes as Record<string, AdsIssueCodeDefinition> | undefined)?.[code] ?? null;
}

export function adsVerifyFor(validator: string, code: string): { verify: AdsVerify; min_data: AdsMinData | null } | null {
  const def = getAdsCodeDefinition(validator, code);
  return def ? { verify: def.verify, min_data: def.min_data ?? null } : null;
}

export class UndeclaredAdsCodeError extends Error {
  constructor(
    readonly validator: string,
    readonly codes: string[],
  ) {
    super(`${validator} emitted undeclared issue code(s): ${codes.join(", ")}. Declare them in server/ads/diagnostics/codes.ts.`);
    this.name = "UndeclaredAdsCodeError";
  }
}

/** Throws when a validator emitted a code it doesn't declare (that validator's results are not applied). */
export function assertDeclaredCodes(validator: AdsValidatorName, codes: Iterable<string>): void {
  const declared = ADS_VALIDATORS[validator].issueCodes as Record<string, unknown>;
  const bad = Array.from(new Set(codes)).filter((c) => !declared[c]);
  if (bad.length > 0) throw new UndeclaredAdsCodeError(validator, bad);
}

/** Issue-code catalogs for the shared registry (MCP explain / titles). */
export const ADS_ISSUE_CODE_CATALOGS: Record<AdsValidatorName, Record<string, IssueCodeDefinition>> = {
  "ads-meta": ADS_META_VALIDATOR.issueCodes as Record<string, IssueCodeDefinition>,
  "ads-google": ADS_GOOGLE_VALIDATOR.issueCodes as Record<string, IssueCodeDefinition>,
  "ads-shared": ADS_SHARED_VALIDATOR.issueCodes as Record<string, IssueCodeDefinition>,
};
