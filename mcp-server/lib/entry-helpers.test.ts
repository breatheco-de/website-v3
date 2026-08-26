/**
 * Unit tests for mcp-server/lib/entry-helpers.ts
 */
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  listExtraUrlPatternParams,
  safeTopLevelFieldsForConfig,
  missingRequiredFields,
  observeParamValues,
  extractParamSlug,
  createViaForConfig,
  bodyModelForConfig,
  siteFailResult,
} from "./entry-helpers";
import type { ContentTypeConfig } from "./content";
import { safeDump } from "./content";

describe("listExtraUrlPatternParams", () => {
  it("extracts non-slug params", () => {
    expect(
      listExtraUrlPatternParams({
        en: "/en/blog/:category/:slug",
        es: "/es/blog/:category/:slug",
      }),
    ).toEqual(["category"]);
  });
});

describe("safeTopLevelFieldsForConfig", () => {
  it("includes editor.type-safe mapping keys", () => {
    const config: ContentTypeConfig = {
      field_mapping: { title: "title", description: "description", content: "content" },
      editor: {
        title: { type: "text", required: true },
        description: { type: "textarea", required: true },
        content: { type: "markdown", required: true },
      },
    };
    const allowed = safeTopLevelFieldsForConfig(config);
    expect(allowed.has("title")).toBe(true);
    expect(allowed.has("description")).toBe(true);
    expect(allowed.has("content")).toBe(true);
    expect(allowed.has("settings")).toBe(true);
  });

  it("includes json editor fields with schema", () => {
    const config: ContentTypeConfig = {
      field_mapping: { faq_entries: "faq_entries" },
      editor: {
        faq_entries: {
          type: "json",
          schema: { type: "array" },
        },
      },
    };
    const allowed = safeTopLevelFieldsForConfig(config);
    expect(allowed.has("faq_entries")).toBe(true);
  });
});

describe("missingRequiredFields", () => {
  it("reports editor.required gaps", () => {
    const config: ContentTypeConfig = {
      editor: {
        title: { required: true },
        content: { required: true },
      },
    };
    expect(missingRequiredFields(config, {}, { title: "Hi" })).toEqual(["content"]);
    expect(missingRequiredFields(config, {}, { title: "Hi", content: "# body" })).toEqual([]);
  });

  it("skips required: attached when isDetached", () => {
    const config: ContentTypeConfig = {
      single_template: true,
      editor: {
        title: { required: true },
        call_to_action: { required: "attached", type: "json", schema: { type: "object" } },
      },
    };
    expect(
      missingRequiredFields(config, {}, { title: "Hi" }, { isSharedLayout: true, isDetached: true }),
    ).toEqual([]);
    expect(
      missingRequiredFields(config, {}, { title: "Hi" }, { isSharedLayout: true, isDetached: false }),
    ).toContain("call_to_action");
  });
});

describe("createVia / bodyModel", () => {
  it("null create_via for DB-backed", () => {
    expect(createViaForConfig({ database: { slug: "x" } })).toBeNull();
    expect(createViaForConfig({ single_template: true })).toBe("create_entry");
  });
  it("body model for shared layout", () => {
    expect(bodyModelForConfig({ single_template: true })).toBe("locale_fields_plus_shared_single");
    expect(bodyModelForConfig({})).toBe("sections_owned");
  });
});

describe("observeParamValues", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-obs-"));
    const blog = path.join(tmp, "blog", "post-a");
    fs.mkdirSync(blog, { recursive: true });
    fs.writeFileSync(
      path.join(blog, "en.yml"),
      safeDump({ slug: "post-a", category: "ai-powered-learning" }),
      "utf-8",
    );
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  it("collects category slugs from locale peers", () => {
    const vals = observeParamValues(tmp, "blog", { directory: "blog" }, "category", "en");
    expect(vals).toContain("ai-powered-learning");
  });
});

describe("extractParamSlug", () => {
  it("reads string or object.slug", () => {
    expect(extractParamSlug("foo")).toBe("foo");
    expect(extractParamSlug({ slug: "bar" })).toBe("bar");
    expect(extractParamSlug(null)).toBeNull();
  });
});

describe("siteFailResult", () => {
  it("missing site: list_sites only — does not invent sites[0] or same-tool retry", () => {
    const result = siteFailResult(
      JSON.stringify({
        error: "multi_site_domain_required",
        message: "need site",
        available_sites: ["4geeks.com", "fl.4geeksacademy.com"],
      }),
      "list_entry_seo",
      { contentType: "blog" },
    );
    const payload = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(payload.action_required).toBe("multi_site_domain_required");
    expect(payload.requested_site).toBeUndefined();
    const next = payload.next_actions as Array<{ tool: string; args_hint?: Record<string, unknown> }>;
    expect(next.map((a) => a.tool)).toEqual(["list_sites"]);
    expect(next.every((a) => !a.args_hint?.site)).toBe(true);
  });

  it("unknown site: surfaces requested_site; retry omits site from args_hint", () => {
    const result = siteFailResult(
      JSON.stringify({
        error: "unknown_site",
        message: "Unknown site",
        available_sites: ["4geeks.com", "business.4geeks.com"],
        requested_site: "bussiness.4geeks.com",
      }),
      "list_entry_seo",
      { contentType: "blog", site: "bussiness.4geeks.com" },
    );
    const payload = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(payload.action_required).toBe("unknown_site");
    expect(payload.requested_site).toBe("bussiness.4geeks.com");
    const next = payload.next_actions as Array<{ tool: string; args_hint?: Record<string, unknown> }>;
    expect(next.map((a) => a.tool)).toEqual(["list_sites", "list_entry_seo"]);
    const retry = next.find((a) => a.tool === "list_entry_seo");
    expect(retry?.args_hint).toEqual({ contentType: "blog" });
    expect(retry?.args_hint?.site).toBeUndefined();
    expect(JSON.stringify(next)).not.toContain('"site":"4geeks.com"');
  });
});
