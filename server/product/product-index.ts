/**
 * Product Index — startup scanner.
 *
 * Reads ecommerce-settings.yml for global currency/locale/tax.
 * Discovers co-located `_product.yml` (dual-read `_ecommerce.yml`) by walking
 * content-type directories. Only entries with purchasable: true become products.
 * Audience (offer + personas) is read from the entry sidecar only.
 */

import fs from "fs";
import path from "path";
import { getDefaultContentRoot } from "../site-config";
import { contentIndex } from "../content-index";
import type { CmsProduct, EcommerceSettings, FunnelStep, FunnelTrafficSource } from "./types";
import { isProductSidecarFilename, resolveProductSidecarPath } from "./product-sidecar";
import { parseAudienceFromProductDoc } from "@shared/productAudience";
import { child } from "../logger";

const log = child({ module: "product/product-index" });

export const MARKETING_CONTENT_DIR = getDefaultContentRoot();
export const ECOMMERCE_SETTINGS_PATH = path.join(MARKETING_CONTENT_DIR, "ecommerce-settings.yml");
const CONTENT_TYPES_PATH = path.join(MARKETING_CONTENT_DIR, "content-types.yml");

function buildDirToContentTypeMap(contentRoot: string): Map<string, string> {
  const map = new Map<string, string>();
  const typesPath = path.join(contentRoot, "content-types.yml");
  if (!fs.existsSync(typesPath)) return map;
  try {
    const raw = fs.readFileSync(typesPath, "utf-8");
    const parsed = contentIndex.safeYamlLoad(raw) as Record<string, unknown> | null;
    if (!parsed) return map;
    for (const [canonicalKey, def] of Object.entries(parsed)) {
      if (def && typeof def === "object" && !Array.isArray(def)) {
        const d = def as Record<string, unknown>;
        const dirName = typeof d.directory === "string" ? d.directory : canonicalKey;
        map.set(dirName, canonicalKey);
      }
    }
  } catch {
    // non-fatal
  }
  return map;
}

const DEFAULTS_SETTINGS: EcommerceSettings = {
  currency: "USD",
  locale: "en-US",
  tax_inclusive: false,
};

export const productMap = new Map<string, CmsProduct>();
export let ecommerceSettings: EcommerceSettings = { ...DEFAULTS_SETTINGS };

function loadGlobalSettings(contentRoot: string): EcommerceSettings {
  const settingsPath = path.join(contentRoot, "ecommerce-settings.yml");
  if (!fs.existsSync(settingsPath)) {
    return { ...DEFAULTS_SETTINGS };
  }
  try {
    const raw = fs.readFileSync(settingsPath, "utf-8");
    const parsed = contentIndex.safeYamlLoad(raw) as Record<string, unknown> | null;
    if (!parsed) return { ...DEFAULTS_SETTINGS };

    return {
      currency: typeof parsed.currency === "string" ? parsed.currency : DEFAULTS_SETTINGS.currency,
      locale: typeof parsed.locale === "string" ? parsed.locale : DEFAULTS_SETTINGS.locale,
      tax_inclusive:
        typeof parsed.tax_inclusive === "boolean"
          ? parsed.tax_inclusive
          : DEFAULTS_SETTINGS.tax_inclusive,
    };
  } catch (err) {
    log.error({ err }, "[ProductIndex] Failed to parse ecommerce-settings.yml:");
    return { ...DEFAULTS_SETTINGS };
  }
}

function loadYml(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = contentIndex.safeYamlLoad(raw) as Record<string, unknown> | null;
    return parsed ?? null;
  } catch (err) {
    log.error({ err }, `[ProductIndex] Failed to parse ${filePath}:`);
    return null;
  }
}

function parseFunnelSteps(merged: Record<string, unknown>): FunnelStep[] {
  const funnel = merged.funnel;
  if (!funnel || typeof funnel !== "object" || Array.isArray(funnel)) return [];
  const stepsRaw = (funnel as Record<string, unknown>).steps;
  if (!Array.isArray(stepsRaw)) return [];
  const steps: FunnelStep[] = [];
  for (const s of stepsRaw) {
    if (!s || typeof s !== "object" || Array.isArray(s)) continue;
    const o = s as Record<string, unknown>;
    if (typeof o.content_type !== "string" || typeof o.slug !== "string") continue;
    steps.push({
      content_type: o.content_type,
      slug: o.slug,
      role: typeof o.role === "string" ? o.role : undefined,
    });
  }
  return steps;
}

