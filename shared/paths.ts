/**
 * PACKAGE_ROOT = Weblify engine (server, client, shared, dist).
 * PROJECT_ROOT = site project (sites.yml, site_*, .env, data, .cache, .local).
 *
 * When developing or deploying a full monorepo/release checkout, both resolve
 * to the same directory (cwd). When running as `npx weblify`, PACKAGE_ROOT is
 * the installed package and PROJECT_ROOT is the user's cwd.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

let cachedPackageRoot: string | null = null;
let cachedProjectRoot: string | null = null;

/**
 * Absolute path to the Weblify engine install / monorepo root.
 * Override with WEBLIFY_PACKAGE_ROOT.
 */
export function getPackageRoot(): string {
  if (process.env.WEBLIFY_PACKAGE_ROOT?.trim()) {
    return path.resolve(process.env.WEBLIFY_PACKAGE_ROOT.trim());
  }
  if (cachedPackageRoot) return cachedPackageRoot;
  // This file lives at <package>/shared/paths.ts
  cachedPackageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  return cachedPackageRoot;
}

/**
 * Absolute path to the site project (sites.yml, site_*, data, …).
 * Override with WEBLIFY_PROJECT_ROOT; default process.cwd().
 */
export function getProjectRoot(): string {
  if (process.env.WEBLIFY_PROJECT_ROOT?.trim()) {
    return path.resolve(process.env.WEBLIFY_PROJECT_ROOT.trim());
  }
  if (cachedProjectRoot) return cachedProjectRoot;
  cachedProjectRoot = process.cwd();
  return cachedProjectRoot;
}

/** Test helper / CLI: reset caches after chdir. */
export function resetPathCaches(): void {
  cachedPackageRoot = null;
  cachedProjectRoot = null;
}

export function setProjectRootForTests(root: string | null): void {
  cachedProjectRoot = root ? path.resolve(root) : null;
}

export function projectPath(...segments: string[]): string {
  return path.join(getProjectRoot(), ...segments);
}

export function packagePath(...segments: string[]): string {
  return path.join(getPackageRoot(), ...segments);
}

export function isProductionMode(argv: string[] = process.argv): boolean {
  if (process.env.NODE_ENV === "production") return true;
  if (process.env.WEBLIFY_MODE?.trim().toLowerCase() === "production") return true;
  if (argv.includes("--production")) return true;
  return false;
}

export function projectHasSitesYml(root: string = getProjectRoot()): boolean {
  return fs.existsSync(path.join(root, "sites.yml"));
}
