/**
 * Atomic-deploy hybrid helper.
 *
 * On the VPS, each site's component-registry is copied into the release (not
 * symlinked). GitHub pull/delete therefore only updates process.cwd() (the
 * release tree). Without mirroring, the next deploy copies persistent into
 * the new release and deleted or stale registry files come back.
 *
 * YAML/blog/etc. remain symlinked, so cwd writes already hit persistent;
 * those paths do not need a mirror.
 *
 * VPS layout:
 *   /opt/website-v3/current -> releases/SHA
 *   /opt/website-v3/persistent/site_NAME/component-registry
 */

import fs from "fs";
import path from "path";
import { child } from "./logger";

const log = child({ module: "component-registry-persistent" });

/** True when the content-relative path is under component-registry/. */
export function isComponentRegistryContentPath(filePath: string): boolean {
  const n = filePath.replace(/\\/g, "/");
  return /(?:^|\/)component-registry\//.test(n) || /(?:^|\/)component-registry$/.test(n);
}

/**
 * site_4geeks-com/component-registry/hero/... -> site_4geeks-com
 */
export function contentFolderFromRegistryPath(filePath: string): string | null {
  const n = filePath.replace(/\\/g, "/");
  const m = n.match(/^(site_[^/]+)\/component-registry(?:\/|$)/);
  return m?.[1] ?? null;
}

/**
 * When cwd is .../current, persistent is ../persistent.
 * When cwd is the realpath .../releases/SHA, persistent is ../../persistent.
 * Local/dev without that layout -> null (mirror no-op).
 */
export function resolvePersistentRoot(cwd: string = process.cwd()): string | null {
  const candidates = [
    path.resolve(cwd, "..", "persistent"),
    path.resolve(cwd, "..", "..", "persistent"),
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) continue;
    const parent = path.dirname(candidate);
    // Prefer the atomic-deploy app root (has releases/ and/or current).
    if (
      fs.existsSync(path.join(parent, "releases")) ||
      fs.existsSync(path.join(parent, "current"))
    ) {
      return candidate;
    }
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }
  return null;
}

/**
 * Copy release component-registry into persistent so the next atomic deploy
 * does not resurrect stale registry files.
 *
 * Call after pull/prune that touched component-registry under this site folder.
 */
export function mirrorComponentRegistryToPersistent(
  contentFolder: string,
  cwd: string = process.cwd(),
): { mirrored: boolean; reason?: string } {
  const folder = contentFolder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!folder.startsWith("site_")) {
    return { mirrored: false, reason: "not a site_* content folder" };
  }

  const persistentRoot = resolvePersistentRoot(cwd);
  if (!persistentRoot) {
    // Dev / non-VPS: no hybrid layout
    return { mirrored: false, reason: "no persistent/ sibling of cwd" };
  }

  const releaseReg = path.join(cwd, folder, "component-registry");
  const persistentReg = path.join(persistentRoot, folder, "component-registry");

  if (!fs.existsSync(releaseReg) || !fs.statSync(releaseReg).isDirectory()) {
    return { mirrored: false, reason: "release component-registry missing" };
  }

  try {
    // Replace persistent tree with the release snapshot (includes deletes).
    fs.rmSync(persistentReg, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(persistentReg), { recursive: true });
    fs.cpSync(releaseReg, persistentReg, { recursive: true });
    log.info(
      { contentFolder: folder, persistentReg },
      "[RegistryMirror] Mirrored component-registry release -> persistent",
    );
    return { mirrored: true };
  } catch (err) {
    log.warn(
      { err, contentFolder: folder, persistentReg },
      "[RegistryMirror] Failed to mirror component-registry to persistent",
    );
    return {
      mirrored: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * If filePath is under component-registry, mirror that site's registry tree.
 */
export function mirrorComponentRegistryToPersistentForFile(
  filePath: string,
  cwd: string = process.cwd(),
): { mirrored: boolean; reason?: string } {
  if (!isComponentRegistryContentPath(filePath)) {
    return { mirrored: false, reason: "not a component-registry path" };
  }
  const folder = contentFolderFromRegistryPath(filePath);
  if (!folder) {
    return { mirrored: false, reason: "could not parse site folder" };
  }
  return mirrorComponentRegistryToPersistent(folder, cwd);
}
