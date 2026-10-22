import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  copyConversionEventText,
  planDefaultConsentMigration,
  runDefaultConsentMigration,
  setDefaultConsentText,
  type DefaultConsentMigrationDeps,
} from "./default-consent-migration";

const SOURCE = `tracking:
  conversion_events:
    - name: student_application
      tags:
        - website-lead
    - name: request_downloadable
      counts_as_lead: true
      description: Form submission
      when_to_use: >-
        Use when the visitor is gating a marketing asset.
      tags:
        - financing_guide_download
      consent:
        marketing: false
        sms: false
    - name: newsletter_signup
consent:
  fallback: consent_general
`;

const FLORIDA = `# Florida settings
tracking:
    conversion_events:
      - name: student_application
        description: Form submission
      - name: job_application
    webhook:
      url: https://example.com/lead
robots:
  - GPTBot
`;

describe("setDefaultConsentText", () => {
  it("appends a consent block when there is none", () => {
    const r = setDefaultConsentText("i18n:\n  defaultLocale: en\n");
    expect(r.ok && r.changed).toBe(true);
    if (!r.ok) return;
    expect(yaml.load(r.text)).toEqual({ i18n: { defaultLocale: "en" }, consent: { fallback: "consent_general" } });
  });

  it("inserts fallback into an existing consent block and keeps its other keys", () => {
    const r = setDefaultConsentText("consent:\n  window:\n    accept_days: 365\nother: 1\n");
    if (!r.ok) throw new Error(r.reason);
    expect(yaml.load(r.text)).toEqual({ consent: { fallback: "consent_general", window: { accept_days: 365 } }, other: 1 });
  });

  it("replaces a blank fallback", () => {
    const r = setDefaultConsentText("consent:\n  fallback: ''\n");
    if (!r.ok) throw new Error(r.reason);
    expect(yaml.load(r.text)).toEqual({ consent: { fallback: "consent_general" } });
  });

  it("leaves an existing Default alone", () => {
    const r = setDefaultConsentText("consent:\n  fallback: consent_terms\n");
    expect(r).toMatchObject({ ok: true, changed: false });
  });

  it("blocks a flow-style consent block", () => {
    expect(setDefaultConsentText("consent: { window: {} }\n").ok).toBe(false);
  });
});

describe("copyConversionEventText", () => {
  it("copies the event exactly, re-indented to the target list", () => {
    const r = copyConversionEventText(FLORIDA, SOURCE);
    if (!r.ok) throw new Error(r.reason);
    const out = yaml.load(r.text) as { tracking: { conversion_events: Array<Record<string, unknown>>; webhook: unknown }; robots: unknown };
    const src = (yaml.load(SOURCE) as { tracking: { conversion_events: Array<Record<string, unknown>> } }).tracking.conversion_events[1];
    expect(out.tracking.conversion_events.map((e) => e.name)).toEqual(["student_application", "job_application", "request_downloadable"]);
    expect(out.tracking.conversion_events[2]).toEqual(src);
    expect(out.tracking.webhook).toEqual({ url: "https://example.com/lead" });
    expect(out.robots).toEqual(["GPTBot"]);
    expect(r.text.startsWith("# Florida settings")).toBe(true);
  });

  it("does nothing when the event already exists", () => {
    const first = copyConversionEventText(FLORIDA, SOURCE);
    if (!first.ok) throw new Error(first.reason);
    expect(copyConversionEventText(first.text, SOURCE)).toMatchObject({ ok: true, changed: false });
  });

  it("fails when the source has no such event", () => {
    expect(copyConversionEventText(FLORIDA, "tracking:\n  conversion_events: []\n").ok).toBe(false);
  });
});

