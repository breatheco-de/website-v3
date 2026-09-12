import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { handleListMedia } from "./list-media-handler.js";
import {
  setMcpSiteConfigsForTest,
  resetMcpSiteConfigsCache,
} from "./content.js";

const allowView = async () => null;

describe("handleListMedia", () => {
  let tmpDir: string;
  let contentFolder: string;

  beforeEach(() => {
    const siteDir = path.join(process.cwd(), ".tmp-mcp-list-media-handler-test");
    if (fs.existsSync(siteDir)) fs.rmSync(siteDir, { recursive: true, force: true });
    fs.mkdirSync(siteDir, { recursive: true });
    contentFolder = ".tmp-mcp-list-media-handler-test";
    tmpDir = siteDir;

    fs.writeFileSync(
      path.join(siteDir, "image-registry.json"),
      JSON.stringify({
        presets: {},
        tagDefinitions: {
          hero: { label: "Hero", description: "", presets: [] },
          press: { label: "Press", description: "", presets: [] },
        },
        images: {
          "hero-1": {
            src: "/.tmp-mcp-list-media-handler-test/images/hero.webp",
            alt: "Hero one",
            tags: ["hero"],
            registered_at: "2026-09-10T00:00:00.000Z",
            usage_count: 1,
            origin: "upload",
          },
          "ai-1": {
            src: "/.tmp-mcp-list-media-handler-test/images/ai.webp",
            alt: "AI art",
            tags: ["press"],
            origin: "ai",
            ai: {
              generated: true,
              generated_at: "2026-09-12T00:00:00.000Z",
              requested_by: { kind: "user", id: "u1", name: "Ada" },
            },
          },
          "crop-1": {
            src: "/.tmp-mcp-list-media-handler-test/images/hero-crop.webp",
            alt: "Crop",
            tags: ["hero"],
            parentId: "hero-1",
            registered_at: "2026-09-11T00:00:00.000Z",
          },
        },
      }),
      "utf8",
    );

    setMcpSiteConfigsForTest([{ domain: "list-media.test", contentFolder }]);
  });

  afterEach(() => {
    resetMcpSiteConfigsCache();
    setMcpSiteConfigsForTest(null);
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function parseResult(result: { content: Array<{ text: string }> }) {
    return JSON.parse(result.content[0].text) as Record<string, unknown>;
  }

  it("lists slim rows and hides derived by default", async () => {
    const result = await handleListMedia(
      { site: "list-media.test", sort: "name" },
      { checkContentView: allowView },
    );
    const body = parseResult(result);
    expect(body.success).toBe(true);
    const items = body.items as Array<{ media_id: string }>;
    expect(items.map((i) => i.media_id)).toEqual(["ai-1", "hero-1"]);
    expect(body.available_tags).toEqual(["hero", "press"]);
    expect(body.total).toBe(2);
    const warnings = body.warnings as Array<{ code: string }>;
    expect(warnings.some((w) => w.code === "inventory_only")).toBe(true);
    expect(body.next_actions).toEqual([]);
  });

  it("warns on unknown tags and returns empty", async () => {
    const result = await handleListMedia(
      { site: "list-media.test", tags: ["nope"] },
      { checkContentView: allowView },
    );
    const body = parseResult(result);
    expect(body.success).toBe(true);
    expect(body.total).toBe(0);
    const warnings = body.warnings as Array<{ code: string }>;
    expect(warnings.some((w) => w.code === "unknown_tags")).toBe(true);
  });

  it("suggests detail next_action for a single match", async () => {
    const result = await handleListMedia(
      { site: "list-media.test", q: "Ada" },
      { checkContentView: allowView },
    );
    const body = parseResult(result);
    expect(body.total).toBe(1);
    const next = body.next_actions as Array<{ tool: string; args_hint?: { media_id?: string } }>;
    expect(next).toHaveLength(1);
    expect(next[0].tool).toBe("get_or_set_media_to_gallery");
    expect(next[0].args_hint?.media_id).toBe("ai-1");
  });

  it("returns empty page past the end", async () => {
    const result = await handleListMedia(
      { site: "list-media.test", page: 9, page_size: 10 },
      { checkContentView: allowView },
    );
    const body = parseResult(result);
    expect(body.success).toBe(true);
    expect(body.items).toEqual([]);
    expect(body.has_more).toBe(false);
    expect(body.total).toBe(2);
  });

  it("fails when registry is missing", async () => {
    fs.rmSync(path.join(tmpDir, "image-registry.json"));
    const result = await handleListMedia(
      { site: "list-media.test" },
      { checkContentView: allowView },
    );
    const body = parseResult(result);
    expect(body.success).toBe(false);
    expect(body.code).toBe("registry_missing");
  });

  it("fails when registry JSON is corrupt", async () => {
    fs.writeFileSync(path.join(tmpDir, "image-registry.json"), "{not-json");
    const result = await handleListMedia(
      { site: "list-media.test" },
      { checkContentView: allowView },
    );
    const body = parseResult(result);
    expect(body.success).toBe(false);
    expect(body.code).toBe("registry_missing");
  });

  it("treats valid empty gallery as success with total 0", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "image-registry.json"),
      JSON.stringify({ presets: {}, images: {} }),
      "utf8",
    );
    const result = await handleListMedia(
      { site: "list-media.test" },
      { checkContentView: allowView },
    );
    const body = parseResult(result);
    expect(body.success).toBe(true);
    expect(body.total).toBe(0);
    expect(body.items).toEqual([]);
  });
});
