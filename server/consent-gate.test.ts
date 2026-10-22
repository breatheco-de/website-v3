import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({
  fallback: "consent_general" as string | null,
  events: [
    { name: "request_more_info", consent: { marketing: false, sms: true, whatsapp: true } },
    { name: "contact_us", consent: { marketing: true } },
  ] as Array<Record<string, unknown>>,
}));

vi.mock("./settings", () => ({
  getConsentFallback: () => settings.fallback,
  getTrackingSettings: () => ({ conversion_events: settings.events }),
}));

vi.mock("./component-registry", () => ({
  loadAllFieldEditors: () => ({ hero: { form: "form-settings" } }),
}));

import { runConsentGate } from "./consent-gate";
import { CONSENT_REQUIRED_CODE, SITE_NO_DEFAULT_CONSENT_CODE } from "@shared/formConsentCheck";

const page = (form: Record<string, unknown>) => ({ sections: [{ type: "text" }, { type: "hero", form }] });

describe("runConsentGate", () => {
  beforeEach(() => {
    settings.fallback = "consent_general";
  });

  it("passes when the site Default covers an SMS/WhatsApp-only form", () => {
    expect(runConsentGate({ pageData: page({ conversion_name: "request_more_info" }) })).toEqual({ failure: null, warnings: [] });
  });

  it("blocks when a form has no mandatory checkbox and the site has no Default", () => {
    settings.fallback = null;
    const res = runConsentGate({ pageData: page({ conversion_name: "request_more_info" }) });
    expect(res.failure?.code).toBe(CONSENT_REQUIRED_CODE);
    expect(res.failure?.forms).toEqual([
      { property_path: "sections[1].form", fix_field_path: "sections.1.form.consent.general", conversion_name: "request_more_info" },
    ]);
    expect(res.warnings.map((w) => w.code)).toEqual([SITE_NO_DEFAULT_CONSENT_CODE]);
  });

  it("passes Marketing from the event without a Default, but still warns about the site", () => {
    settings.fallback = null;
    const res = runConsentGate({ pageData: page({ conversion_name: "contact_us" }) });
    expect(res.failure).toBeNull();
    expect(res.warnings.map((w) => w.code)).toEqual([SITE_NO_DEFAULT_CONSENT_CODE]);
  });

  it("checks overrides that switch to another event", () => {
    settings.fallback = null;
    const res = runConsentGate({
      pageData: page({
        conversion_name: "contact_us",
        form_overrides: [{ conditions: [{}], conversion_name: "request_more_info" }],
      }),
    });
    expect(res.failure?.forms.map((f) => f.property_path)).toEqual(["sections[1].form.form_overrides[0]"]);
  });

  it("ignores pages without forms", () => {
    expect(runConsentGate({ pageData: { sections: [{ type: "text" }] } }).failure).toBeNull();
  });
});
