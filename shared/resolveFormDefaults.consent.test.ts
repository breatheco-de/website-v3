import { describe, expect, it } from "vitest";
import { resolveFormDefaults } from "./resolveFormDefaults";

describe("resolveFormDefaults consent country inherit", () => {
  it("fills empty form sms_countries from the conversion event", () => {
    const section = {
      form: {
        consent: {
          sms: true,
          sms_countries: [],
        },
      },
    };
    const resolved = resolveFormDefaults(section, {
      name: "request_more_info",
      consent: {
        sms: true,
        sms_countries: ["US"],
        sms_countries_mode: "include",
        whatsapp: true,
        whatsapp_countries: ["US"],
        whatsapp_countries_mode: "exclude",
      },
    });
    const consent = (resolved.form as { consent: Record<string, unknown> }).consent;
    expect(consent.sms_countries).toEqual(["US"]);
    expect(consent.sms_countries_mode).toBe("include");
    expect(consent.whatsapp_countries).toEqual(["US"]);
    expect(consent.whatsapp_countries_mode).toBe("exclude");
  });

  it("keeps a non-empty form country list over the event", () => {
    const section = {
      form: {
        consent: {
          sms: true,
          sms_countries: ["CA"],
          sms_countries_mode: "include",
        },
      },
    };
    const resolved = resolveFormDefaults(section, {
      name: "request_more_info",
      consent: {
        sms_countries: ["US"],
        sms_countries_mode: "include",
      },
    });
    const consent = (resolved.form as { consent: Record<string, unknown> }).consent;
    expect(consent.sms_countries).toEqual(["CA"]);
  });
});
