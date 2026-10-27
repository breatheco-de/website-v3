/**
 * Build the resolve context for entry-preview prop mappings:
 * mapped entry + SEO meta (templates expanded) + brand vars.
 */
import * as fs from "fs";
import * as path from "path";
import type { PreviewPropResolveContext } from "@shared/entry-preview-props";
import { PREVIEW_BRAND_SOURCE_OPTIONS } from "@shared/entry-preview-props";
import { getContentTypeConfig, getFolder } from "./content-types";
import { getDefaultContentRoot } from "./site-config";
import { contentIndex, type ContentIndex } from "./content-index";
import { deepMerge } from "./utils/deepMerge";
import { resolveAllTemplateVars } from "./resolve-template-vars";
import { getVariableManager, BRAND_VAR_KEYS } from "./variable-manager";
import { loadMergedSinglePage } from "./entry-delivery";
import { typeUsesSharedTemplate } from "./layout-owner";
import type { DatabaseManager } from "./database";
import { mediaGallery, type MediaGallery } from "./media-gallery";

function stripUnresolvedTokens(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (typeof v === "string" && /\{\{/.test(v)) continue;
    out[k] = v;
  }
  return out;
}

/** Resolve a brand logo registry ID to a concrete image URL for preview capture. */
function resolveBrandLogoUrl(idOrUrl: string, mg: MediaGallery): string {
  const raw = idOrUrl.trim();
  if (!raw) return "";
  if (
    raw.startsWith("http://") ||
    raw.startsWith("https://") ||
    raw.startsWith("/") ||
    raw.startsWith("data:")
  ) {
    return raw;
  }
  return mg.getImage(raw)?.src ?? "";
}

function brandMapFromRoot(
  contentRoot: string,
  mg: MediaGallery,
  theme: "dark" | "light" = "dark",
): Record<string, unknown> {
  const vm = getVariableManager(contentRoot);
  const settings = vm.getBrandSettings();
  const defs = vm.getDefinitions();
  const title =
    (typeof defs["brand.title"]?.default === "string" ? defs["brand.title"].default : null) ??
    settings.title;
  const logoId =
    (typeof defs["brand.logo"]?.default === "string" ? defs["brand.logo"].default : null) ??
    settings.logo;
  const logoDarkId =
    (typeof defs["brand.logo_dark"]?.default === "string" ? defs["brand.logo_dark"].default : null) ??
    settings.logo_dark;

  const lightUrl = resolveBrandLogoUrl(String(logoId || ""), mg);
  // Do not fall back to the light logo here — callers that map brand.logo_dark
  // explicitly (dark OG canvases) must get the dark asset or empty, never the
  // light-mode wordmark.
  const darkUrl = resolveBrandLogoUrl(String(logoDarkId || ""), mg);

  const map: Record<string, unknown> = {
    "brand.title": title,
    // Preview components need a URL; brand.* logos are stored as image-registry IDs.
    // brand.logo is theme-aware (dark → logo_dark, else light) with light fallback
    // so unmapped dark-only setups still render something.
    // brand.logo_dark is dark-only (no light fallback).
    "brand.logo": theme === "dark" ? darkUrl || lightUrl : lightUrl,
    "brand.logo_dark": darkUrl,
  };
  for (const key of PREVIEW_BRAND_SOURCE_OPTIONS) {
    if (map[key] === undefined) map[key] = "";
  }
  for (const key of BRAND_VAR_KEYS) {
    if (map[key] === undefined) map[key] = "";
  }
  return map;
}

async function contentIndexForRoot(contentRoot: string): Promise<ContentIndex> {
  if (contentIndex.contentRoot === contentRoot) return contentIndex;
  try {
    const { getSiteContextMap } = await import("./site-manager");
    for (const site of getSiteContextMap().values()) {
      if (site.contentRoot === contentRoot) return site.contentIndex;
    }
  } catch {
    /* no site map (scripts / tests) */
  }
  return contentIndex;
}

async function loadRawSeoMeta(
  contentType: string,
  slug: string,
  locale: string,
  contentRoot: string,
  ci?: ContentIndex,
): Promise<Record<string, unknown>> {
  if (typeUsesSharedTemplate(getContentTypeConfig(contentType, contentRoot))) {
    const page = await loadMergedSinglePage(ci ?? (await contentIndexForRoot(contentRoot)), contentType, slug, locale);
    const meta = page?.meta;
    return meta && typeof meta === "object" && !Array.isArray(meta)
      ? { ...(meta as Record<string, unknown>) }
      : {};
  }

  // Classic static YAML: _common + locale
  const folder = getFolder(contentType, contentRoot);
  const dir = path.join(contentRoot, folder, slug);
  const localePath = path.join(dir, `${locale}.yml`);
  if (!fs.existsSync(localePath)) return {};

  let commonData: Record<string, unknown> = {};
  const commonPath = path.join(dir, "_common.yml");
  if (fs.existsSync(commonPath)) {
    try {
      const parsed = contentIndex.safeYamlLoad(fs.readFileSync(commonPath, "utf-8"));
      if (parsed && typeof parsed === "object") commonData = parsed as Record<string, unknown>;
    } catch {
      /* ignore */
    }
  }
  try {
    const localeData =
      (contentIndex.safeYamlLoad(fs.readFileSync(localePath, "utf-8")) as Record<string, unknown>) ||
      {};
    const merged = deepMerge(commonData, localeData) as Record<string, unknown>;
    const meta = merged.meta;
    return meta && typeof meta === "object" && !Array.isArray(meta)
      ? { ...(meta as Record<string, unknown>) }
      : {};
  } catch {
    return {};
  }
}

/**
 * Load SEO meta for an entry (same sources as SEO UI), expand `{{ single.* }}`
 * (and site vars) inside meta, drop still-unresolved tokens, and attach brand.
 */
export async function buildPreviewPropResolveContext(opts: {
  contentType: string;
  slug: string;
  locale: string;
  entry: Record<string, unknown>;
  contentRoot?: string;
  db?: DatabaseManager;
  contentIndex?: ContentIndex;
  mediaGallery?: MediaGallery;
  /** Capture / live-preview theme — dark uses brand.logo_dark for brand.logo when set. */
  theme?: "dark" | "light";
}): Promise<PreviewPropResolveContext> {
  const contentRoot = opts.contentRoot ?? getDefaultContentRoot();
  const mg = opts.mediaGallery ?? mediaGallery;
  const theme = opts.theme === "light" ? "light" : "dark";
  const rawMeta = await loadRawSeoMeta(
    opts.contentType,
    opts.slug,
    opts.locale,
    contentRoot,
    opts.contentIndex,
  );

  const resolvedMeta = resolveAllTemplateVars(rawMeta, {
    singleEntry: opts.entry,
    contentType: opts.contentType,
    contentRoot,
    context: { locale: opts.locale },
    skipSiteVars: false,
  }) as Record<string, unknown>;

  return {
    entry: opts.entry,
    meta: stripUnresolvedTokens(
      resolvedMeta && typeof resolvedMeta === "object" && !Array.isArray(resolvedMeta)
        ? resolvedMeta
        : {},
    ),
    brand: brandMapFromRoot(contentRoot, mg, theme),
  };
}
