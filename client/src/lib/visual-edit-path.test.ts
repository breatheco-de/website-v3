import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildPrivatePreviewHref, enterVisualEditMode, isPrivatePreviewPath, isVisualEditPath } from "./visual-edit-path";
import { saveEditModeScrollPosition } from "./editModeScroll";

vi.mock("./editModeScroll", () => ({
  saveEditModeScrollPosition: vi.fn(),
}));

describe("isVisualEditPath", () => {
  it("allows public content pages", () => {
    expect(isVisualEditPath("/")).toBe(true);
    expect(isVisualEditPath("/en/coding-bootcamp")).toBe(true);
    expect(isVisualEditPath("/es/us/miami")).toBe(true);
  });

  it("allows the visual preview route", () => {
    expect(isVisualEditPath("/private/preview")).toBe(true);
    expect(isVisualEditPath("/private/preview/page/home")).toBe(true);
    expect(isVisualEditPath("/private/preview/program/ai-engineering")).toBe(true);
  });

  it("hides edit chrome on admin private pages", () => {
    expect(isVisualEditPath("/private")).toBe(false);
    expect(isVisualEditPath("/private/diagnostics")).toBe(false);
    expect(isVisualEditPath("/private/diagnostics/runtime-issues")).toBe(false);
    expect(isVisualEditPath("/private/settings")).toBe(false);
    expect(isVisualEditPath("/private/media-gallery")).toBe(false);
    expect(isVisualEditPath("/private/type/blog")).toBe(false);
  });
});

describe("isPrivatePreviewPath", () => {
  it("matches the visual preview route only", () => {
    expect(isPrivatePreviewPath("/private/preview")).toBe(true);
    expect(isPrivatePreviewPath("/private/preview/page/apply")).toBe(true);
    expect(isPrivatePreviewPath("/en/apply")).toBe(false);
    expect(isPrivatePreviewPath("/private/settings")).toBe(false);
  });
});

describe("buildPrivatePreviewHref", () => {
  it("maps a public locale path to /private/preview/{type}/{slug}", () => {
    expect(
      buildPrivatePreviewHref({
        contentType: "page",
        slug: "apply",
        pathname: "/en/apply",
      }),
    ).toBe("/private/preview/page/apply?locale=en");
  });

  it("uses the path locale over fallback", () => {
    expect(
      buildPrivatePreviewHref({
        contentType: "page",
        slug: "apply",
        pathname: "/es/apply",
        fallbackLocale: "en",
      }),
    ).toBe("/private/preview/page/apply?locale=es");
  });

  it("keeps variant (or force_variant) from the current search", () => {
    expect(
      buildPrivatePreviewHref({
        contentType: "page",
        slug: "apply",
        pathname: "/en/apply",
        search: "?force_variant=draft-a&utm_source=nav",
      }),
    ).toBe("/private/preview/page/apply?locale=en&variant=draft-a");
  });

  it("keeps preview_mode so LLM crawler survives enter-private-preview", () => {
    expect(
      buildPrivatePreviewHref({
        contentType: "page",
        slug: "home",
        pathname: "/",
        search: "?locale=en&preview_mode=llm",
      }),
    ).toBe("/private/preview/page/home?locale=en&preview_mode=llm");
  });

  it("returns null when already on private preview", () => {
    expect(
      buildPrivatePreviewHref({
        contentType: "page",
        slug: "apply",
        pathname: "/private/preview/page/apply",
        search: "?locale=en",
      }),
    ).toBeNull();
  });

  it("uses fallback locale when the public path has none", () => {
    expect(
      buildPrivatePreviewHref({
        contentType: "page",
        slug: "home",
        pathname: "/",
        fallbackLocale: "es",
      }),
    ).toBe("/private/preview/page/home?locale=es");
  });
});

describe("enterVisualEditMode", () => {
  beforeEach(() => {
    vi.mocked(saveEditModeScrollPosition).mockClear();
  });

  it("enables edit mode and navigates when type+slug are known", () => {
    const enableEditMode = vi.fn();
    const navigate = vi.fn();
    const result = enterVisualEditMode({
      enableEditMode,
      navigate,
      pathname: "/en/apply",
      contentType: "page",
      slug: "apply",
    });
    expect(enableEditMode).toHaveBeenCalledOnce();
    expect(saveEditModeScrollPosition).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/private/preview/page/apply?locale=en");
    expect(result).toEqual({
      navigated: true,
      href: "/private/preview/page/apply?locale=en",
    });
  });

  it("enables edit mode and stays put when type+slug are missing", () => {
    const enableEditMode = vi.fn();
    const navigate = vi.fn();
    const result = enterVisualEditMode({
      enableEditMode,
      navigate,
      pathname: "/totally/unknown/path",
    });
    expect(enableEditMode).toHaveBeenCalledOnce();
    expect(saveEditModeScrollPosition).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(result).toEqual({ navigated: false, href: null });
  });

  it("enables edit mode and does not navigate when already on private preview", () => {
    const enableEditMode = vi.fn();
    const navigate = vi.fn();
    const result = enterVisualEditMode({
      enableEditMode,
      navigate,
      pathname: "/private/preview/page/apply",
      contentType: "page",
      slug: "apply",
    });
    expect(enableEditMode).toHaveBeenCalledOnce();
    expect(saveEditModeScrollPosition).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(result).toEqual({ navigated: false, href: null });
  });
});
