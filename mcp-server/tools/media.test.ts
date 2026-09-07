import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import {
  countGallerySources,
  pickGallerySource,
  findGalleryImageByUrl,
  handleGetOrSetMediaToGallery,
  resolveMediaFileMeta,
  fetchPublicMedia,
  BYTES_MAX_BYTES,
} from "./media";
import {
  setMcpSiteConfigsForTest,
  resetMcpSiteConfigsCache,
} from "../lib/content.js";

describe("countGallerySources / pickGallerySource", () => {
  it("counts and picks a single source", () => {
    expect(countGallerySources({ prompt: "a cat" })).toBe(1);
    expect(pickGallerySource({ prompt: "a cat" })).toBe("prompt");
    expect(pickGallerySource({ media_id: "hero-1" })).toBe("media_id");
    expect(pickGallerySource({ url: "https://x.test/a.png" })).toBe("url");
    expect(pickGallerySource({ bytes_base64: "abc" })).toBe("bytes_base64");
  });

  it("rejects empty / whitespace-only", () => {
    expect(countGallerySources({ prompt: "  ", media_id: "" })).toBe(0);
    expect(pickGallerySource({})).toBeNull();
  });

  it("detects multiple sources", () => {
    expect(countGallerySources({ prompt: "x", url: "https://x.test/a.png" })).toBe(2);
    expect(countGallerySources({ media_id: "a", bytes_base64: "YQ==" })).toBe(2);
  });
});

describe("findGalleryImageByUrl", () => {
  const images = {
    "hero-local": {
      src: "/site/images/hero.webp",
      alt: "Hero",
    },
    "external-queued": {
      src: "",
      alt: "External",
      source_url: "https://partner.example/photo.jpg",
    },
    "cdn-hosted": {
      src: "https://cdn.example/assets/logo.png",
      alt: "Logo",
    },
  };

  it("matches source_url", () => {
    expect(findGalleryImageByUrl("https://partner.example/photo.jpg", images)).toBe(
      "external-queued",
    );
  });

  it("matches src full URL", () => {
    expect(findGalleryImageByUrl("https://cdn.example/assets/logo.png", images)).toBe(
      "cdn-hosted",
    );
  });

  it("matches local src with slash normalization", () => {
    expect(findGalleryImageByUrl("site/images/hero.webp", images)).toBe("hero-local");
    expect(findGalleryImageByUrl("/site/images/hero.webp", images)).toBe("hero-local");
  });

  it("returns null when no match", () => {
    expect(findGalleryImageByUrl("https://unknown.example/nope.jpg", images)).toBeNull();
  });
});

describe("resolveMediaFileMeta", () => {
  it("accepts a valid PDF", () => {
    const bytes = Buffer.from("%PDF-1.4 fake content");
    const meta = resolveMediaFileMeta({
      url: "https://cdn.example/docs/guide.pdf",
      contentType: "application/pdf",
      bytes,
    });
    expect(meta.ok).toBe(true);
    if (meta.ok) {
      expect(meta.ext).toBe(".pdf");
      expect(meta.mime).toBe("application/pdf");
    }
  });

  it("rejects HTML pretending to be a PDF", () => {
    const bytes = Buffer.from("<!DOCTYPE html><html><body>login</body></html>");
    const meta = resolveMediaFileMeta({
      url: "https://cdn.example/docs/guide.pdf",
      contentType: "text/html",
      bytes,
    });
    expect(meta.ok).toBe(false);
    if (!meta.ok) expect(meta.code).toBe("unsupported_media");
  });

  it("rejects non-PDF bytes with .pdf extension", () => {
    const bytes = Buffer.from("not a pdf at all");
    const meta = resolveMediaFileMeta({
      filenameHint: "guide.pdf",
      bytes,
    });
    expect(meta.ok).toBe(false);
    if (!meta.ok) expect(meta.code).toBe("unsupported_media");
  });
});

