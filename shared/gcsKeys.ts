/** Canonical GCS key builders for multisite bucket layout. */

export const SYNC_FILENAMES = {
  syncState: "sync-state.json",
  syncLog: "sync-log-state.txt",
  versioningState: "versioning-state.json",
  formState: "form-state.json",
  validationCache: "validation-cache.json",
  usersState: "users-state.json",
  runtimeIssuesState: "runtime-issues-state.json",
  runtimeIssuesIgnore: "runtime-issues-ignore.json",
  gscUrlInspection: "gsc-url-inspection.json",
  linkIndex: "link-index.json",
} as const;

export type SyncFilename = (typeof SYNC_FILENAMES)[keyof typeof SYNC_FILENAMES];

export function siteSyncGcsKey(site: string, filename: SyncFilename | string): string {
  return `${site}/sync/${filename}`;
}

export function legacyPerSiteSyncGcsKey(site: string, filename: SyncFilename | string): string {
  return `sync/${site}/${filename}`;
}

export function legacyGlobalSyncGcsKey(filename: SyncFilename | string): string {
  return `sync/${filename}`;
}

export function platformUserStoreGcsKey(): string {
  return "multisite-global/users-state.json";
}

/** Legacy prefix before platform files were consolidated under multisite-global/. */
export function legacyPlatformUserStoreGcsKey(): string {
  return "multisite-user-store/users-state.json";
}

export function platformUserStoreLocalFilename(): string {
  return ".multisite-user-store.json";
}

export function platformSitesYmlGcsKey(): string {
  return "multisite-global/sites.yml";
}

/** Legacy prefix before platform files were consolidated under multisite-global/. */
export function legacyPlatformSitesYmlGcsKey(): string {
  return "multisite-platform/sites.yml";
}

export function platformSitesYmlLocalFilename(): string {
  return "sites.yml";
}

export function platformSitesYmlReadKeys(): string[] {
  return [platformSitesYmlGcsKey(), legacyPlatformSitesYmlGcsKey()];
}

export function siteConversationsGcsKey(site: string, conversationId: string): string {
  return `${site}/conversations/${conversationId}/context.json`;
}

export function siteConversationsGcsPrefix(site: string): string {
  return `${site}/conversations/`;
}

export function legacyConversationsGcsPrefix(site: string): string {
  return `conversations/${site}/`;
}

export function siteLighthouseGcsPrefix(site: string, date: string): string {
  return `${site}/reports/lighthouse/${date}`;
}

export function siteLighthouseGcsPrefixRoot(site: string): string {
  return `${site}/reports/lighthouse/`;
}

export function legacyLighthouseGcsPrefixRoot(): string {
  return "reports/lighthouse/";
}

export function siteMediaGcsPrefix(site: string, mediaSegment = process.env.GCS_BASE_PATH || "media"): string {
  return `${site}/${mediaSegment}/`;
}

export function syncStateReadKeys(site: string): string[] {
  return [
    siteSyncGcsKey(site, SYNC_FILENAMES.syncState),
    legacyPerSiteSyncGcsKey(site, SYNC_FILENAMES.syncState),
    legacyGlobalSyncGcsKey(SYNC_FILENAMES.syncState),
  ];
}

export function syncLogReadKeys(site: string): string[] {
  return [
    siteSyncGcsKey(site, SYNC_FILENAMES.syncLog),
    legacyPerSiteSyncGcsKey(site, SYNC_FILENAMES.syncLog),
  ];
}

export function versioningStateReadKeys(site: string): string[] {
  return [
    siteSyncGcsKey(site, SYNC_FILENAMES.versioningState),
    legacyPerSiteSyncGcsKey(site, SYNC_FILENAMES.versioningState),
    legacyGlobalSyncGcsKey(SYNC_FILENAMES.versioningState),
  ];
}

export function formStateReadKeys(site: string, isDefaultSite: boolean): string[] {
  const keys = [siteSyncGcsKey(site, SYNC_FILENAMES.formState)];
  if (isDefaultSite) keys.push(legacyGlobalSyncGcsKey(SYNC_FILENAMES.formState));
  return keys;
}

export function validationCacheReadKeys(site: string): string[] {
  return [siteSyncGcsKey(site, SYNC_FILENAMES.validationCache)];
}

export function gscUrlInspectionReadKeys(site: string): string[] {
  return [siteSyncGcsKey(site, SYNC_FILENAMES.gscUrlInspection)];
}

export function runtimeIssuesStateReadKeys(site: string): string[] {
  return [
    siteSyncGcsKey(site, SYNC_FILENAMES.runtimeIssuesState),
    legacyPerSiteSyncGcsKey(site, SYNC_FILENAMES.runtimeIssuesState),
  ];
}

export function runtimeIssuesIgnoreReadKeys(site: string): string[] {
  return [
    siteSyncGcsKey(site, SYNC_FILENAMES.runtimeIssuesIgnore),
    legacyPerSiteSyncGcsKey(site, SYNC_FILENAMES.runtimeIssuesIgnore),
  ];
}

export function linkIndexReadKeys(site: string): string[] {
  return [siteSyncGcsKey(site, SYNC_FILENAMES.linkIndex)];
}

/** Prefix for per-database semantic search result cache objects. */
export function siteDbSearchCachePrefix(site: string, dbName: string): string {
  return `${site}/db-search-cache/${dbName}/`;
}

export function siteDbSearchCacheKey(
  site: string,
  dbName: string,
  queryHash: string,
): string {
  return `${siteDbSearchCachePrefix(site, dbName)}${queryHash}.json`;
}

export function userStoreReadKeys(): string[] {
  return [
    platformUserStoreGcsKey(),
    legacyPlatformUserStoreGcsKey(),
    legacyGlobalSyncGcsKey(SYNC_FILENAMES.usersState),
  ];
}
