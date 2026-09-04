import { describe, expect, it, vi, beforeEach } from "vitest";

const toast = vi.fn();
const saveLandingLocations = vi.fn();
const saveVisibilitySettings = vi.fn();
const saveSnippetMeta = vi.fn();
const saveOptionalMetaFields = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

vi.mock("@/lib/seoSaveApi", () => ({
  VISIBILITY_META_KEYS: ["robots", "priority", "change_frequency"],
  saveLandingLocations: (...args: unknown[]) => saveLandingLocations(...args),
  saveVisibilitySettings: (...args: unknown[]) => saveVisibilitySettings(...args),
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