describe("fetchPublicMedia", () => {
  it("blocks private destinations", async () => {
    const fetchFn = vi.fn();
    const result = await fetchPublicMedia("http://127.0.0.1/secret.pdf", fetchFn as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("ssrf_blocked");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("re-checks redirect hops for SSRF", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("cdn.example")) {
        return new Response(null, {
          status: 302,
          headers: { Location: "http://169.254.169.254/latest/meta-data" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    const result = await fetchPublicMedia(
      "https://cdn.example/doc.pdf",
      fetchFn as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("ssrf_blocked");
  });

  it("downloads public bytes", async () => {
    const pdf = Buffer.from("%PDF-1.4 hello");
    const fetchFn = vi.fn(async () =>
      new Response(pdf, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="guide.pdf"',
        },
      }),
    );
    const result = await fetchPublicMedia(
      "https://cdn.example/guide.pdf",
      fetchFn as unknown as typeof fetch,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bytes.equals(pdf)).toBe(true);
      expect(result.filenameHint).toBe("guide.pdf");
    }
  });
});

describe("handleGetOrSetMediaToGallery", () => {
  let tmpDir: string;
  let contentFolder: string;

  beforeEach(() => {
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
          "external-test": {
            src: "",
            alt: "External test",
            source_url: "https://partner.example/photo.jpg",
          },
        },
      }),
      "utf8",
    );

    setMcpSiteConfigsForTest([{ domain: "test.example.com", contentFolder }]);
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
    const result = await handleGetOrSetMediaToGallery({}, { mcpToken: undefined });
    expect(result.isError).toBe(true);
    const body = parseResult(result);
    expect(body.code).toBe("pick_one_source");
  });

  it("fails when multiple sources provided", async () => {
    const result = await handleGetOrSetMediaToGallery(
      { media_id: "hero-test-01", prompt: "a dog" },
      { mcpToken: undefined },
    );
    expect(result.isError).toBe(true);
    const body = parseResult(result);
    expect(body.code).toBe("pick_one_source");
  });

  it("returns registry entry for media_id", async () => {
    const result = await handleGetOrSetMediaToGallery(
      { media_id: "hero-test-01", site: "test.example.com" },
      { mcpToken: undefined },
    );
    expect(result.isError).toBeUndefined();
    const body = parseResult(result);
    expect(body.success).toBe(true);
    expect(body.mode).toBe("media_id");
    expect(body.media_id).toBe("hero-test-01");
    expect((body.media as { alt: string }).alt).toBe("Hero test");
    expect(body.next_actions).toEqual([]);
  });

  it("fails when media_id missing from registry", async () => {
    const result = await handleGetOrSetMediaToGallery(
      { media_id: "missing-id", site: "test.example.com" },
      { mcpToken: undefined },
    );
    expect(result.isError).toBe(true);
    const body = parseResult(result);
    expect(body.code).toBe("media_not_found");
  });

  it("returns registry entry for url matching source_url (reuse, no fetch)", async () => {
    const fetchImpl = vi.fn();
    const result = await handleGetOrSetMediaToGallery(
      { url: "https://partner.example/photo.jpg", import: true, site: "test.example.com" },
      { mcpToken: undefined, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result.isError).toBeUndefined();
    const body = parseResult(result);
    expect(body.success).toBe(true);
    expect(body.mode).toBe("url");
    expect(body.media_id).toBe("external-test");
    expect(body.reused).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns url_not_in_gallery when url has no match and import is false", async () => {
    const result = await handleGetOrSetMediaToGallery(
      { url: "https://unknown.example/missing.jpg", site: "test.example.com" },
      { mcpToken: undefined },
    );
    expect(result.isError).toBeUndefined();
    const body = parseResult(result);
    expect(body.action_required).toBe("url_not_in_gallery");
    expect(body.code).toBe("url_not_in_gallery");
    const next = body.next_actions as Array<{ tool: string; args_hint?: { import?: boolean } }>;
    expect(next.some((a) => a.tool === "get_or_set_media_to_gallery" && a.args_hint?.import === true)).toBe(
      true,
    );
  });

  it("imports public URL on miss when import:true", async () => {
    const pdf = Buffer.from("%PDF-1.4 imported");
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("cdn.example") && (!init?.method || init.method === "GET")) {
        return new Response(pdf, {
          status: 200,
          headers: { "Content-Type": "application/pdf" },
        });
      }
      if (url.includes("/api/image-registry/upload")) {
        return new Response(
          JSON.stringify({
            id: "guide-pdf",
            src: "/.tmp-mcp-gallery-test/images/guide.pdf",
            alt: "Document: guide",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const result = await handleGetOrSetMediaToGallery(
      { url: "https://cdn.example/guide.pdf", import: true, site: "test.example.com" },
      { mcpToken: undefined, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result.isError).toBeUndefined();
    const body = parseResult(result);
    expect(body.success).toBe(true);
    expect(body.media_id).toBe("guide-pdf");
    expect(body.imported).toBe(true);
    expect(body.src).toBe("/.tmp-mcp-gallery-test/images/guide.pdf");
  });

  it("rejects HTML body on URL import", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("<!DOCTYPE html><html></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );
    const result = await handleGetOrSetMediaToGallery(
      { url: "https://cdn.example/guide.pdf", import: true, site: "test.example.com" },
      { mcpToken: undefined, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result.isError).toBe(true);
    const body = parseResult(result);
    expect(body.code).toBe("unsupported_media");
  });

  it("bytes_base64 uploads and returns media_id", async () => {
    const pdf = Buffer.from("%PDF-1.4 bytes");
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/image-registry/upload")) {
        return new Response(
          JSON.stringify({
            id: "upload-pdf",
            src: "/.tmp-mcp-gallery-test/images/upload.pdf",
            alt: "Document: upload",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const result = await handleGetOrSetMediaToGallery(
      {
        bytes_base64: pdf.toString("base64"),
        filename: "upload.pdf",
        site: "test.example.com",
      },
      { mcpToken: undefined, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result.isError).toBeUndefined();
    const body = parseResult(result);
    expect(body.success).toBe(true);
    expect(body.mode).toBe("bytes_base64");
    expect(body.media_id).toBe("upload-pdf");
  });

  it("bytes_base64 requires filename", async () => {
    const result = await handleGetOrSetMediaToGallery(
      { bytes_base64: Buffer.from("%PDF-1.4").toString("base64"), site: "test.example.com" },
      { mcpToken: undefined },
    );
    expect(result.isError).toBe(true);
    expect(parseResult(result).code).toBe("filename_required");
  });

  it("bytes_base64 rejects oversized payload", async () => {
    const big = Buffer.alloc(BYTES_MAX_BYTES + 1, 1);
    // Pretend PDF header so we fail on size before type if we check size first
    big.write("%PDF-", 0);
    const result = await handleGetOrSetMediaToGallery(
      {
        bytes_base64: big.toString("base64"),
        filename: "huge.pdf",
        site: "test.example.com",
      },
      { mcpToken: undefined },
    );
    expect(result.isError).toBe(true);
    expect(parseResult(result).code).toBe("too_large");
  });

  it("prompt path generates n=1, uploads origin=ai, returns media_id", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/media/generate-images")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { n?: number; prompt?: string };
        expect(body.n).toBe(1);
        expect(body.prompt).toBe("a red bicycle");
        return new Response(
          JSON.stringify({
            model: "google/gemini-2.5-flash-image",
            candidates: [
              { b64: Buffer.from("fake-webp-bytes").toString("base64"), mediaType: "image/webp" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/api/image-registry/upload")) {
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

    const result = await handleGetOrSetMediaToGallery(
      { prompt: "a red bicycle", site: "test.example.com" },
      { mcpToken: undefined, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result.isError).toBeUndefined();
    const body = parseResult(result);
    expect(body.success).toBe(true);
    expect(body.mode).toBe("prompt");
    expect(body.media_id).toBe("ai-123");
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
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: "API key not configured",
            code: "image_generation_not_configured",
            hint: "Add model.image in llm.yml",
          }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        ),
    );

    const result = await handleGetOrSetMediaToGallery(
      { prompt: "anything", site: "test.example.com" },
      { mcpToken: undefined, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result.isError).toBe(true);
    const body = parseResult(result);
    expect(body.code).toBe("image_generation_not_configured");
  });

  it("prompt path returns rate_limited when generate-images returns 429", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: "Too many image generations",
            code: "rate_limited",
            policy: "expensiveAi",
            retry_after_sec: 3600,
          }),
          { status: 429, headers: { "Content-Type": "application/json" } },
        ),
    );

    const result = await handleGetOrSetMediaToGallery(
      { prompt: "anything", site: "test.example.com" },
      { mcpToken: undefined, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result.isError).toBe(true);
    const body = parseResult(result);
    expect(body.code).toBe("rate_limited");
    expect(body.retry_after_sec).toBe(3600);
  });
});
