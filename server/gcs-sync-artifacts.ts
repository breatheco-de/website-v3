/**
 * Registry of single-file GCS sync artifacts for Cloud Sync admin actions
 * (view / download from GCS / upload to GCS).
 */

import * as fs from "fs";
import * as path from "path";
import {
  formStateReadKeys,
  gscUrlInspectionReadKeys,
  platformSitesYmlGcsKey,
  platformSitesYmlLocalFilename,
  platformSitesYmlReadKeys,
  platformUserStoreGcsKey,
  platformUserStoreLocalFilename,
  runtimeIssuesStateReadKeys,
  siteSyncGcsKey,
  SYNC_FILENAMES,
  syncLogReadKeys,
  syncStateReadKeys,
  userStoreReadKeys,
  validationCacheReadKeys,
  validationResolvedArchiveReadKeys,
  versioningStateReadKeys,
} from "@shared/gcsKeys";
import { getSiteConfigs } from "./site-config";
import { getSiteContextMap, type SiteContext } from "./site-manager";
import { getUsersStateLocalPath } from "./user-store";
import { child } from "./logger";

const log = child({ module: "gcs-sync-artifacts" });

export const SYNC_ARTIFACT_KINDS = [
  "sync-state",
  "sync-log",
  "versioning-state",
  "form-state",
  "validation-cache",
  "validation-resolved-archive",
  "gsc-url-inspection",
  "runtime-issues",
  "sites-yml",
  "user-store",
] as const;

export type SyncArtifactKind = (typeof SYNC_ARTIFACT_KINDS)[number];

export function isSyncArtifactKind(value: string): value is SyncArtifactKind {
  return (SYNC_ARTIFACT_KINDS as readonly string[]).includes(value);
}

export interface SyncArtifactMeta {
  kind: SyncArtifactKind;
  label: string;
  requiresSiteFolder: boolean;
  confirmMutations: boolean;
  contentType: string;
  gcsKey: string;
  readKeys: string[];
  localPath: string;
}

export interface SyncArtifactActionResult {
  success: boolean;
  message: string;
  gcsKey?: string;
  source?: "gcs" | "local";
  uploaded?: boolean;
  reason?: string;
}

/** Max bytes returned by View. Upload/download still use the full file. */
export const VIEW_PREVIEW_MAX_BYTES = 512 * 1024;
/** Skip JSON pretty-print above this — indenting a large cache can 2–3× the payload. */
const PRETTY_PRINT_MAX_BYTES = 256 * 1024;

export interface SyncArtifactContentResult {
  success: boolean;
  exists: boolean;
  path: string;
  content: string | null;
  contentType: string;
  error?: string;
  truncated?: boolean;
  byteSize?: number;
  previewLimit?: number;
}

function findSiteContext(siteFolder: string): SiteContext | null {
  const normalized = siteFolder.replace(/\\/g, "/").replace(/^\/|\/$/g, "");
  for (const ctx of getSiteContextMap().values()) {
    if (
      ctx.contentRootName === normalized ||
      ctx.config.contentFolder === normalized ||
      ctx.contentRootName.replace(/\\/g, "/") === normalized
    ) {
      return ctx;
    }
  }
  return null;
}

function requireSite(siteFolder: string | undefined | null): SiteContext {
  if (!siteFolder) {
    throw new Error("siteFolder is required for this artifact.");
  }
  const ctx = findSiteContext(siteFolder);
  if (!ctx) {
    throw new Error(`Unknown site folder: ${siteFolder}`);
  }
  return ctx;
}

function contentRootFor(siteFolder: string): string {
  return path.join(process.cwd(), siteFolder);
}

function isDefaultSiteFolder(siteFolder: string): boolean {
  const configs = getSiteConfigs();
  return configs[0]?.contentFolder === siteFolder;
}

