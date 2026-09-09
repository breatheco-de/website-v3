/**
 * Shared + per-site component registry path resolution.
 * Types must not exist in both trees (collision → explicit error).
 * Optional inherit_components_from: child uses parent's registry (one hop; child must not own component-registry/).
 */

import * as fs from "fs";
import * as path from "path";
import { getPackageRoot, getProjectRoot } from "./paths";

export type RegistryOrigin = "shared" | "site";

export interface ResolvedComponentPath {
  type: string;
  origin: RegistryOrigin;
  /** Absolute path to the component type directory (contains v1.0/, …) */
  componentDir: string;
  registryRoot: string;
}

export interface RegistryCollision {
  type: string;
  sharedPath: string;
  sitePath: string;
}

export interface SiteRegistryRef {
  contentFolder: string;
  inheritComponentsFrom?: string;
}

export function getSharedRegistryPath(cwd = getPackageRoot()): string {
  return path.join(cwd, "shared", "component-registry");
}

export function getSiteRegistryPath(
  contentFolder: string,
  cwd = getProjectRoot(),
): string {
  const folder = path.isAbsolute(contentFolder)
    ? contentFolder
    : path.join(cwd, contentFolder);
  return path.join(folder, "component-registry");
}

/**
 * When inheritComponentsFrom is set, return the parent folder and assert the
 * child has no component-registry/ directory (parent-only).
 */
export function getEffectiveSiteRegistryFolder(
  siteContentFolder: string,
  inheritComponentsFrom?: string | null,
  cwd = getProjectRoot(),
): string {
  const inherit = inheritComponentsFrom?.trim();
  if (!inherit) return siteContentFolder;

  const childReg = getSiteRegistryPath(siteContentFolder, cwd);
  if (fs.existsSync(childReg)) {
    throw new Error(
      [
        `Site "${siteContentFolder}" sets inherit_components_from="${inherit}" but has a local component-registry/.`,
        "Inheriting sites must not own a component-registry directory (parent-only).",
        `Remove: ${childReg}`,
      ].join("\n"),
    );
  }
  return inherit;
}

function isComponentTypeDir(registryRoot: string, name: string): boolean {
  if (name.startsWith("_") || name.startsWith(".")) return false;
  const dirPath = path.join(registryRoot, name);
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return false;
  try {
    return fs.readdirSync(dirPath).some((d) => {
      const p = path.join(dirPath, d);
      return fs.statSync(p).isDirectory() && /^v\d/.test(d);
    });
  } catch {
    return false;
  }
}

