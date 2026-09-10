/**
 * Decide whether compile-time site Zod should resolve to
 * site-component-schemas.stub.ts instead of the real site_* bridge.
 *
 * - WEBLIFY_SITE_SCHEMAS_STUB=1 → always stub (pack / publish CI)
 * - WEBLIFY_SITE_SCHEMAS_STUB=0 → always real bridge (must have site content)
 * - default → stub when site_4geeks-com/component-registry is missing under PROJECT_ROOT
 */

import fs from "fs";
import path from "path";
import { getPackageRoot, getProjectRoot } from "./paths";

/** Canonical site folder used by the legacy compile-time bridge. */
export const SITE_SCHEMA_BRIDGE_FOLDER = "site_4geeks-com";

export function getSiteComponentRegistryPath(
  projectRoot: string = getProjectRoot(),
): string {
  return path.join(projectRoot, SITE_SCHEMA_BRIDGE_FOLDER, "component-registry");
}

export function siteComponentRegistryExists(
  projectRoot: string = getProjectRoot(),
): boolean {
  return fs.existsSync(getSiteComponentRegistryPath(projectRoot));
}

/**
 * True when Vite/esbuild/tsc resolution should use the stub bridge.
 */
export function shouldUseSiteSchemaStub(
  projectRoot: string = getProjectRoot(),
): boolean {
  const flag = process.env.WEBLIFY_SITE_SCHEMAS_STUB?.trim();
  if (flag === "1" || flag?.toLowerCase() === "true") return true;
  if (flag === "0" || flag?.toLowerCase() === "false") return false;
  return !siteComponentRegistryExists(projectRoot);
}

export function getSiteComponentSchemasPaths(packageRoot: string = getPackageRoot()): {
  real: string;
  stub: string;
} {
  return {
    real: path.join(packageRoot, "shared", "site-component-schemas.ts"),
    stub: path.join(packageRoot, "shared", "site-component-schemas.stub.ts"),
  };
}

/** Absolute path to resolve for site-component-schemas imports. */
export function resolveSiteComponentSchemasPath(
  packageRoot: string = getPackageRoot(),
  projectRoot: string = getProjectRoot(),
): string {
  const { real, stub } = getSiteComponentSchemasPaths(packageRoot);
  return shouldUseSiteSchemaStub(projectRoot) ? stub : real;
}
