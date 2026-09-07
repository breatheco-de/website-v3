import { describe, expect, it } from "vitest";
import {
  EntryPreviewManager,
  applyEntryPreviewOgImage,
  type EntryPreviewMeta,
} from "./entry-preview-manager";

function meta(partial: Partial<EntryPreviewMeta>): EntryPreviewMeta {
  return {
    url: partial.url ?? "",
    capturedAt: partial.capturedAt ?? "",
    dirty: partial.dirty ?? false,
    width: partial.width ?? 1200,
    locale: partial.locale ?? "en",
    propsHash: partial.propsHash,
    failedAt: partial.failedAt,
    error: partial.error,
    attempts: partial.attempts,
  };
}

describe("EntryPreviewManager.needsCapture", () => {
  const manager = new EntryPreviewManager("/tmp/unused", {} as never);

  it("needs capture when meta missing", () => {
    expect(manager.needsCapture(null, undefined, true)).toBe(true);
  });

  it("needs capture when dirty", () => {
    expect(manager.needsCapture(meta({ url: "https://x/a.webp", dirty: true }), "abc", true)).toBe(
      true,
    );
  });

  it("does not auto-retry when failed", () => {
    expect(
      manager.needsCapture(
        meta({ url: "", failedAt: "2026-01-01T00:00:00.000Z", error: "boom" }),
        "abc",
        true,
      ),
    ).toBe(false);
  });

  it("needs capture when props hash drifts with dirtyOnPropChange", () => {
    expect(
      manager.needsCapture(meta({ url: "https://x/a.webp", propsHash: "old" }), "new", true),
    ).toBe(true);
  });

  it("skips when fresh and hash matches", () => {
    expect(
      manager.needsCapture(meta({ url: "https://x/a.webp", propsHash: "same" }), "same", true),
    ).toBe(false);
  });
});

describe("applyEntryPreviewOgImage", () => {
  it("fills meta.og_image from generated without writing cover image", async () => {
    const generated = "https://cdn.example.com/entry-previews/x.webp";
    const manager = {
      resolveEffectiveOgImage: async () => ({ url: generated, source: "generated" as const }),
    } as unknown as EntryPreviewManager;

    const entry: Record<string, unknown> = { slug: "hello", image: "https://cdn.example.com/cover.webp" };
    const pageData: Record<string, unknown> = { meta: {} };

    const url = await applyEntryPreviewOgImage(manager, {
      contentType: "blog",
      entry,
      previewConfig: { component: "og_image_preview" },
      pageData,
      skipHeadCheck: true,
    });

    expect(url).toBe(generated);
    expect((pageData.meta as { og_image: string }).og_image).toBe(generated);
    expect(entry.image).toBe("https://cdn.example.com/cover.webp");
  });

  it("keeps existing usable meta.og_image", async () => {
    const manager = {
      resolveEffectiveOgImage: async () => ({
        url: "https://cdn.example.com/gen.webp",
        source: "generated" as const,
      }),
    } as unknown as EntryPreviewManager;

    const existing = "https://cdn.example.com/custom-og.webp";
    const pageData: Record<string, unknown> = { meta: { og_image: existing } };
    const url = await applyEntryPreviewOgImage(manager, {
      contentType: "blog",
      entry: { slug: "hello" },
      previewConfig: { component: "og_image_preview" },
      pageData,
      skipHeadCheck: true,
    });
    expect(url).toBe(existing);
    expect((pageData.meta as { og_image: string }).og_image).toBe(existing);
  });
});
