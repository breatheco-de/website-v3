import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import {
  DEFAULT_DATAFORSEO_SETTINGS,
  getDataForSeoSettings,
  getSearchConsoleSettings,
  parseDataForSeoSettings,
  resetSettings,
  updateDataForSeoSettings,
  updateSearchConsoleOrganicMarkets,
} from "./settings";

describe("parseDataForSeoSettings", () => {
  it("returns defaults for missing input", () => {
    expect(parseDataForSeoSettings(undefined)).toEqual(DEFAULT_DATAFORSEO_SETTINGS);
    expect(DEFAULT_DATAFORSEO_SETTINGS.enabled).toBe(false);
  });

  it("clamps USD limits to cents and warn percent to 1–99", () => {
    const s = parseDataForSeoSettings({ daily_usd_limit: 3.456, session_usd_limit: 0, budget_warn_percent: 150 });
    expect(s.daily_usd_limit).toBe(3.46);
    expect(s.session_usd_limit).toBe(0.01);
    expect(s.budget_warn_percent).toBe(99);
  });
});

describe("dataforseo settings.yml", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dataforseo-settings-"));
    resetSettings(tmp);
  });

  afterEach(() => {
    resetSettings(tmp);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("saves and reloads without storing credentials", () => {
    fs.writeFileSync(path.join(tmp, "settings.yml"), "i18n: {}\n", "utf-8");
    const updated = updateDataForSeoSettings(
      { enabled: true, daily_usd_limit: 5, session_usd_limit: 1, budget_warn_percent: 70 },
      tmp,
    );
    expect(updated).toEqual({ enabled: true, daily_usd_limit: 5, session_usd_limit: 1, budget_warn_percent: 70 });
    resetSettings(tmp);
    expect(getDataForSeoSettings(tmp).daily_usd_limit).toBe(5);
    const parsed = yaml.load(fs.readFileSync(path.join(tmp, "settings.yml"), "utf-8")) as {
      dataforseo?: Record<string, unknown>;
    };
    expect(parsed.dataforseo).toMatchObject({ enabled: true, daily_usd_limit: 5 });
    expect(JSON.stringify(parsed.dataforseo)).not.toMatch(/login|password|DATAFORSEO/i);
  });

  it("saves market languages and research defaults with the markets list", () => {
    fs.writeFileSync(path.join(tmp, "settings.yml"), "i18n: {}\n", "utf-8");
    updateSearchConsoleOrganicMarkets(
      [
        { id: "worldwide", label: "Worldwide", countries: [] },
        { id: "spain", label: "Spain", countries: ["esp"] },
        { id: "usa-es", label: "USA (Spanish)", countries: ["usa"], language: "Spanish" },
      ],
      tmp,
      { en: "usa-es", es: "spain" },
    );
    resetSettings(tmp);
    const sc = getSearchConsoleSettings(tmp);
    expect(sc.research_market_defaults).toEqual({ en: "usa-es", es: "spain" });
    expect(sc.organic_markets.find((m) => m.id === "usa-es")?.language).toBe("Spanish");

    updateSearchConsoleOrganicMarkets(sc.organic_markets, tmp);
    resetSettings(tmp);
    expect(getSearchConsoleSettings(tmp).research_market_defaults).toEqual({ en: "usa-es", es: "spain" });
  });
});
