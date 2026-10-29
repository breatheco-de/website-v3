import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { setMcpSiteConfigsForTest } from "./content.js";
import { setEntryRefLookupForTest, type EntryRefLookup } from "./entry-ref-mcp.js";
import { applyToolCatalogFilter } from "./tool-catalog.js";

const contentFolder = `.tmp-mcp-entry-ref-${process.pid}`;
const contentPath = path.join(process.cwd(), contentFolder);

function write(rel: string, body: string) {
  const abs = path.join(contentPath, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf-8");
}

type Registered = { shape: Record<string, z.ZodTypeAny>; handler: (args: Record<string, unknown>) => Promise<unknown> };

function register(name: string, handler: (args: Record<string, unknown>) => unknown): Registered {
  let captured: Registered | null = null;
  const mcp = {
    tool: (_name: string, _desc: string, shape: Record<string, z.ZodTypeAny>, h: Registered["handler"]) => {
      captured = { shape, handler: h };
      return {};
    },
  } as unknown as McpServer;
  applyToolCatalogFilter(mcp, null);
  mcp.tool(
    name,
    "test tool",
    {
      slug: z.string(),
      contentType: z.string().optional(),
      locale: z.string().default("en"),
      site: z.string().optional(),
    },
    async (args: Record<string, unknown>) => ({
      content: [{ type: "text", text: JSON.stringify({ seen: args, ...(handler(args) as object) }) }],
    }),
  );
  return captured!;
}

/** Same answers the main app gives for the fixture below. */
const lookup: EntryRefLookup = async (q) => {
  if (q.ref === "array-vacio-javascript") {
    const explicitEn = q.localeExplicit && q.locale === "en";
    return {
      ok: true,
      contentType: "how-to",
      entry_id: "javascript-empty-array",
      locale: explicitEn ? "en" : "es",
      slug_locale: "es",
      matched_by: "locale_slug",
      warnings: [
        ...(explicitEn
          ? [{ code: "slug_locale_mismatch" as const, message: "es address", details: { slug_locale: "es" } }]
          : []),
        { code: "slug_resolved" as const, message: "resolved", details: { entry_id: "javascript-empty-array" } },
      ],
    };
  }
  if (q.ref === "same-address") {
    return { ok: false, reason: "ambiguous", candidates: ["how-to/a", "how-to/b"], message: "matches more than one" };
  }
  if (q.ref === "just-renamed") {
    return { ok: false, reason: "index_updating", message: "retry shortly" };
  }
  return { ok: false, reason: "not_found", message: "none" };
};

beforeEach(() => {
  fs.rmSync(contentPath, { recursive: true, force: true });
  write("content-types.yml", "how-to:\n  directory: how-to\n  url_pattern:\n    en: /en/how-to/:slug\n");
  write("how-to/javascript-empty-array/en.yml", "title: Empty\n");
  setMcpSiteConfigsForTest([{ domain: "entry-ref.test", contentFolder }]);
  setEntryRefLookupForTest(lookup);
});

afterEach(() => {
  setEntryRefLookupForTest(null);
  setMcpSiteConfigsForTest(null);
  fs.rmSync(contentPath, { recursive: true, force: true });
});

function parse(result: unknown): Record<string, unknown> {
  return JSON.parse((result as { content: [{ text: string }] }).content[0].text);
}

describe("entry ref tools", () => {
  it("passes an exact page ID straight through with the default locale", async () => {
    const t = register("get_entry_content", () => ({}));
    const body = parse(await t.handler({ slug: "javascript-empty-array" }));
    expect(body.seen).toMatchObject({ slug: "javascript-empty-array", locale: "en" });
    expect(body.warnings).toBeUndefined();
  });

  it("resolves a Spanish slug to the page ID and serves Spanish when no locale is passed", async () => {
    const t = register("get_entry_content", () => ({ warnings: [{ code: "other", message: "kept" }] }));
    const body = parse(await t.handler({ slug: "array-vacio-javascript" }));
    expect(body.seen).toMatchObject({ slug: "javascript-empty-array", contentType: "how-to", locale: "es" });
    expect((body.warnings as Array<{ code: string }>).map((w) => w.code)).toEqual(["slug_resolved", "other"]);
  });

  it("keeps an explicit locale and warns about the mismatch", async () => {
    const g = register("get_entry_fields", () => ({}));
    expect(g.shape.locale.isOptional()).toBe(true);
    const body = parse(await g.handler({ slug: "array-vacio-javascript", locale: "en" }));
    expect(body.seen).toMatchObject({ slug: "javascript-empty-array", locale: "en" });
    expect((body.warnings as Array<{ code: string }>).map((w) => w.code)).toEqual([
      "slug_locale_mismatch",
      "slug_resolved",
    ]);
  });

  it("refuses an ambiguous slug and reports a rebuilding index", async () => {
    const t = register("update_fields", () => ({}));
    const amb = parse(await t.handler({ slug: "same-address" }));
    expect(amb).toMatchObject({ success: false, code: "ambiguous_slug", candidates: ["how-to/a", "how-to/b"] });
    const upd = parse(await t.handler({ slug: "just-renamed" }));
    expect(upd).toMatchObject({ success: false, code: "index_updating" });
  });

  it("leaves unknown slugs to the tool's own not-found handling", async () => {
    const t = register("get_entry_seo", () => ({}));
    const body = parse(await t.handler({ slug: "nope" }));
    expect(body.seen).toMatchObject({ slug: "nope", locale: "en" });
  });

  it("does not resolve for creation tools", async () => {
    const t = register("create_entry", () => ({}));
    const body = parse(await t.handler({ slug: "array-vacio-javascript", locale: "en" }));
    expect(body.seen).toMatchObject({ slug: "array-vacio-javascript" });
  });
});
