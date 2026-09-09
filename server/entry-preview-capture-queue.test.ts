import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getPreviewConfig: vi.fn(),
  isPreviewCaptureReady: vi.fn(() => true),
  cloudflareBrowserConfigError: vi.fn(() => null as string | null),
  getMeta: vi.fn(),
  needsCapture: vi.fn(),
  markDirty: vi.fn(),
  enqueueEntryPreviewCapture: vi.fn(),
  hashPreviewProps: vi.fn(() => "hash"),
  buildPreviewPropResolveContext: vi.fn(async () => ({ entry: {} })),
  isHandPickedOgImage: vi.fn(() => false),
}));

vi.mock("./content-types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./content-types")>();
  return {
    ...actual,
    getPreviewConfig: mocks.getPreviewConfig,
    getLocaleKey: () => "lang",
    getContentTypeConfig: () => ({ folder: "blog" }),
  };
});
vi.mock("./entry-preview-config", () => ({
  isPreviewCaptureReady: mocks.isPreviewCaptureReady,
}));
vi.mock("./cloudflare-browser", () => ({
  cloudflareBrowserConfigError: mocks.cloudflareBrowserConfigError,
  captureScreenshotToWebp: vi.fn(),
}));
vi.mock("./entry-preview-manager", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./entry-preview-manager")>();
  return {
    ...actual,
    hashPreviewProps: mocks.hashPreviewProps,
    DEFAULT_PREVIEW_WIDTH: 1200,
  };
});
vi.mock("./entry-preview-og-yaml", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./entry-preview-og-yaml")>();
  return {
    ...actual,
    isHandPickedOgImage: mocks.isHandPickedOgImage,
    persistGeneratedOgImageToEntryYaml: vi.fn(),
  };
});
vi.mock("./entry-preview-resolve", () => ({
  buildPreviewPropResolveContext: mocks.buildPreviewPropResolveContext,
}));
vi.mock("./settings", () => ({
  normalizeLocale: (l: string) => l,
  getEntryPreviewSettings: () => ({ max_concurrency: 1, min_interval_ms: 0, max_retries: 1 }),
}));
vi.mock("./query-entries", () => ({
  queryEntries: vi.fn(async (q: { from: { contentType: string }; locale?: string }) => {
    const locale = q.locale;
    if (!locale) {
      return {
        items: [
          { slug: "foo", lang: "en" },
          { slug: "foo", lang: "es" },
          { slug: "bar", lang: "en" },
          { slug: "bar", lang: "es" },
        ],
      };
    }
    return {
      items: [
        { slug: "foo", lang: locale },
        { slug: "bar", lang: locale },
      ],
    };
  }),
}));

import {
  enqueueEntryPreviewCapture,
  enqueueEntryPreviewsForType,
  maybeEnqueueAfterEntrySave,
  entryPreviewJobKey,
} from "./entry-preview-capture-queue";
import type { SiteContext } from "./site-manager";

function siteStub(): SiteContext {
  return {
    contentRoot: "/tmp/site",
    contentRootName: "site_test",
    entryPreviewManager: {
      getMeta: mocks.getMeta,
      needsCapture: mocks.needsCapture,
      markDirty: mocks.markDirty,
    },
    database: {},
    contentIndex: {},
    mediaGallery: {},
    autoCommitQueue: { queue: vi.fn() },
  } as unknown as SiteContext;
}

