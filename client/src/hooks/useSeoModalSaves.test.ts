import { describe, expect, it, vi, beforeEach } from "vitest";

const toast = vi.fn();
const saveLandingLocations = vi.fn();
const saveVisibilitySettings = vi.fn();
const saveSnippetMeta = vi.fn();
const saveOptionalMetaFields = vi.fn();
const saveVisibilityToLocales = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

vi.mock("@/lib/seoSaveApi", () => ({
  VISIBILITY_META_KEYS: ["robots", "priority", "change_frequency"],
  saveLandingLocations: (...args: unknown[]) => saveLandingLocations(...args),
  saveVisibilitySettings: (...args: unknown[]) => saveVisibilitySettings(...args),
  saveVisibilityToLocales: (...args: unknown[]) => saveVisibilityToLocales(...args),
  saveSnippetMeta: (...args: unknown[]) => saveSnippetMeta(...args),
  saveOptionalMetaFields: (...args: unknown[]) => saveOptionalMetaFields(...args),
}));

import { createElement, useRef, useState, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SeoMeta } from "@/components/DebugBubble/types";
import type { SeoModalSaveArea } from "@/components/editing/seoModalSaved";
import { useSeoModalSaves } from "@/hooks/useSeoModalSaves";

const EMPTY_META: SeoMeta = {
  page_title: "Title",
  description: "Desc",
  og_image: "",
  canonical_url: "",
  robots: "",
  priority: "",
  change_frequency: "",
  redirects: [],
};

function HookProbe({
  onSaved,
  expose,
}: {
  onSaved: (areas: SeoModalSaveArea[]) => void;
  expose: (api: ReturnType<typeof useSeoModalSaves>) => void;
}) {
  const [seoMeta, setSeoMeta] = useState<SeoMeta>(EMPTY_META);
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());
  const baselineMetaRef = useRef<SeoMeta>(EMPTY_META);
  const baselineLocationsRef = useRef<string[]>([]);
  const api = useSeoModalSaves({
    contentType: "blog",
    slug: "hello",
    locale: "en",
    seoContext: "live",
    seoMeta,
    setSeoMeta,
    dirtyKeys,
    setDirtyKeys,
    baselineMetaRef,
    baselineLocationsRef,
    seoData: { meta: {}, liveMeta: {} },
    metaOverrides: [],
    onSaved,
  });
  expose(api);
  return null as unknown as ReactNode;
}

describe("useSeoModalSaves onSaved areas", () => {
  beforeEach(() => {
    toast.mockReset();
    saveLandingLocations.mockReset().mockResolvedValue(undefined);
    saveVisibilitySettings.mockReset().mockResolvedValue(undefined);
    saveSnippetMeta.mockReset().mockResolvedValue(undefined);
    saveOptionalMetaFields.mockReset().mockResolvedValue(undefined);
  });

  it("emits locations then meta areas on successful saves", async () => {
    const onSaved = vi.fn();
    let api: ReturnType<typeof useSeoModalSaves> | null = null;
    renderToStaticMarkup(
      createElement(HookProbe, {
        onSaved,
        expose: (a) => {
          api = a;
        },
      }),
    );
    expect(api).toBeTruthy();
    await api!.saveLocations(["us"]);
    await api!.saveSnippet();
    await api!.saveVisibility();
    expect(onSaved.mock.calls.map((c) => c[0])).toEqual([
      ["locations"],
      ["meta"],
      ["meta"],
    ]);
  });
});

describe("useSeoModalSaves saveVisibility to other languages", () => {
  function mount() {
    let api: ReturnType<typeof useSeoModalSaves> | null = null;
    renderToStaticMarkup(
      createElement(HookProbe, {
        onSaved: vi.fn(),
        expose: (a) => {
          api = a;
        },
      }),
    );
    return api!;
  }

  beforeEach(() => {
    toast.mockReset();
    saveVisibilitySettings.mockReset().mockResolvedValue(undefined);
    saveVisibilityToLocales.mockReset().mockResolvedValue({ saved: ["es"], failed: [] });
  });

  it("saves the current language first, then copies the chosen fields", async () => {
    await mount().saveVisibility({
      inheritedRobots: "noindex",
      otherLocales: [{ locale: "es", inherited_robots: "noindex" }],
      copyKeys: ["robots"],
    });
    expect(saveVisibilitySettings).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "en", inheritedRobots: "noindex" }),
    );
    expect(saveVisibilityToLocales).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: "blog",
        slug: "hello",
        copyKeys: ["robots"],
        targets: [{ locale: "es", inherited_robots: "noindex" }],
      }),
    );
    expect(toast).toHaveBeenLastCalledWith({ title: "Visibility settings saved for EN, ES" });
  });

  it("does not touch other languages when the current one fails", async () => {
    saveVisibilitySettings.mockRejectedValueOnce(new Error("boom"));
    await expect(
      mount().saveVisibility({ otherLocales: [{ locale: "es" }], copyKeys: ["robots"] }),
    ).rejects.toThrow("boom");
    expect(saveVisibilityToLocales).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Failed to save visibility" }));
  });

  it("names the languages that failed and keeps the ones that saved", async () => {
    saveVisibilityToLocales.mockResolvedValueOnce({ saved: ["es"], failed: ["pt"] });
    await mount().saveVisibility({
      otherLocales: [{ locale: "es" }, { locale: "pt" }],
      copyKeys: ["robots", "priority"],
    });
    expect(toast).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Saved for EN, ES. Failed for PT", variant: "destructive" }),
    );
  });

  it("skips the copy when no fields are chosen", async () => {
    await mount().saveVisibility({ otherLocales: [{ locale: "es" }], copyKeys: [] });
    expect(saveVisibilityToLocales).not.toHaveBeenCalled();
    expect(toast).toHaveBeenLastCalledWith({ title: "Visibility settings saved" });
  });
});