/** Component type names under one registry root (excludes _common). */
export function listTypesInRegistry(registryRoot: string): string[] {
  if (!fs.existsSync(registryRoot)) return [];
  try {
    return fs
      .readdirSync(registryRoot)
      .filter((name) => isComponentTypeDir(registryRoot, name))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export function findRegistryCollisions(
  siteContentFolder: string,
  cwd = getProjectRoot(),
  inheritComponentsFrom?: string | null,
): RegistryCollision[] {
  const effective = getEffectiveSiteRegistryFolder(
    siteContentFolder,
    inheritComponentsFrom,
    cwd,
  );
  const sharedRoot = getSharedRegistryPath(cwd);
  const siteRoot = getSiteRegistryPath(effective, cwd);
  const sharedTypes = new Set(listTypesInRegistry(sharedRoot));
  const collisions: RegistryCollision[] = [];
  for (const type of listTypesInRegistry(siteRoot)) {
    if (sharedTypes.has(type)) {
      collisions.push({
        type,
        sharedPath: path.join(sharedRoot, type),
        sitePath: path.join(siteRoot, type),
      });
    }
  }
  return collisions;
}

/**
 * Fail loudly if any type exists in both shared and the given site registry.
 * Call at boot / ensure for each configured site.
 */
export function assertNoRegistryCollisions(
  siteContentFolder: string,
  cwd = getProjectRoot(),
  inheritComponentsFrom?: string | null,
): void {
  // Throws if inherit is set and child has component-registry/
  getEffectiveSiteRegistryFolder(siteContentFolder, inheritComponentsFrom, cwd);

  const collisions = findRegistryCollisions(
    siteContentFolder,
    cwd,
    inheritComponentsFrom,
  );
  if (collisions.length === 0) return;
  const lines = collisions.map(
    (c) =>
      `  - "${c.type}"\n      shared: ${c.sharedPath}\n      site:   ${c.sitePath}`,
  );
  throw new Error(
    [
      "Component registry collision: the same type exists in shared and site registries.",
      "Shared and site components cannot override each other. Remove one copy or promote fully to shared.",
      ...lines,
    ].join("\n"),
  );
}

export function assertNoRegistryCollisionsForAllSites(
  sites: Array<string | SiteRegistryRef>,
  cwd = getProjectRoot(),
): void {
  for (const site of sites) {
    if (typeof site === "string") {
      assertNoRegistryCollisions(site, cwd);
    } else {
      assertNoRegistryCollisions(
        site.contentFolder,
        cwd,
        site.inheritComponentsFrom,
      );
    }
  }
}

/**
 * Resolve a component type for one site: site path if present, else shared.
 * Throws if both exist (caller should have run collision assert at boot).
 */
export function resolveComponentPath(
  componentType: string,
  siteContentFolder: string,
  cwd = getProjectRoot(),
  inheritComponentsFrom?: string | null,
): ResolvedComponentPath | null {
  const effective = getEffectiveSiteRegistryFolder(
    siteContentFolder,
    inheritComponentsFrom,
    cwd,
  );
  const sharedRoot = getSharedRegistryPath(cwd);
  const siteRoot = getSiteRegistryPath(effective, cwd);
  const sharedDir = path.join(sharedRoot, componentType);
  const siteDir = path.join(siteRoot, componentType);
  const inShared = isComponentTypeDir(sharedRoot, componentType);
  const inSite = isComponentTypeDir(siteRoot, componentType);

  if (inShared && inSite) {
    throw new Error(
      `Component registry collision for "${componentType}":\n  shared: ${sharedDir}\n  site:   ${siteDir}`,
    );
  }
  if (inSite) {
    return {
      type: componentType,
      origin: "site",
      componentDir: siteDir,
      registryRoot: siteRoot,
    };
  }
  if (inShared) {
    return {
      type: componentType,
      origin: "shared",
      componentDir: sharedDir,
      registryRoot: sharedRoot,
    };
  }
  return null;
}

export interface MergedComponentType {
  type: string;
  origin: RegistryOrigin;
  componentDir: string;
  registryRoot: string;
}

/** All types for one site: shared ∪ effective site registry (disjoint by collision rules). */
export function listMergedComponentTypes(
  siteContentFolder: string,
  cwd = getProjectRoot(),
  inheritComponentsFrom?: string | null,
): MergedComponentType[] {
  assertNoRegistryCollisions(siteContentFolder, cwd, inheritComponentsFrom);
  const effective = getEffectiveSiteRegistryFolder(
    siteContentFolder,
    inheritComponentsFrom,
    cwd,
  );
  const sharedRoot = getSharedRegistryPath(cwd);
  const siteRoot = getSiteRegistryPath(effective, cwd);
  const out: MergedComponentType[] = [];

  for (const type of listTypesInRegistry(sharedRoot)) {
    out.push({
      type,
      origin: "shared",
      componentDir: path.join(sharedRoot, type),
      registryRoot: sharedRoot,
    });
  }
  for (const type of listTypesInRegistry(siteRoot)) {
    out.push({
      type,
      origin: "site",
      componentDir: path.join(siteRoot, type),
      registryRoot: siteRoot,
    });
  }
  return out.sort((a, b) => a.type.localeCompare(b.type));
}
