import { useCallback, useState, type MutableRefObject } from "react";
import type { SeoMeta } from "@/components/DebugBubble/types";
import type { SeoModalSaveArea } from "@/components/editing/seoModalSaved";
import { useToast } from "@/hooks/use-toast";
import { computeDirtyMetaKeys } from "@/lib/buildMetaSaveOperations";
import {
  saveLandingLocations,
  saveOptionalMetaFields,
  saveSnippetMeta,
  saveVisibilitySettings,
  VISIBILITY_META_KEYS,
} from "@/lib/seoSaveApi";

export type SeoModalSavingFlags = {
  locations?: boolean;
  visibility?: boolean;
  snippet?: boolean;
  canonical?: boolean;
  ogImage?: boolean;
};

export type UseSeoModalSavesOpts = {
  contentType: string | null;
  slug: string | null;
  locale: string;
  seoContext: "live" | "variant";
  seoVariant?: string;
  seoMeta: SeoMeta;
  setSeoMeta: (v: SeoMeta) => void;
  dirtyKeys: Set<string>;
  setDirtyKeys: (v: Set<string>) => void;
  baselineMetaRef: MutableRefObject<SeoMeta>;
  baselineLocationsRef: MutableRefObject<string[]>;
  seoData: {
    meta?: Record<string, unknown>;
    liveMeta?: Record<string, unknown>;
  } | null;
  metaOverrides: string[];
  /** Notify parent with save area(s); ManagedSeoModal wraps this into SeoModalSavedDetail. */
  onSaved?: (areas: SeoModalSaveArea[]) => void;
  refetch?: () => Promise<void>;
};

export function useSeoModalSaves(opts: UseSeoModalSavesOpts) {
  const { toast } = useToast();
  const [saving, setSaving] = useState<SeoModalSavingFlags>({});

  const metaSaveContext = useCallback(() => {
    const isVariant = opts.seoContext === "variant" && !!opts.seoVariant;
    return {
      context: (isVariant ? "variant" : "live") as "live" | "variant",
      seoMeta: opts.seoMeta,
      dirtyKeys: opts.dirtyKeys,
      displayMeta: opts.seoData?.meta,
      liveMeta: (opts.seoData?.liveMeta || {}) as Record<string, unknown>,
      metaOverrides: opts.metaOverrides,
    };
  }, [opts]);

  const patchTarget = useCallback(() => {
    if (!opts.contentType || !opts.slug) return null;
    return {
      contentType: opts.contentType,
      slug: opts.slug,
      locale: opts.locale,
      variant: opts.seoContext === "variant" ? opts.seoVariant : undefined,
    };
  }, [opts]);

  const afterMetaSave = useCallback(
    (savedKeys: (keyof SeoMeta)[]) => {
      const next = { ...opts.seoMeta };
      opts.baselineMetaRef.current = { ...opts.baselineMetaRef.current, ...next };
      for (const k of savedKeys) {
        opts.baselineMetaRef.current[k] = next[k];
      }
      opts.setDirtyKeys(computeDirtyMetaKeys(next, opts.baselineMetaRef.current));
    },
    [opts],
  );

  const saveLocations = useCallback(
    async (locations: string[]) => {
      if (!opts.slug) return;
      setSaving((s) => ({ ...s, locations: true }));
      try {
        await saveLandingLocations({ slug: opts.slug, locations });
        opts.baselineLocationsRef.current = [...locations];
        toast({ title: "Locations saved" });
        opts.onSaved?.(["locations"]);
      } catch (error) {
        toast({
          title: "Failed to save locations",
          description: error instanceof Error ? error.message : "Could not save locations.",
          variant: "destructive",
        });
        throw error;
      } finally {
        setSaving((s) => ({ ...s, locations: false }));
      }
    },
    [opts, toast],
  );

  const saveVisibility = useCallback(async () => {
    const target = patchTarget();
    if (!target) return;
    setSaving((s) => ({ ...s, visibility: true }));
    try {
      await saveVisibilitySettings({ ...metaSaveContext(), ...target });
      afterMetaSave([...VISIBILITY_META_KEYS]);
      toast({ title: "Visibility settings saved" });
      opts.onSaved?.(["meta"]);
    } catch (error) {
      toast({
        title: "Failed to save visibility",
        description: error instanceof Error ? error.message : "Could not save visibility settings.",
        variant: "destructive",
      });
      throw error;
    } finally {
      setSaving((s) => ({ ...s, visibility: false }));
    }
  }, [afterMetaSave, metaSaveContext, opts, patchTarget, toast]);

  const saveSnippet = useCallback(async () => {
    const target = patchTarget();
    if (!target) return;
    setSaving((s) => ({ ...s, snippet: true }));
    try {
      await saveSnippetMeta({ ...metaSaveContext(), ...target });
      afterMetaSave(["page_title", "description"]);
      toast({ title: "Snippet saved" });
      opts.onSaved?.(["meta"]);
    } catch (error) {
      toast({
        title: "Failed to save snippet",
        description: error instanceof Error ? error.message : "Could not save title/description.",
        variant: "destructive",
      });
      throw error;
    } finally {
      setSaving((s) => ({ ...s, snippet: false }));
    }
  }, [afterMetaSave, metaSaveContext, opts, patchTarget, toast]);

  const saveCanonical = useCallback(async () => {
    const target = patchTarget();
    if (!target) return;
    setSaving((s) => ({ ...s, canonical: true }));
    try {
      await saveOptionalMetaFields({
        ...metaSaveContext(),
        ...target,
        keys: ["canonical_url"],
      });
      afterMetaSave(["canonical_url"]);
      toast({ title: "Canonical URL saved" });
      opts.onSaved?.(["meta"]);
    } catch (error) {
      toast({
        title: "Failed to save canonical URL",
        description: error instanceof Error ? error.message : "Could not save canonical URL.",
        variant: "destructive",
      });
    } finally {
      setSaving((s) => ({ ...s, canonical: false }));
    }
  }, [afterMetaSave, metaSaveContext, opts, patchTarget, toast]);

  const saveOgImage = useCallback(
    async (src: string) => {
      const target = patchTarget();
      if (!target) return;
      setSaving((s) => ({ ...s, ogImage: true }));
      try {
        const nextMeta = { ...opts.seoMeta, og_image: src };
        await saveOptionalMetaFields({
          context: metaSaveContext().context,
          seoMeta: nextMeta,
          dirtyKeys: new Set(["og_image"]),
          displayMeta: metaSaveContext().displayMeta,
          liveMeta: metaSaveContext().liveMeta,
          metaOverrides: metaSaveContext().metaOverrides,
          ...target,
          keys: ["og_image"],
        });
        opts.baselineMetaRef.current = { ...opts.baselineMetaRef.current, og_image: src };
        opts.setSeoMeta(nextMeta);
        opts.setDirtyKeys(computeDirtyMetaKeys(nextMeta, opts.baselineMetaRef.current));
        toast({ title: "Social image saved" });
        opts.onSaved?.(["meta"]);
      } catch (error) {
        toast({
          title: "Failed to save social image",
          description: error instanceof Error ? error.message : "Could not save og:image.",
          variant: "destructive",
        });
      } finally {
        setSaving((s) => ({ ...s, ogImage: false }));
      }
    },
    [metaSaveContext, opts, patchTarget, toast],
  );

  return {
    saving,
    saveLocations,
    saveVisibility,
    saveSnippet,
    saveCanonical,
    saveOgImage,
    isLiveLocale: opts.seoContext === "live",
  };
}
