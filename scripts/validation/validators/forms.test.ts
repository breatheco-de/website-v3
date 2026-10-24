import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import yaml from "js-yaml";
import { formsValidator } from "./forms";
import type { ContentFile, ValidationContext } from "../shared/types";

function makeContext(contentRoot: string, files: ContentFile[]): ValidationContext {
  return {
    contentRoot,
    contentFiles: files,
    redirectMap: new Map(),
    availableSchemas: new Set(),
    sitemapEntries: [],
  };
}

function pageWithForm(conversionName: string) {
  return {
    slug: "home",
    title: "Home",
    sections: [
      {
        type: "sticky_cta",
        form: {
          variant: "inline",
          conversion_name: conversionName,
          fields: { email: { visible: true } },
        },
      },
    ],
  };
}

describe("formsValidator (site-scoped)", () => {
  let tmp = "";
  let entryDir = "";

  function writeSettings(consent: Record<string, unknown> | undefined) {
    fs.writeFileSync(
      path.join(tmp, "settings.yml"),
      yaml.dump({
        tracking: {
          conversion_events: [
            { name: "site_only_event" },
            { name: "request_more_info", consent: { marketing: false, sms: true, whatsapp: true } },
            { name: "contact_us", consent: { marketing: true } },
          ],
        },
        ...(consent ? { consent } : {}),
      }),
    );
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "forms-validator-"));
    writeSettings({ fallback: "consent_general" });
    entryDir = path.join(tmp, "pages", "home");
    fs.mkdirSync(entryDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function liveFile(): ContentFile {
    return {
      slug: "home",
      title: "Home",
      type: "page",
      locale: "en",
      filePath: path.join(entryDir, "en.yml"),
    };
  }

  it("uses the context site's conversion events, not the default site's", async () => {
    fs.writeFileSync(path.join(entryDir, "en.yml"), yaml.dump(pageWithForm("site_only_event")));
    const result = await formsValidator.run(makeContext(tmp, [liveFile()]));
    expect(result.errors.filter((e) => e.code === "FORM_INVALID_CONVERSION_NAME")).toEqual([]);
  });

  it("flags a conversion_name the context site does not allow", async () => {
    fs.writeFileSync(path.join(entryDir, "en.yml"), yaml.dump(pageWithForm("business_partner_lead")));
    const result = await formsValidator.run(makeContext(tmp, [liveFile()]));
    const invalid = result.errors.filter((e) => e.code === "FORM_INVALID_CONVERSION_NAME");
    expect(invalid).toHaveLength(1);
    expect(invalid[0].suggestion).toMatch(/business_partner_lead/);
    expect(path.resolve(invalid[0].file!)).toBe(path.join(entryDir, "en.yml"));
  });

  it("also checks unpublished draft overlays in the entry folder", async () => {
    fs.writeFileSync(path.join(entryDir, "en.yml"), yaml.dump(pageWithForm("site_only_event")));
    fs.writeFileSync(path.join(entryDir, "draft.en.yml"), yaml.dump(pageWithForm("not_allowed")));
    const result = await formsValidator.run(makeContext(tmp, [liveFile()]));
    const invalid = result.errors.filter((e) => e.code === "FORM_INVALID_CONVERSION_NAME");
    expect(invalid).toHaveLength(1);
    expect(path.resolve(invalid[0].file!)).toBe(path.join(entryDir, "draft.en.yml"));
  });

  it("ignores content files outside the context site root", async () => {
    const otherSite = fs.mkdtempSync(path.join(os.tmpdir(), "forms-validator-other-"));
    try {
      const otherDir = path.join(otherSite, "pages", "home");
      fs.mkdirSync(otherDir, { recursive: true });
      fs.writeFileSync(path.join(otherDir, "en.yml"), yaml.dump(pageWithForm("not_allowed")));
      const result = await formsValidator.run(
        makeContext(tmp, [{ ...liveFile(), filePath: path.join(otherDir, "en.yml") }]),
      );
      expect(result.errors).toEqual([]);
    } finally {
      fs.rmSync(otherSite, { recursive: true, force: true });
    }
  });

  describe("mandatory consent", () => {
    const codes = (r: { errors: { code?: string }[]; warnings: { code?: string }[] }, code: string) =>
      [...r.errors, ...r.warnings].filter((e) => e.code === code);

    it("passes an SMS/WhatsApp-only event when the site has a Default consent", async () => {
      fs.writeFileSync(path.join(entryDir, "en.yml"), yaml.dump(pageWithForm("request_more_info")));
      const result = await formsValidator.run(makeContext(tmp, [liveFile()]));
      expect(codes(result, "FORM_NO_REQUIRED_CONSENT")).toEqual([]);
      expect(codes(result, "SITE_NO_DEFAULT_CONSENT")).toEqual([]);
    });

    it("flags the form and the site when there is no Default consent", async () => {
      writeSettings(undefined);
      fs.writeFileSync(path.join(entryDir, "en.yml"), yaml.dump(pageWithForm("request_more_info")));
      const result = await formsValidator.run(makeContext(tmp, [liveFile()]));
      const none = codes(result, "FORM_NO_REQUIRED_CONSENT");
      expect(none).toHaveLength(1);
      expect(none[0].message).toMatch(/request_more_info/);
      const site = codes(result, "SITE_NO_DEFAULT_CONSENT");
      expect(site).toHaveLength(1);
      expect(site[0].message).toMatch(/1 form/);
    });

    it("Marketing from the event counts as mandatory even without a Default", async () => {
      writeSettings(undefined);
      fs.writeFileSync(path.join(entryDir, "en.yml"), yaml.dump(pageWithForm("contact_us")));
      const result = await formsValidator.run(makeContext(tmp, [liveFile()]));
      expect(codes(result, "FORM_NO_REQUIRED_CONSENT")).toEqual([]);
    });

    it("checks form_overrides that switch to another event", async () => {
      writeSettings(undefined);
      const page = pageWithForm("contact_us");
      (page.sections[0].form as Record<string, unknown>).form_overrides = [
        { conditions: [{ form_field_slug: "program", value: "x" }], conversion_name: "request_more_info" },
      ];
      fs.writeFileSync(path.join(entryDir, "en.yml"), yaml.dump(page));
      const result = await formsValidator.run(makeContext(tmp, [liveFile()]));
      const none = codes(result, "FORM_NO_REQUIRED_CONSENT");
      expect(none).toHaveLength(1);
      expect(none[0].message).toMatch(/form_overrides\[0\]/);
    });

    it("warns when a form shows both General and Marketing", async () => {
      const page = pageWithForm("contact_us");
      (page.sections[0].form as Record<string, unknown>).consent = { general: true };
      fs.writeFileSync(path.join(entryDir, "en.yml"), yaml.dump(page));
      const result = await formsValidator.run(makeContext(tmp, [liveFile()]));
      expect(codes(result, "FORM_TWO_REQUIRED_CONSENTS")).toHaveLength(1);
      expect(codes(result, "FORM_NO_REQUIRED_CONSENT")).toEqual([]);
    });
  });

  describe("hidden product / persona overrides", () => {
    const codes = (r: { warnings: { code?: string }[] }) => r.warnings.map((w) => w.code).filter((c) => c?.startsWith("FORM_TRACKING") || c?.startsWith("FORM_UNKNOWN_TRACKING"));

    beforeEach(() => {
      fs.writeFileSync(
        path.join(tmp, "content-types.yml"),
        yaml.dump({ page: { directory: "pages" }, program: { directory: "programs" } }),
      );
      const prog = path.join(tmp, "programs", "ai-flex");
      fs.mkdirSync(prog, { recursive: true });
      fs.writeFileSync(
        path.join(prog, "_product.yml"),
        yaml.dump({
          purchasable: true,
          name: "AI Flex",
          short_key: "afx",
          personas: [{ id: "the-explorer", short_key: "exp", role: "Explorer", avatar: { fears: ["f"], internal_dialogue: "d", objections: ["o"] } }],
        }),
      );
    });

    function writeOverride(fields: Record<string, unknown>, overrides?: unknown[]) {
      const page = pageWithForm("contact_us");
      const form = page.sections[0].form as Record<string, unknown>;
      form.fields = { ...(form.fields as object), ...fields };
      if (overrides) form.form_overrides = overrides;
      fs.writeFileSync(path.join(entryDir, "en.yml"), yaml.dump(page));
    }

    it("accepts valid full ids", async () => {
      writeOverride({ product: { visible: false, default: "ai-flex" }, persona: { visible: false, default: "the-explorer" } });
      expect(codes(await formsValidator.run(makeContext(tmp, [liveFile()])))).toEqual([]);
    });

    it("flags unknown products and personas, and codes used instead of ids", async () => {
      writeOverride({ product: { visible: false, default: "full-stak" }, persona: { visible: false, default: "exp" } });
      expect(codes(await formsValidator.run(makeContext(tmp, [liveFile()])))).toEqual([
        "FORM_UNKNOWN_TRACKING_PRODUCT",
        "FORM_TRACKING_OVERRIDE_USES_CODE",
      ]);
    });

    it("checks form_overrides fields and skips template values", async () => {
      writeOverride({ product: { visible: false, default: "{{ entry.slug }}" } }, [
        { conditions: [], fields: { persona: { default: "nobody" } } },
      ]);
      const result = await formsValidator.run(makeContext(tmp, [liveFile()]));
      expect(codes(result)).toEqual(["FORM_UNKNOWN_TRACKING_PERSONA"]);
      expect(result.warnings.find((w) => w.code === "FORM_UNKNOWN_TRACKING_PERSONA")?.message).toMatch(/form_overrides\[0\]/);
    });
  });
});