function parseFunnelTrafficSources(merged: Record<string, unknown>): FunnelTrafficSource[] {
  const funnel = merged.funnel;
  if (!funnel || typeof funnel !== "object" || Array.isArray(funnel)) return [];
  const raw = (funnel as Record<string, unknown>).traffic_sources;
  if (!Array.isArray(raw)) return [];
  const byType = new Map<string, FunnelTrafficSource>();
  for (const s of raw) {
    if (!s || typeof s !== "object" || Array.isArray(s)) continue;
    const o = s as Record<string, unknown>;
    if (typeof o.content_type !== "string" || !o.content_type.trim()) continue;
    if (typeof o.role !== "string" || !o.role.trim()) continue;
    const content_type = o.content_type.trim();
    byType.set(content_type, { content_type, role: o.role.trim() });
  }
  return Array.from(byType.values());
}

function loadSidecarDir(dir: string): Record<string, unknown> | null {
  const resolved = resolveProductSidecarPath(dir);
  if (!resolved.exists) return null;
  if (resolved.legacy) {
    log.warn(
      `[ProductIndex] Dual-read legacy ${resolved.relativeHint} at ${dir} — migrate to _product.yml`,
    );
  }
  return loadYml(resolved.absolutePath);
}

export function scanProductContent(contentRoot?: string): void {
  const root = contentRoot
    ? path.isAbsolute(contentRoot)
      ? contentRoot
      : path.join(process.cwd(), contentRoot)
    : MARKETING_CONTENT_DIR;

  productMap.clear();
  ecommerceSettings = loadGlobalSettings(root);
  log.info("[ProductIndex] Loaded ecommerce settings (no CMS plan catalog)");

  let productCount = 0;
  if (!fs.existsSync(root)) return;

  const dirToCanonicalKey = buildDirToContentTypeMap(root);

  for (const [dirName, canonicalKey] of dirToCanonicalKey.entries()) {
    const typeDirPath = path.join(root, dirName);
    if (!fs.existsSync(typeDirPath)) continue;

    const typeConfig = loadSidecarDir(typeDirPath) ?? {};

    const entries = fs
      .readdirSync(typeDirPath, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    for (const entryDir of entries) {
      const slug = entryDir.name;
      const entryDirPath = path.join(typeDirPath, slug);
      const entryConfig = loadSidecarDir(entryDirPath);
      if (!entryConfig) continue;

      const merged = { ...typeConfig, ...entryConfig };
      const typeFunnel = typeConfig.funnel;
      const entryFunnel = entryConfig.funnel;
      if (entryFunnel && typeof entryFunnel === "object") {
        merged.funnel = entryFunnel;
      } else if (typeFunnel && typeof typeFunnel === "object") {
        merged.funnel = typeFunnel;
      }

      const purchasable = typeof merged.purchasable === "boolean" ? merged.purchasable : false;
      if (!purchasable) continue;

      const productId =
        typeof merged.product_id === "string" ? merged.product_id : `${canonicalKey}-${slug}`;

      const activelySelling =
        typeof merged.actively_selling === "boolean"
          ? merged.actively_selling
          : typeof merged.active === "boolean"
            ? merged.active
            : true;

      const audience = parseAudienceFromProductDoc(entryConfig);

      const product: CmsProduct = {
        product_id: productId,
        name: typeof merged.name === "string" ? merged.name : slug,
        content_type: canonicalKey,
        content_slug: slug,
        actively_selling: activelySelling,
        description: typeof merged.description === "string" ? merged.description : undefined,
        funnel: {
          steps: parseFunnelSteps(merged),
          traffic_sources: parseFunnelTrafficSources(merged),
        },
        audience: audience ?? null,
      };

      productMap.set(productId, product);
      productCount++;
    }
  }

  log.info(`[ProductIndex] Scanned ${productCount} products from co-located _product.yml files`);
}

/** @deprecated Use scanProductContent */
export const scanEcommerceContent = scanProductContent;

let watcherStarted = false;

export function startProductWatcher(contentRoot?: string): void {
  const root = contentRoot
    ? path.isAbsolute(contentRoot)
      ? contentRoot
      : path.join(process.cwd(), contentRoot)
    : MARKETING_CONTENT_DIR;
  if (watcherStarted || !fs.existsSync(root)) return;
  watcherStarted = true;

  fs.watch(root, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const isSettingsFile =
      filename === "ecommerce-settings.yml" || filename.endsWith(`${path.sep}ecommerce-settings.yml`);
    if (!isSettingsFile && !isProductSidecarFilename(filename)) return;
    log.info(`[ProductIndex] File changed: ${filename} — rescanning`);
    try {
      scanProductContent(root);
    } catch (err) {
      log.error({ err }, "[ProductIndex] Error during rescan:");
    }
  });
}

/** @deprecated Use startProductWatcher */
export const startEcommerceWatcher = startProductWatcher;