export function resolveArtifactMeta(
  kind: SyncArtifactKind,
  siteFolder?: string | null,
): SyncArtifactMeta {
  switch (kind) {
    case "sites-yml":
      return {
        kind,
        label: "Site registry (sites.yml)",
        requiresSiteFolder: false,
        confirmMutations: false,
        contentType: "application/x-yaml",
        gcsKey: platformSitesYmlGcsKey(),
        readKeys: platformSitesYmlReadKeys(),
        localPath: path.join(process.cwd(), platformSitesYmlLocalFilename()),
      };
    case "user-store":
      return {
        kind,
        label: "User/auth store",
        requiresSiteFolder: false,
        confirmMutations: false,
        contentType: "application/json",
        gcsKey: platformUserStoreGcsKey(),
        readKeys: userStoreReadKeys(),
        localPath: path.join(process.cwd(), platformUserStoreLocalFilename()),
      };
    case "sync-state": {
      const folder = siteFolder!;
      return {
        kind,
        label: "Sync state",
        requiresSiteFolder: true,
        confirmMutations: true,
        contentType: "application/json",
        gcsKey: siteSyncGcsKey(folder, SYNC_FILENAMES.syncState),
        readKeys: syncStateReadKeys(folder),
        localPath: path.join(contentRootFor(folder), ".sync-state.json"),
      };
    }
    case "sync-log": {
      const folder = siteFolder!;
      return {
        kind,
        label: "Sync log",
        requiresSiteFolder: true,
        confirmMutations: true,
        contentType: "text/plain",
        gcsKey: siteSyncGcsKey(folder, SYNC_FILENAMES.syncLog),
        readKeys: syncLogReadKeys(folder),
        localPath: path.join(contentRootFor(folder), ".sync-log-state.txt"),
      };
    }
    case "versioning-state": {
      const folder = siteFolder!;
      return {
        kind,
        label: "Versioning state",
        requiresSiteFolder: true,
        confirmMutations: false,
        contentType: "application/json",
        gcsKey: siteSyncGcsKey(folder, SYNC_FILENAMES.versioningState),
        readKeys: versioningStateReadKeys(folder),
        localPath: path.join(contentRootFor(folder), ".versioning-state.json"),
      };
    }
    case "form-state": {
      const folder = siteFolder!;
      return {
        kind,
        label: "Form registry",
        requiresSiteFolder: true,
        confirmMutations: false,
        contentType: "application/json",
        gcsKey: siteSyncGcsKey(folder, SYNC_FILENAMES.formState),
        readKeys: formStateReadKeys(folder, isDefaultSiteFolder(folder)),
        localPath: path.join(contentRootFor(folder), ".form-state.json"),
      };
    }
    case "validation-cache": {
      const folder = siteFolder!;
      return {
        kind,
        label: "Validation cache",
        requiresSiteFolder: true,
        confirmMutations: false,
        contentType: "application/json",
        gcsKey: siteSyncGcsKey(folder, SYNC_FILENAMES.validationCache),
        readKeys: validationCacheReadKeys(folder),
        localPath: path.join(contentRootFor(folder), "validation-cache.json"),
      };
    }
    case "validation-resolved-archive": {
      const folder = siteFolder!;
      return {
        kind,
        label: "Resolved issues archive",
        requiresSiteFolder: true,
        confirmMutations: false,
        contentType: "application/json",
        gcsKey: siteSyncGcsKey(folder, SYNC_FILENAMES.validationResolvedArchive),
        readKeys: validationResolvedArchiveReadKeys(folder),
        localPath: path.join(contentRootFor(folder), SYNC_FILENAMES.validationResolvedArchive),
      };
    }
    case "gsc-url-inspection": {
      const folder = siteFolder!;
      return {
        kind,
        label: "Search Console inspection",
        requiresSiteFolder: true,
        confirmMutations: false,
        contentType: "application/json",
        gcsKey: siteSyncGcsKey(folder, SYNC_FILENAMES.gscUrlInspection),
        readKeys: gscUrlInspectionReadKeys(folder),
        localPath: path.join(process.cwd(), ".cache", folder, SYNC_FILENAMES.gscUrlInspection),
      };
    }
    case "runtime-issues": {
      const folder = siteFolder!;
      return {
        kind,
        label: "Runtime issues",
        requiresSiteFolder: true,
        confirmMutations: false,
        contentType: "application/json",
        gcsKey: siteSyncGcsKey(folder, SYNC_FILENAMES.runtimeIssuesState),
        readKeys: runtimeIssuesStateReadKeys(folder),
        localPath: path.join(contentRootFor(folder), `.${SYNC_FILENAMES.runtimeIssuesState}`),
      };
    }
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unknown artifact kind: ${_exhaustive}`);
    }
  }
}

export function artifactKindFromInventoryId(id: string): SyncArtifactKind | null {
  if (id === "multisite-platform-sites-yml") return "sites-yml";
  if (id === "multisite-user-store") return "user-store";
  if (id.startsWith("sync-state-")) return "sync-state";
  if (id.startsWith("sync-log-")) return "sync-log";
  if (id.startsWith("versioning-")) return "versioning-state";
  if (id.startsWith("form-state-")) return "form-state";
  if (id.startsWith("validation-cache-")) return "validation-cache";
  if (id.startsWith("validation-resolved-archive-")) return "validation-resolved-archive";
  if (id.startsWith("gsc-url-inspection-")) return "gsc-url-inspection";
  if (id.startsWith("runtime-issues-")) return "runtime-issues";
  return null;
}

export async function uploadSyncArtifact(
  kind: SyncArtifactKind,
  siteFolder?: string | null,
): Promise<SyncArtifactActionResult> {
  const meta = resolveArtifactMeta(kind, siteFolder);
  if (meta.requiresSiteFolder && !siteFolder) {
    return { success: false, message: "siteFolder is required.", reason: "siteFolder is required." };
  }

  try {
    switch (kind) {
      case "sites-yml": {
        const { reuploadSitesYmlToBucket } = await import("./sites-yml-store");
        const result = await reuploadSitesYmlToBucket();
        if (!result.success) {
          return {
            success: false,
            message: result.reason ?? "Could not upload site registry.",
            gcsKey: result.gcsKey,
            reason: result.reason,
            uploaded: false,
          };
        }
        return {
          success: true,
          uploaded: true,
          gcsKey: result.gcsKey,
          message: `Uploaded site registry to ${result.gcsKey}.`,
        };
      }
      case "user-store": {
        const { reuploadUsersStateToBucket } = await import("./user-store");
        const result = await reuploadUsersStateToBucket();
        if (!result.success) {
          return {
            success: false,
            message: result.reason ?? "Could not upload user store.",
            gcsKey: result.gcsKey,
            reason: result.reason,
            uploaded: false,
          };
        }
        return {
          success: true,
          uploaded: true,
          gcsKey: result.gcsKey,
          message: `Uploaded user store to ${result.gcsKey}.`,
        };
      }
      case "sync-state": {
        const ctx = requireSite(siteFolder);
        const { reuploadSyncStateToBucket } = await import("./sync-state");
        const result = await reuploadSyncStateToBucket(ctx.contentRoot);
        if (!result.success) {
          return {
            success: false,
            message: result.reason ?? "Could not upload sync state.",
            gcsKey: result.gcsKey,
            reason: result.reason,
            uploaded: false,
          };
        }
        return {
          success: true,
          uploaded: true,
          gcsKey: result.gcsKey,
          message: `Uploaded sync state to ${result.gcsKey}.`,
        };
      }
      case "sync-log": {
        const ctx = requireSite(siteFolder);
        const result = await ctx.syncLog.forceUploadToBucket();
        if (!result.success) {
          return {
            success: false,
            message: result.reason ?? "Could not upload sync log.",
            gcsKey: result.gcsKey,
            reason: result.reason,
            uploaded: false,
          };
        }
        return {
          success: true,
          uploaded: true,
          gcsKey: result.gcsKey,
          message: `Uploaded sync log to ${result.gcsKey}.`,
        };
      }
      case "versioning-state": {
        const ctx = requireSite(siteFolder);
        const result = await ctx.versioningManager.forceUploadStateToBucket();
        if (!result.success) {
          return {
            success: false,
            message: result.reason ?? "Could not upload versioning state.",
            gcsKey: result.gcsKey,
            reason: result.reason,
            uploaded: false,
          };
        }
        return {
          success: true,
          uploaded: true,
          gcsKey: result.gcsKey,
          message: `Uploaded versioning state to ${result.gcsKey}.`,
        };
      }
      case "form-state": {
        const { reuploadFormStateToBucket } = await import("./form-state");
        const result = await reuploadFormStateToBucket(siteFolder!);
        if (!result.success) {
          return {
            success: false,
            message: result.reason ?? "Could not upload form registry.",
            gcsKey: result.gcsKey,
            reason: result.reason,
            uploaded: false,
          };
        }
        return {
          success: true,
          uploaded: true,
          gcsKey: result.gcsKey,
          message: `Uploaded form registry to ${result.gcsKey}.`,
        };
      }
      case "validation-cache": {
        const ctx = requireSite(siteFolder);
        const result = await ctx.validationCache.forceUploadToBucket();
        if (!result.success) {
          return {
            success: false,
            message: result.reason ?? "Could not upload validation cache.",
            gcsKey: result.gcsKey,
            reason: result.reason,
            uploaded: false,
          };
        }
        return {
          success: true,
          uploaded: true,
          gcsKey: result.gcsKey,
          message: `Uploaded validation cache to ${result.gcsKey}.`,
        };
      }
      case "validation-resolved-archive": {
        const ctx = requireSite(siteFolder);
        const result = await ctx.resolvedIssuesArchive.forceUploadToBucket();
        if (!result.success) {
          return {
            success: false,
            message: result.reason ?? "Could not upload resolved issues archive.",
            gcsKey: result.gcsKey,
            reason: result.reason,
            uploaded: false,
          };
        }
        return {
          success: true,
          uploaded: true,
          gcsKey: result.gcsKey,
          message: `Uploaded resolved issues archive to ${result.gcsKey}.`,
        };
      }
      case "gsc-url-inspection": {
        const ctx = requireSite(siteFolder);
        const { forceUploadGscInspectionToBucket } = await import("./gsc-url-inspection");
        const result = await forceUploadGscInspectionToBucket(ctx.contentRootName);
        if (!result.success) {
          return {
            success: false,
            message: result.reason ?? "Could not upload Search Console inspection cache.",
            gcsKey: result.gcsKey,
            reason: result.reason,
            uploaded: false,
          };
        }
        return {
          success: true,
          uploaded: true,
          gcsKey: result.gcsKey,
          message: `Uploaded Search Console inspection cache to ${result.gcsKey}.`,
        };
      }
      case "runtime-issues": {
        const ctx = requireSite(siteFolder);
        const { reuploadRuntimeIssuesToBucket } = await import("./runtime-issues-store");
        const result = await reuploadRuntimeIssuesToBucket(
          ctx.contentRootName,
          ctx.contentRoot,
        );
        if (!result.success) {
          return {
            success: false,
            message: result.reason ?? "Could not upload runtime issues.",
            gcsKey: result.gcsKey,
            reason: result.reason,
            uploaded: false,
          };
        }
        return {
          success: true,
          uploaded: true,
          gcsKey: result.gcsKey,
          message: `Uploaded runtime issues to ${result.gcsKey}.`,
        };
      }
      default: {
        const _exhaustive: never = kind;
        return { success: false, message: `Unknown kind: ${_exhaustive}` };
      }
    }
  } catch (err) {
    log.error({ err, kind, siteFolder }, "uploadSyncArtifact failed");
    return {
      success: false,
      message: err instanceof Error ? err.message : "Upload failed.",
      reason: err instanceof Error ? err.message : "Upload failed.",
      gcsKey: meta.gcsKey,
    };
  }
}

export async function downloadSyncArtifact(
  kind: SyncArtifactKind,
  siteFolder?: string | null,
): Promise<SyncArtifactActionResult> {
  const meta = resolveArtifactMeta(kind, siteFolder);
  if (meta.requiresSiteFolder && !siteFolder) {
    return { success: false, message: "siteFolder is required.", reason: "siteFolder is required." };
  }

  try {
    switch (kind) {
      case "sites-yml": {
        const { refreshSitesYmlConfig } = await import("./sites-yml-store");
        const source = await refreshSitesYmlConfig();
        return {
          success: true,
          source,
          gcsKey: meta.gcsKey,
          message:
            source === "gcs"
              ? "Site registry refreshed from GCS."
              : "Site registry refreshed from local file.",
        };
      }
      case "user-store": {
        const { loadUsersStateFromBucket } = await import("./user-store");
        await loadUsersStateFromBucket();
        const source = process.env.NODE_ENV === "production" ? "gcs" : "local";
        return {
          success: true,
          source,
          gcsKey: meta.gcsKey,
          message:
            source === "gcs"
              ? "User store refreshed from GCS."
              : "User store refreshed from local file.",
        };
      }
      case "sync-state": {
        const ctx = requireSite(siteFolder);
        const { loadSyncStateFromBucket } = await import("./sync-state");
        await loadSyncStateFromBucket(ctx.contentRoot);
        const source = process.env.NODE_ENV === "production" ? "gcs" : "local";
        return {
          success: true,
          source,
          gcsKey: meta.gcsKey,
          message:
            source === "gcs"
              ? "Sync state refreshed from GCS."
              : "Sync state refreshed from local file.",
        };
      }
      case "sync-log": {
        const ctx = requireSite(siteFolder);
        const source = await ctx.syncLog.reloadFromBucket();
        return {
          success: true,
          source,
          gcsKey: meta.gcsKey,
          message:
            source === "gcs"
              ? "Sync log refreshed from GCS."
              : "Sync log refreshed from local file.",
        };
      }
      case "versioning-state": {
        const ctx = requireSite(siteFolder);
        const source = await ctx.versioningManager.reloadStateFromBucket();
        return {
          success: true,
          source,
          gcsKey: meta.gcsKey,
          message:
            source === "gcs"
              ? "Versioning state refreshed from GCS."
              : "Versioning state refreshed from local file.",
        };
      }
      case "form-state": {
        const { loadFormStateForSiteFromBucket } = await import("./form-state");
        const source = await loadFormStateForSiteFromBucket(siteFolder!);
        return {
          success: true,
          source,
          gcsKey: meta.gcsKey,
          message:
            source === "gcs"
              ? "Form registry refreshed from GCS."
              : "Form registry refreshed from local file.",
        };
      }
      case "validation-cache": {
        const ctx = requireSite(siteFolder);
        // In development, Cloud Sync download should pull the production sidecar.
        if (process.env.NODE_ENV !== "production") {
          const pulled = await ctx.validationCache.pullFromBucket();
          return {
            success: pulled.success,
            source: pulled.pulled ? "gcs" : "local",
            gcsKey: pulled.gcsKey || meta.gcsKey,
            message: pulled.pulled
              ? `Validation cache loaded from production (${pulled.issueCount} issues).`
              : pulled.reason ?? "Validation cache could not be loaded from GCS.",
          };
        }
        await ctx.validationCache.loadFromBucket();
        return {
          success: true,
          source: "gcs",
          gcsKey: meta.gcsKey,
          message: "Validation cache refreshed from GCS.",
        };
      }
      case "validation-resolved-archive": {
        const ctx = requireSite(siteFolder);
        if (process.env.NODE_ENV !== "production") {
          const pulled = await ctx.resolvedIssuesArchive.pullFromBucket();
          return {
            success: pulled.success,
            source: pulled.pulled ? "gcs" : "local",
            gcsKey: pulled.gcsKey || meta.gcsKey,
            message: pulled.pulled
              ? `Resolved archive loaded from production (${pulled.rowCount} rows).`
              : pulled.reason ?? "Resolved archive could not be loaded from GCS.",
          };
        }
        await ctx.resolvedIssuesArchive.loadFromBucket();
        return {
          success: true,
          source: "gcs",
          gcsKey: meta.gcsKey,
          message: "Resolved issues archive refreshed from GCS.",
        };
      }
      case "gsc-url-inspection": {
        const ctx = requireSite(siteFolder);
        const { reloadGscInspectionStoreFromBucket } = await import("./gsc-url-inspection");
        // In development, Cloud Sync download should still pull the production sidecar.
        const forceFromGcs = process.env.NODE_ENV !== "production";
        const source = await reloadGscInspectionStoreFromBucket(ctx.contentRootName, {
          forceFromGcs,
        });
        return {
          success: true,
          source: source === "empty" ? "local" : source,
          gcsKey: meta.gcsKey,
          message:
            source === "gcs"
              ? "Search Console inspection cache refreshed from GCS."
              : "Search Console inspection cache refreshed from local file.",
        };
      }
      case "runtime-issues": {
        const ctx = requireSite(siteFolder);
        const { loadRuntimeIssuesForSite } = await import("./runtime-issues-store");
        await loadRuntimeIssuesForSite(ctx.contentRootName, ctx.contentRoot);
        const source = process.env.NODE_ENV === "production" ? "gcs" : "local";
        return {
          success: true,
          source,
          gcsKey: meta.gcsKey,
          message:
            source === "gcs"
              ? "Runtime issues refreshed from GCS."
              : "Runtime issues refreshed from local file.",
        };
      }
      default: {
        const _exhaustive: never = kind;
        return { success: false, message: `Unknown kind: ${_exhaustive}` };
      }
    }
  } catch (err) {
    log.error({ err, kind, siteFolder }, "downloadSyncArtifact failed");
    return {
      success: false,
      message: err instanceof Error ? err.message : "Download failed.",
      reason: err instanceof Error ? err.message : "Download failed.",
      gcsKey: meta.gcsKey,
    };
  }
}

export function readSyncArtifactContent(
  kind: SyncArtifactKind,
  siteFolder?: string | null,
): SyncArtifactContentResult {
  try {
    const meta = resolveArtifactMeta(kind, siteFolder);
    if (meta.requiresSiteFolder && !siteFolder) {
      return {
        success: false,
        exists: false,
        path: "",
        content: null,
        contentType: meta.contentType,
        error: "siteFolder is required.",
      };
    }

    // Prefer live paths from stores when available (user-store may use legacy path).
    let localPath = meta.localPath;
    if (kind === "user-store") {
      localPath = getUsersStateLocalPath();
    } else if (kind === "sites-yml") {
      localPath = path.join(process.cwd(), platformSitesYmlLocalFilename());
    } else if (siteFolder) {
      const ctx = findSiteContext(siteFolder);
      if (ctx) {
        if (kind === "sync-log") localPath = ctx.syncLog.getLocalPath();
        if (kind === "versioning-state") localPath = ctx.versioningManager.getStateLocalPath();
        if (kind === "validation-cache") localPath = ctx.validationCache.getLocalPath();
      }
    }

    if (!fs.existsSync(localPath)) {
      return {
        success: true,
        exists: false,
        path: localPath,
        content: null,
        contentType: meta.contentType,
        error: "Local file not found.",
      };
    }

    const byteSize = fs.statSync(localPath).size;
    const previewLimit = VIEW_PREVIEW_MAX_BYTES;

    if (byteSize > VIEW_PREVIEW_MAX_BYTES) {
      const buf = Buffer.alloc(VIEW_PREVIEW_MAX_BYTES);
      const fd = fs.openSync(localPath, "r");
      try {
        fs.readSync(fd, buf, 0, VIEW_PREVIEW_MAX_BYTES, 0);
      } finally {
        fs.closeSync(fd);
      }
      let content = buf.toString("utf-8");
      if (content.endsWith("\uFFFD")) content = content.slice(0, -1);
      return {
        success: true,
        exists: true,
        path: localPath,
        content,
        contentType: meta.contentType,
        truncated: true,
        byteSize,
        previewLimit,
      };
    }

    const raw = fs.readFileSync(localPath, "utf-8");
    let content = raw;
    if (meta.contentType === "application/json" && byteSize <= PRETTY_PRINT_MAX_BYTES) {
      try {
        content = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        // keep raw
      }
    }

    const previewBytes = Buffer.byteLength(content, "utf-8");
    const truncated = previewBytes > VIEW_PREVIEW_MAX_BYTES;
    if (truncated) {
      const sliced = Buffer.from(content, "utf-8").subarray(0, VIEW_PREVIEW_MAX_BYTES).toString("utf-8");
      content = sliced.endsWith("\uFFFD") ? sliced.slice(0, -1) : sliced;
    }

    return {
      success: true,
      exists: true,
      path: localPath,
      content,
      contentType: meta.contentType,
      truncated,
      byteSize,
      previewLimit,
    };
  } catch (err) {
    return {
      success: false,
      exists: false,
      path: "",
      content: null,
      contentType: "text/plain",
      error: err instanceof Error ? err.message : "Failed to read artifact.",
    };
  }
}
