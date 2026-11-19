import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LLM_STASHED_LOCATION_KEY,
  PREVIEW_MODE_PARAM,
  PREVIEW_MODE_STORAGE_KEY,
  buildShareablePreviewUrl,
  clearStoredPreviewMode,
  decidePreviewUrlSync,
  parsePreviewModeParam,
  persistPreviewMode,
  previewModeFromEditState,
  previewModeToParam,
  readStoredPreviewMode,
  stashLocationForLlm,
  takeStashedLocationForLlm,
} from "./preview-mode";

describe("parsePreviewModeParam", () => {
  it("parses desktop, llm, and device ids", () => {
    expect(parsePreviewModeParam("desktop")).toEqual({ kind: "desktop" });
    expect(parsePreviewModeParam("llm")).toEqual({ kind: "llm" });
    expect(parsePreviewModeParam("iphone-se")).toEqual({
      kind: "device",
      deviceId: "iphone-se",
    });
  });

  it("returns null for missing or unknown values", () => {
    expect(parsePreviewModeParam(null)).toBeNull();
    expect(parsePreviewModeParam("")).toBeNull();
    expect(parsePreviewModeParam("nokia-3310")).toBeNull();
  });
});

describe("previewModeFromEditState / previewModeToParam", () => {
  it("maps edit state to mode and back to param", () => {
    expect(
      previewModeToParam(
        previewModeFromEditState({
          previewBreakpoint: "desktop",
          previewDeviceId: "iphone-se",
          isLlmPreview: true,
        }),
      ),
    ).toBe("llm");
    expect(
      previewModeToParam(
        previewModeFromEditState({
          previewBreakpoint: "mobile",
          previewDeviceId: "ipad-mini",
          isLlmPreview: false,
        }),
      ),
    ).toBe("ipad-mini");
    expect(
      previewModeToParam(
        previewModeFromEditState({
          previewBreakpoint: "desktop",
          previewDeviceId: "iphone-se",
          isLlmPreview: false,
        }),
      ),
    ).toBe("desktop");
  });
});

describe("buildShareablePreviewUrl", () => {
  it("sets preview_mode and strips location for LLM shares", () => {
    const url = buildShareablePreviewUrl({
      origin: "https://example.com",
      pathname: "/private/preview/landing/foo",
      search: "?locale=en&location=mexicocity-mexico&edit=1",
      mode: { kind: "llm" },
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get(PREVIEW_MODE_PARAM)).toBe("llm");
    expect(parsed.searchParams.get("location")).toBeNull();
    expect(parsed.searchParams.get("locale")).toBe("en");
    expect(parsed.searchParams.get("edit")).toBeNull();
  });

  it("keeps location for device shares", () => {
    const url = buildShareablePreviewUrl({
      origin: "https://example.com",
      pathname: "/private/preview/landing/foo",
      search: "?locale=en&location=madrid-spain",
      mode: { kind: "device", deviceId: "iphone-se" },
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get(PREVIEW_MODE_PARAM)).toBe("iphone-se");
    expect(parsed.searchParams.get("location")).toBe("madrid-spain");
  });
});

describe("LLM location stash", () => {
  const store = new Map<string, string>();

  afterEach(() => {
    store.clear();
    vi.unstubAllGlobals();
  });

  it("remembers and clears campus for the same browser session", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });
    stashLocationForLlm("bogota-colombia");
    expect(store.get(LLM_STASHED_LOCATION_KEY)).toBe("bogota-colombia");
    expect(takeStashedLocationForLlm()).toBe("bogota-colombia");
    expect(store.has(LLM_STASHED_LOCATION_KEY)).toBe(false);
  });
});

describe("preview mode localStorage", () => {
  const store = new Map<string, string>();

  afterEach(() => {
    store.clear();
    vi.unstubAllGlobals();
  });

  it("persists and restores llm so refresh can recover without the query param", () => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });
    persistPreviewMode({ kind: "llm" });
    expect(store.get(PREVIEW_MODE_STORAGE_KEY)).toBe("llm");
    expect(readStoredPreviewMode()).toEqual({ kind: "llm" });
    clearStoredPreviewMode();
    expect(readStoredPreviewMode()).toBeNull();
  });
});

describe("decidePreviewUrlSync", () => {
  it("re-stamps llm on public content pages when the param was dropped", () => {
    expect(
      decidePreviewUrlSync({
        pathname: "/us/coding-bootcamp",
        mode: null,
        isLlmPreview: true,
      }),
    ).toEqual({ action: "restamp-llm" });
  });

  it("applies llm from the URL on public pages", () => {
    expect(
      decidePreviewUrlSync({
        pathname: "/us/coding-bootcamp",
        mode: { kind: "llm" },
        isLlmPreview: false,
      }),
    ).toEqual({ action: "apply-llm", stripLocation: true });
  });

  it("ignores desktop and device modes on public pages", () => {
    expect(
      decidePreviewUrlSync({
        pathname: "/us/coding-bootcamp",
        mode: { kind: "desktop" },
        isLlmPreview: false,
      }),
    ).toEqual({ action: "ignore" });
    expect(
      decidePreviewUrlSync({
        pathname: "/us/coding-bootcamp",
        mode: { kind: "device", deviceId: "iphone-se" },
        isLlmPreview: false,
      }),
    ).toEqual({ action: "ignore" });
  });

  it("ignores admin private paths", () => {
    expect(
      decidePreviewUrlSync({
        pathname: "/private/settings",
        mode: { kind: "llm" },
        isLlmPreview: true,
      }),
    ).toEqual({ action: "ignore" });
  });

  it("handles private preview desktop and device", () => {
    expect(
      decidePreviewUrlSync({
        pathname: "/private/preview/page/home",
        mode: { kind: "desktop" },
        isLlmPreview: true,
      }),
    ).toEqual({ action: "apply-desktop" });
    expect(
      decidePreviewUrlSync({
        pathname: "/private/preview/page/home",
        mode: { kind: "device", deviceId: "ipad-mini" },
        isLlmPreview: false,
      }),
    ).toEqual({ action: "apply-device", deviceId: "ipad-mini" });
  });
});
