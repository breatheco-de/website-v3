import { describe, expect, it } from "vitest";
import { GENERAL_SETTINGS_TABS, generalSettingsHref, resolveGeneralSettingsTab, resolveSettingsSection } from "./settings-tab";

describe("resolveGeneralSettingsTab", () => {
  it("resolves every General tab from its path", () => {
    for (const tab of GENERAL_SETTINGS_TABS) {
      expect(resolveGeneralSettingsTab(generalSettingsHref(tab))).toBe(tab);
      expect(resolveGeneralSettingsTab(`${generalSettingsHref(tab)}/`)).toBe(tab);
    }
  });

  it("returns null for the bare path, unknown tabs and other sections", () => {
    expect(resolveGeneralSettingsTab("/private/settings")).toBeNull();
    expect(resolveGeneralSettingsTab("/private/settings/")).toBeNull();
    expect(resolveGeneralSettingsTab("/private/settings/auth")).toBeNull();
    expect(resolveGeneralSettingsTab("/private/settings/seo/og")).toBeNull();
  });
});

describe("resolveSettingsSection", () => {
  it("maps each settings area to its main section", () => {
    expect(resolveSettingsSection("/private/settings")).toBe("general");
    expect(resolveSettingsSection("/private/settings/brand")).toBe("general");
    expect(resolveSettingsSection("/private/settings/seo/og")).toBe("seo");
    expect(resolveSettingsSection("/private/settings/ads/meta")).toBe("ads");
    expect(resolveSettingsSection("/private/settings/ab-testing/health")).toBe("ab-testing");
    expect(resolveSettingsSection("/private/settings/ai/llms")).toBe("ai");
    expect(resolveSettingsSection("/private/tracking")).toBe("tracking");
    expect(resolveSettingsSection("/private/tracking/ga4")).toBe("tracking");
    expect(resolveSettingsSection("/private/security/captcha")).toBe("security");
  });

  it("does not match lookalike prefixes or unrelated pages", () => {
    expect(resolveSettingsSection("/private/settings/aircraft")).toBe("general");
    expect(resolveSettingsSection("/private/trackingx")).toBeNull();
    expect(resolveSettingsSection("/private/diagnostics")).toBeNull();
  });
});
