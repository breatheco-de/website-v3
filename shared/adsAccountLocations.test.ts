import { describe, expect, it } from "vitest";
import {
  accountLocationSet,
  anyAccountRestricted,
  deliverableAccountsForLanding,
  filterAccountLocationsToKnown,
  isDeliverableAd,
  landingLocationsCompatibleWithAccount,
  landingLocationsMismatchAccount,
  parseAccountLocationsMap,
  type DeliverableAdRef,
} from "./adsAccountLocations";

describe("parseAccountLocationsMap", () => {
  it("keeps only allowed account ids and non-empty slug lists", () => {
    expect(
      parseAccountLocationsMap(
        {
          a1: ["madrid-spain", "madrid-spain", ""],
          a2: [],
          a3: ["barcelona-spain"],
          unknown: ["x"],
        },
        ["a1", "a2", "a3"],
      ),
    ).toEqual({ a1: ["madrid-spain"], a3: ["barcelona-spain"] });
  });

  it("returns empty for junk", () => {
    expect(parseAccountLocationsMap(null, ["a1"])).toEqual({});
    expect(parseAccountLocationsMap("nope", ["a1"])).toEqual({});
  });
});

describe("filterAccountLocationsToKnown", () => {
  it("drops unknown slugs and empties accounts", () => {
    const known = new Set(["madrid-spain"]);
    expect(filterAccountLocationsToKnown({ a1: ["madrid-spain", "ghost"], a2: ["ghost"] }, known)).toEqual({
      a1: ["madrid-spain"],
    });
  });
});

describe("accountLocationSet / compatibility", () => {
  it("treats missing/empty as unrestricted", () => {
    expect(accountLocationSet({}, "a1")).toBeNull();
    expect(accountLocationSet({ a1: [] }, "a1")).toBeNull();
    expect(anyAccountRestricted({ a1: ["madrid-spain"] })).toBe(true);
    expect(anyAccountRestricted({})).toBe(false);
  });

  it("compatible when unrestricted or empty page locations", () => {
    expect(landingLocationsCompatibleWithAccount(["madrid-spain"], null)).toBe(true);
    expect(landingLocationsCompatibleWithAccount([], new Set(["madrid-spain"]))).toBe(true);
    expect(landingLocationsCompatibleWithAccount(["madrid-spain"], new Set(["madrid-spain", "x"]))).toBe(true);
    expect(landingLocationsCompatibleWithAccount(["barcelona-spain"], new Set(["madrid-spain"]))).toBe(false);
  });

  it("mismatch only when page has locations with no overlap", () => {
    expect(landingLocationsMismatchAccount([], new Set(["madrid-spain"]))).toBe(false);
    expect(landingLocationsMismatchAccount(["barcelona-spain"], new Set(["madrid-spain"]))).toBe(true);
    expect(landingLocationsMismatchAccount(["madrid-spain"], null)).toBe(false);
  });
});

describe("isDeliverableAd / deliverableAccountsForLanding", () => {
  const base: DeliverableAdRef = {
    account_id: "acct-es",
    status: "ACTIVE",
    landing_urls: ["https://4geeks.com/landing/ai-eng"],
  };

  it("excludes paused, gone, instant form", () => {
    expect(isDeliverableAd(base)).toBe(true);
    expect(isDeliverableAd({ ...base, status: "PAUSED" })).toBe(false);
    expect(isDeliverableAd({ ...base, campaign_status: "PAUSED" })).toBe(false);
    expect(isDeliverableAd({ ...base, gone_at: "2026-01-01" })).toBe(false);
    expect(isDeliverableAd({ ...base, destination: "instant_form" })).toBe(false);
  });

  it("lists distinct accounts with deliverable ads on a path", () => {
    const ads: DeliverableAdRef[] = [
      base,
      { ...base, account_id: "acct-latam", landing_urls: ["https://4geeks.com/landing/ai-eng/"] },
      { ...base, account_id: "paused", status: "PAUSED" },
      { ...base, account_id: "other", landing_urls: ["https://4geeks.com/landing/other"] },
    ];
    expect(deliverableAccountsForLanding(ads, "/landing/ai-eng")).toEqual(["acct-es", "acct-latam"]);
  });
});