describe("planDefaultConsentMigration", () => {
  it("Florida gets the Default and the copied event in one write", () => {
    const plan = planDefaultConsentMigration({ site: "site_4geeks-florida", settingsText: FLORIDA, sourceSettingsText: SOURCE, pending: [] });
    expect(plan.action).toBe("write");
    if (plan.action !== "write") return;
    const out = yaml.load(plan.settingsText) as Record<string, any>;
    expect(out.consent).toEqual({ fallback: "consent_general" });
    expect(out.tracking.conversion_events.at(-1).name).toBe("request_downloadable");
  });

  it("Florida is blocked (nothing written) when 4geeks.com has no event", () => {
    const plan = planDefaultConsentMigration({ site: "site_4geeks-florida", settingsText: FLORIDA, sourceSettingsText: "a: 1\n", pending: [] });
    expect(plan.action).toBe("blocked");
  });

  it("other sites only get the Default; a site that has one is untouched", () => {
    expect(planDefaultConsentMigration({ site: "site_x", settingsText: "a: 1\n", sourceSettingsText: null, pending: [] }).action).toBe("write");
    expect(planDefaultConsentMigration({ site: "site_4geeks-com", settingsText: SOURCE, sourceSettingsText: SOURCE, pending: [] }).action).toBe("nothing");
  });

  it("recovers an unpushed settings.yml when there is nothing left to change", () => {
    const plan = planDefaultConsentMigration({ site: "site_4geeks-com", settingsText: SOURCE, sourceSettingsText: SOURCE, pending: ["site_4geeks-com/settings.yml"] });
    expect(plan).toEqual({ action: "recover", file: "site_4geeks-com/settings.yml" });
  });

  const real = (site: string) => {
    const f = path.join(process.cwd(), site, "settings.yml");
    return fs.existsSync(f) ? fs.readFileSync(f, "utf-8") : null;
  };
  const realSource = real("site_4geeks-com");
  it.runIf(realSource != null && real("site_4geeks-florida") != null)("plans cleanly against the real Florida settings", () => {
    const plan = planDefaultConsentMigration({ site: "site_4geeks-florida", settingsText: real("site_4geeks-florida"), sourceSettingsText: realSource, pending: [] });
    expect(["write", "nothing"]).toContain(plan.action);
  });
  it.runIf(real("site_business-4geeks") != null)("plans cleanly against the real Business settings", () => {
    const plan = planDefaultConsentMigration({ site: "site_business-4geeks", settingsText: real("site_business-4geeks"), sourceSettingsText: realSource, pending: [] });
    expect(["write", "nothing"]).toContain(plan.action);
  });
});

describe("runDefaultConsentMigration", () => {
  let cwd: string;
  let florida: string;
  let source: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "consent-mig-"));
    florida = path.join(cwd, "site_4geeks-florida");
    source = path.join(cwd, "site_4geeks-com");
    fs.mkdirSync(florida);
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(florida, "settings.yml"), FLORIDA);
    fs.writeFileSync(path.join(source, "settings.yml"), SOURCE);
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  const deps = (push: DefaultConsentMigrationDeps["push"]): DefaultConsentMigrationDeps => ({
    sites: () => [
      { name: "site_4geeks-com", contentRoot: source },
      { name: "site_4geeks-florida", contentRoot: florida },
    ],
    pending: () => [],
    markModified: vi.fn(),
    push,
  });

  it("dry run writes and pushes nothing", async () => {
    const push = vi.fn();
    const { failed } = await runDefaultConsentMigration({ dryRun: true, deps: deps(push), log: () => {}, error: () => {} });
    expect(failed).toBe(false);
    expect(push).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(florida, "settings.yml"), "utf-8")).toBe(FLORIDA);
  });

  it("apply writes Florida, pushes it, and prints the SHA", async () => {
    const push = vi.fn(async () => ({ success: true, commitHash: "abc123" }));
    const log = vi.fn();
    const { failed } = await runDefaultConsentMigration({ dryRun: false, deps: deps(push), log, error: () => {} });
    expect(failed).toBe(false);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("site_4geeks-florida", ["site_4geeks-florida/settings.yml"], expect.any(String));
    expect(log).toHaveBeenCalledWith("commitSha", "abc123");
  });

  it("fails when the push returns no SHA", async () => {
    const push = vi.fn(async () => ({ success: false, error: "nope" }));
    const { failed } = await runDefaultConsentMigration({ dryRun: false, deps: deps(push), log: () => {}, error: () => {} });
    expect(failed).toBe(true);
  });

  it("is idempotent", async () => {
    const push = vi.fn(async () => ({ success: true, commitHash: "abc123" }));
    await runDefaultConsentMigration({ dryRun: false, deps: deps(push), log: () => {}, error: () => {} });
    push.mockClear();
    const { failed } = await runDefaultConsentMigration({ dryRun: false, deps: deps(push), log: () => {}, error: () => {} });
    expect(failed).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it("unknown MIGRATION_SITE fails", async () => {
    const { failed } = await runDefaultConsentMigration({ site: "site_nope", dryRun: true, deps: deps(vi.fn()), log: () => {}, error: () => {} });
    expect(failed).toBe(true);
  });
});
