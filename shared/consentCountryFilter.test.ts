import { describe, expect, it } from "vitest";
import {
  consentChannelsOverlap,
  normalizeCountriesList,
  normalizeCountriesMode,
  resolveConsentCountryCode,
  resolveSmsCountryFilter,
  resolveWhatsappCountryFilter,
  shouldShowConsentChannel,
} from "./consentCountryFilter";

describe("resolveConsentCountryCode", () => {
  it("prefers the form location country", () => {
    expect(
      resolveConsentCountryCode({
        formLocation: { country_code: "ES" },
        sessionLocation: { country_code: "US" },
        geo: { country_code: "MX" },
      }),
    ).toBe("ES");
  });

  it("falls through XX form location to geo", () => {
    expect(
      resolveConsentCountryCode({
        formLocation: { country_code: "XX" },
        sessionLocation: { country_code: "US" },
        geo: { country_code: "CO" },
      }),
    ).toBe("CO");
  });

  it("uses session then geo when there is no form location", () => {
    expect(
      resolveConsentCountryCode({
        sessionLocation: { country_code: "MX" },
        geo: { country_code: "US" },
      }),
    ).toBe("MX");
    expect(resolveConsentCountryCode({ geo: { country_code: "US" } })).toBe("US");
  });

  it("returns null when nothing is known", () => {
    expect(resolveConsentCountryCode({})).toBeNull();
  });
});

describe("shouldShowConsentChannel", () => {
  it("hides when the channel is off", () => {
    expect(
      shouldShowConsentChannel({ channelOn: false, countries: [], countryCode: "US" }),
    ).toBe(false);
  });

  it("shows unrestricted when on and countries empty", () => {
    expect(
      shouldShowConsentChannel({ channelOn: true, countries: [], countryCode: null }),
    ).toBe(true);
  });

  it("hides filtered channels when country is unknown", () => {
    expect(
      shouldShowConsentChannel({
        channelOn: true,
        countries: ["US"],
        mode: "include",
        countryCode: null,
      }),
    ).toBe(false);
  });

  it("include US shows only US", () => {
    expect(
      shouldShowConsentChannel({
        channelOn: true,
        countries: ["US"],
        mode: "include",
        countryCode: "US",
      }),
    ).toBe(true);
    expect(
      shouldShowConsentChannel({
        channelOn: true,
        countries: ["US"],
        mode: "include",
        countryCode: "ES",
      }),
    ).toBe(false);
  });

  it("exclude US shows every non-US country", () => {
    expect(
      shouldShowConsentChannel({
        channelOn: true,
        countries: ["US"],
        mode: "exclude",
        countryCode: "ES",
      }),
    ).toBe(true);
    expect(
      shouldShowConsentChannel({
        channelOn: true,
        countries: ["US"],
        mode: "exclude",
        countryCode: "US",
      }),
    ).toBe(false);
  });
});

describe("legacy and normalize", () => {
  it("sms_usa_only true becomes include US", () => {
    expect(resolveSmsCountryFilter({ sms_usa_only: true })).toEqual({
      countries: ["US"],
      mode: "include",
    });
  });

  it("sms_countries wins over sms_usa_only", () => {
    expect(
      resolveSmsCountryFilter({ sms_usa_only: true, sms_countries: ["CA"], sms_countries_mode: "exclude" }),
    ).toEqual({ countries: ["CA"], mode: "exclude" });
  });

  it("normalizes lists and modes", () => {
    expect(normalizeCountriesList(["us", "ES", "us", 1, null])).toEqual(["US", "ES"]);
    expect(normalizeCountriesMode("exclude")).toBe("exclude");
    expect(normalizeCountriesMode(undefined)).toBe("include");
    expect(resolveWhatsappCountryFilter({ whatsapp_countries: ["US"], whatsapp_countries_mode: "exclude" })).toEqual({
      countries: ["US"],
      mode: "exclude",
    });
  });
});

describe("consentChannelsOverlap", () => {
  it("detects SMS include US + WhatsApp exclude US as no overlap", () => {
    expect(
      consentChannelsOverlap({
        smsOn: true,
        smsCountries: ["US"],
        smsMode: "include",
        whatsappOn: true,
        whatsappCountries: ["US"],
        whatsappMode: "exclude",
        catalogCountries: ["US", "ES", "MX"],
      }),
    ).toBe(false);
  });

  it("detects both unrestricted as overlap", () => {
    expect(
      consentChannelsOverlap({
        smsOn: true,
        smsCountries: [],
        whatsappOn: true,
        whatsappCountries: [],
      }),
    ).toBe(true);
  });
});
