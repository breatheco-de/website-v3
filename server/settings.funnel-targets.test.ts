import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import { getFunnelSettings, parseFunnelSettings, resetSettings, updateFunnelSettings } from "./settings";

describe("funnel.targets in settings.yml", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "funnel-targets-"));
    resetSettings(tmp);
  });

  afterEach(() => {
    resetSettings(tmp);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("parses metric-id keys and drops invalid values", () => {
    const parsed = parseFunnelSettings({
      enforcement: true,
      targets: {
        decision: { conversion_rate: 0.04, cost_per_lead: { USD: 35, usd: 30, EURO: 3, GBP: -1 } },
        awareness: { moved_forward_rate: 1.5 },
        "post-enrollment": { task_click_rate: 0.5, cost_per_engaged_visit: { USD: 1 } },
      },
    });
    expect(parsed.enforcement).toBe(true);
    expect(parsed.targets).toEqual({
      decision: { rate: 0.04, cost: { USD: 30 } },
      "post-enrollment": { rate: 0.5 },
    });
  });

  it("keeps enforcement when saving targets and keeps targets when saving enforcement", () => {
    fs.writeFileSync(
      path.join(tmp, "settings.yml"),
      yaml.dump({ i18n: {}, funnel: { enforcement: true } }),
      "utf-8",
    );
    resetSettings(tmp);

    updateFunnelSettings({ targets: { decision: { rate: 0.05, cost: { USD: 40 } } } }, tmp);
    let raw = yaml.load(fs.readFileSync(path.join(tmp, "settings.yml"), "utf-8")) as Record<string, any>;
    expect(raw.funnel).toEqual({
      enforcement: true,
      targets: { decision: { conversion_rate: 0.05, cost_per_lead: { USD: 40 } } },
    });
    expect(raw.i18n).toEqual({});

    updateFunnelSettings({ enforcement: false }, tmp);
    raw = yaml.load(fs.readFileSync(path.join(tmp, "settings.yml"), "utf-8")) as Record<string, any>;
    expect(raw.funnel.enforcement).toBe(false);
    expect(raw.funnel.targets.decision.cost_per_lead).toEqual({ USD: 40 });
    expect(getFunnelSettings(tmp).targets?.decision).toEqual({ rate: 0.05, cost: { USD: 40 } });
  });

  it("removes the targets block when every target is cleared", () => {
    updateFunnelSettings({ targets: { decision: { rate: 0.05 } } }, tmp);
    updateFunnelSettings({ targets: {} }, tmp);
    const raw = yaml.load(fs.readFileSync(path.join(tmp, "settings.yml"), "utf-8")) as Record<string, any>;
    expect(raw.funnel).toEqual({ enforcement: false });
  });
});