describe("maybeEnqueueAfterEntrySave", () => {
  beforeEach(() => {
    mocks.getPreviewConfig.mockReturnValue({
      component: "og_image_preview",
      props: { title: "title" },
      theme: "dark",
      widths: [1200],
    });
    mocks.isPreviewCaptureReady.mockReturnValue(true);
    mocks.cloudflareBrowserConfigError.mockReturnValue(null);
    mocks.isHandPickedOgImage.mockReturnValue(false);
    mocks.getMeta.mockResolvedValue(null);
    mocks.needsCapture.mockReturnValue(true);
    mocks.markDirty.mockResolvedValue({});
  });

  it("returns capture_misconfigured when CF not ready", async () => {
    mocks.cloudflareBrowserConfigError.mockReturnValue("SITE_URL required");
    const r = await maybeEnqueueAfterEntrySave(siteStub(), {
      contentType: "blog",
      slug: "a",
      locale: "en",
      entry: { slug: "a" },
    });
    expect(r).toEqual({ enqueued: false, reason: "capture_misconfigured" });
  });

  it("skips hand-picked social", async () => {
    mocks.isHandPickedOgImage.mockReturnValue(true);
    const r = await maybeEnqueueAfterEntrySave(siteStub(), {
      contentType: "blog",
      slug: "a",
      locale: "en",
      entry: { slug: "a", meta: { og_image: "https://cdn.example.com/custom.webp" } },
    });
    expect(r.reason).toBe("editorial_image");
    expect(r.enqueued).toBe(false);
  });

  it("skips failed until retry", async () => {
    mocks.getMeta.mockResolvedValue({
      url: "",
      failedAt: "2026-01-01T00:00:00.000Z",
      dirty: false,
      width: 1200,
      locale: "en",
    });
    const r = await maybeEnqueueAfterEntrySave(siteStub(), {
      contentType: "blog",
      slug: "a",
      locale: "en",
      entry: { slug: "a" },
    });
    expect(r).toEqual({ enqueued: false, reason: "failed_until_retry" });
  });

  it("skips when not needed", async () => {
    mocks.getMeta.mockResolvedValue({
      url: "https://x/a.webp",
      dirty: false,
      propsHash: "hash",
      width: 1200,
      locale: "en",
      capturedAt: "2026-01-01T00:00:00.000Z",
    });
    mocks.needsCapture.mockReturnValue(false);
    const r = await maybeEnqueueAfterEntrySave(siteStub(), {
      contentType: "blog",
      slug: "a",
      locale: "en",
      entry: { slug: "a" },
    });
    expect(r.reason).toBe("not_needed");
  });
});

describe("enqueueEntryPreviewCapture idempotency", () => {
  it("does not enqueue duplicate keys", () => {
    const site = siteStub();
    const job = {
      contentType: "blog",
      slug: "post",
      locale: "en",
      width: 1200,
    };
    const first = enqueueEntryPreviewCapture(site, job);
    expect(first.enqueued).toBe(true);
    const second = enqueueEntryPreviewCapture(site, job);
    expect(second.enqueued).toBe(false);
    expect(second.reason).toBe("already_queued");
    expect(entryPreviewJobKey("site_test", "blog", "post", "en", 1200)).toBe(first.key);
  });
});

describe("enqueueEntryPreviewsForType pairs", () => {
  beforeEach(() => {
    mocks.getPreviewConfig.mockReturnValue({
      component: "og_image_preview",
      props: { title: "title" },
      theme: "dark",
      widths: [1200],
    });
    mocks.isPreviewCaptureReady.mockReturnValue(true);
    mocks.cloudflareBrowserConfigError.mockReturnValue(null);
    mocks.isHandPickedOgImage.mockReturnValue(false);
    mocks.getMeta.mockResolvedValue(null);
    mocks.needsCapture.mockReturnValue(true);
    mocks.markDirty.mockResolvedValue({});
    mocks.enqueueEntryPreviewCapture.mockClear();
  });

  it("enqueues only exact pairs (no slug×locale cross product)", async () => {
    const enqueuedKeys: string[] = [];
    // Use real enqueue via module — spy markDirty calls by locale+slug through getMeta
    const seen: string[] = [];
    mocks.getMeta.mockImplementation(async (_ct: string, slug: string, locale: string) => {
      seen.push(`${slug}:${locale}`);
      return null;
    });

    const result = await enqueueEntryPreviewsForType(siteStub(), {
      contentType: "blog",
      locales: ["en", "es"],
      pairs: [
        { slug: "foo", locale: "en" },
        { slug: "bar", locale: "es" },
      ],
      mode: "all",
      overwrite: false,
    });

    expect(seen.sort()).toEqual(["bar:es", "foo:en"]);
    expect(result.enqueued.length).toBe(2);
    expect(result.enqueued.some((k) => k.includes("foo") && k.includes("en"))).toBe(true);
    expect(result.enqueued.some((k) => k.includes("bar") && k.includes("es"))).toBe(true);
  });

  it("skips editorial images when overwrite is false", async () => {
    mocks.isHandPickedOgImage.mockReturnValue(true);
    const result = await enqueueEntryPreviewsForType(siteStub(), {
      contentType: "blog",
      locales: ["en"],
      pairs: [{ slug: "foo", locale: "en" }],
      mode: "all",
      overwrite: false,
    });
    expect(result.enqueued).toEqual([]);
    expect(result.skipped).toEqual([
      { slug: "foo", locale: "en", reason: "editorial_image" },
    ]);
  });
});
