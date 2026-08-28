import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  countGallerySources,
  pickGallerySource,
  handleGetOrSetImageToGallery,
} from "./media";
import {
  setMcpSiteConfigsForTest,
  resetMcpSiteConfigsCache,
} from "../lib/content.js";

describe("countGallerySources / pickGallerySource", () => {
  it("counts and picks a single source", () => {
    expect(countGallerySources({ prompt: "a cat" })).toBe(1);
    expect(pickGallerySource({ prompt: "a cat" })).toBe("prompt");
    expect(pickGallerySource({ image_id: "hero-1" })).toBe("image_id");
    expect(pickGallerySource({ url: "https://x.test/a.png" })).toBe("url");
  });

  it("rejects empty / whitespace-only", () => {
    expect(countGallerySources({ prompt: "  ", image_id: "" })).toBe(0);
    expect(pickGallerySource({})).toBeNull();
  });

  it("detects multiple sources", () => {
    expect(countGallerySources({ prompt: "x", url: "https://x.test/a.png" })).toBe(2);
  });
});

describe("handleGetOrSetImageToGallery", () => {
  let tmpDir: string;
  let contentFolder: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-gallery-"));
    contentFolder = path.basename(tmpDir);
    // resolveSiteContext joins cwd + contentFolder — symlink or use real folder under cwd
    // Instead set configs with absolute path via contentFolder relative to cwd.
    // Use a folder under process.cwd() for the test.
    const siteDir = path.join(process.cwd(), ".tmp-mcp-gallery-test");
    if (fs.existsSync(siteDir)) fs.rmSync(siteDir, { recursive: true, force: true });
    fs.mkdirSync(siteDir, { recursive: true });
    contentFolder = ".tmp-mcp-gallery-test";
    tmpDir = siteDir;

    fs.writeFileSync(
      path.join(siteDir, "image-registry.json"),
      JSON.stringify({
        presets: {},
        images: {
          "hero-test-01": {
            src: "/.tmp-mcp-gallery-test/images/hero.webp",
            alt: "Hero test",
            tags: ["hero"],
          },
        },
      }),
      "utf8",
    );

    setMcpSiteConfigsForTest([
      { domain: "test.example.com", contentFolder },
    ]);
  });

  afterEach(() => {
    resetMcpSiteConfigsCache();
    setMcpSiteConfigsForTest(null);
    const siteDir = path.join(process.cwd(), ".tmp-mcp-gallery-test");
    if (fs.existsSync(siteDir)) fs.rmSync(siteDir, { recursive: true, force: true });
  });

  function parseResult(result: { content: [{ text: string }]; isError?: true }) {
    return JSON.parse(result.content[0].text) as Record<string, unknown>;
  }

  it("fails when no source provided", async () => {
    const result = await handleGetOrSetImageToGallery({}, { mcpToken: undefined });
    expect(result.isError).toBe(true);
    const body = parseResult(result);
    expect(body.code).toBe("pick_one_source");
  });

  it("fails when multiple sources provided", async () => {
    const result = await handleGetOrSetImageToGallery(
      { image_id: "hero-test-01", prompt: "a dog" },
      { mcpToken: undefined },
    );
    expect(result.isError).toBe(true);
    const body = parseResult(result);
    expect(body.code).toBe("pick_one_source");
  });

  it("returns registry entry for image_id", async () => {
    const result = await handleGetOrSetImageToGallery(
      { image_id: "hero-test-01", site: "test.example.com" },
      { mcpToken: undefined },
    );
    expect(result.isError).toBeUndefined();
    const body = parseResult(result);
    expect(body.success).toBe(true);
    expect(body.image_id).toBe("hero-test-01");
    expect((body.image as { alt: string }).alt).toBe("Hero test");
    expect(body.next_actions).toEqual([]);
  });

  it("fails when image_id missing from registry", async () => {
    const result = await handleGetOrSetImageToGallery(
      { image_id: "missing-id", site: "test.example.com" },
      { mcpToken: undefined },
    );
    expect(result.isError).toBe(true);
    const body = parseResult(result);
    expect(body.code).toBe("image_not_found");
  });

  it("returns under_development for url", async () => {
    const result = await handleGetOrSetImageToGallery(
      { url: "https://partner.example/photo.jpg", site: "test.example.com" },
      { mcpToken: undefined },
    );
    expect(result.isError).toBeUndefined();
    const body = parseResult(result);
    expect(body.action_required).toBe("under_development");
    expect(body.code).toBe("under_development");
    expect(Array.isArray(body.next_actions)).toBe(true);
  });

  it("prompt path generates n=1, uploads origin=ai, returns image_id", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/media/generate-images")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { n?: number; prompt?: string };
        expect(body.n).toBe(1);
        expect(body.prompt).toBe("a red bicycle");
        return new Response(
          JSON.stringify({
            model: "google/gemini-2.5-flash-image",
            candidates: [{ b64: Buffer.from("fake-webp-bytes").toString("base64"), mediaType: "image/webp" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/api/image-registry/upload")) {
        // FormData body — ensure origin=ai was intended (checked via successful mock)
        return new Response(
          JSON.stringify({
            id: "ai-123",
            src: "/.tmp-mcp-gallery-test/images/ai-123.webp",
            alt: "a red bicycle",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const result = await handleGetOrSetImageToGallery(
      { prompt: "a red bicycle", site: "test.example.com" },
      { mcpToken: undefined, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result.isError).toBeUndefined();
    const body = parseResult(result);
    expect(body.success).toBe(true);
    expect(body.mode).toBe("prompt");
    expect(body.image_id).toBe("ai-123");
    expect(body.model).toBe("google/gemini-2.5-flash-image");
    const warnings = body.warnings as Array<{ code: string }>;
    expect(warnings.some((w) => w.code === "no_yaml_attach")).toBe(true);
    expect(warnings.some((w) => w.code === "ai_gc_grace")).toBe(true);
    const sideEffects = body.side_effects as Array<{ kind: string }>;
    expect(sideEffects.some((s) => s.kind === "gallery_register")).toBe(true);
    expect(sideEffects.some((s) => s.kind === "enqueue_ai_image_gc")).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("prompt path fails clearly when generation not configured", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: "API key not configured",
          code: "image_generation_not_configured",
          hint: "Add model.image in llm.yml",
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await handleGetOrSetImageToGallery(
      { prompt: "anything", site: "test.example.com" },
      { mcpToken: undefined, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result.isError).toBe(true);
    const body = parseResult(result);
    expect(body.code).toBe("image_generation_not_configured");
  });
});
