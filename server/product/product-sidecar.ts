/**
 * Resolve entry/type product sidecar paths.
 * Prefer `_product.yml`; dual-read legacy `_ecommerce.yml` (warn).
 * Writes always go to `_product.yml`.
 */

import fs from "fs";
import path from "path";

export const PRODUCT_SIDECAR_BASENAME = "_product.yml";
export const LEGACY_PRODUCT_SIDECAR_BASENAME = "_ecommerce.yml";

const PRODUCT_NAMES = ["_product.yml", "_product.yaml"] as const;
const LEGACY_NAMES = ["_ecommerce.yml", "_ecommerce.yaml"] as const;

export type SidecarLoadResult = {
  absolutePath: string;
  relativeHint: string;
  legacy: boolean;
  exists: boolean;
};

function firstExisting(dir: string, names: readonly string[]): string | null {
  for (const name of names) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Path used for writes (always new name). */
export function productSidecarWritePath(entryOrTypeDir: string): string {
  return path.join(entryOrTypeDir, PRODUCT_SIDECAR_BASENAME);
}

/** Prefer `_product.yml`, else legacy `_ecommerce.yml`. */
export function resolveProductSidecarPath(entryOrTypeDir: string): SidecarLoadResult {
  const product = firstExisting(entryOrTypeDir, PRODUCT_NAMES);
  if (product) {
    return {
      absolutePath: product,
      relativeHint: path.basename(product),
      legacy: false,
      exists: true,
    };
  }
  const legacy = firstExisting(entryOrTypeDir, LEGACY_NAMES);
  if (legacy) {
    return {
      absolutePath: legacy,
      relativeHint: path.basename(legacy),
      legacy: true,
      exists: true,
    };
  }
  return {
    absolutePath: productSidecarWritePath(entryOrTypeDir),
    relativeHint: PRODUCT_SIDECAR_BASENAME,
    legacy: false,
    exists: false,
  };
}

export function isProductSidecarFilename(filename: string): boolean {
  return (
    filename.endsWith("_product.yml") ||
    filename.endsWith("_product.yaml") ||
    filename.endsWith("_ecommerce.yml") ||
    filename.endsWith("_ecommerce.yaml")
  );
}
