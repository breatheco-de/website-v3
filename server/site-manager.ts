import path from "path";
import fs from "fs";
import type { Request, Response, NextFunction } from "express";
import { getSiteConfigs, hasMultipleSites, type SiteConfig } from "./site-config";
// (getSiteConfigs also feeds the alias→canonical redirect map below)
import { ContentIndex } from "./content-index";
import { MediaGallery } from "./media-gallery";
import { ValidationCacheService } from "./services/validationCacheService";
import { ResolvedIssuesArchiveService } from "./services/resolvedIssuesArchiveService";
import { failInterruptedEnvelopes } from "./services/diagnosticsJobService";
import { AutoCommitQueue } from "./auto-commit";
import { VersioningManager } from "./versioning/VersioningManager";
import { DatabaseManager } from "./database";
import { ConversationStore } from "./ai/ConversationStore";
import { SyncLog } from "./sync-log";
import { createSiteDb } from "./db";
import { getVariableManager, resetVariableManagerCache, type VariableManager } from "./variable-manager";
import { EntryPreviewManager } from "./entry-preview-manager";
import { child } from "./logger";

const log = child({ module: "site-manager" });

export interface SiteContext {
  config: SiteConfig;
  contentIndex: ContentIndex;
  mediaGallery: MediaGallery;
  contentRoot: string;
  contentRootName: string;
  validationCache: ValidationCacheService;
  resolvedIssuesArchive: ResolvedIssuesArchiveService;
  autoCommitQueue: AutoCommitQueue;
  versioningManager: VersioningManager;
  database: DatabaseManager;
  conversationStore: ConversationStore;
  syncLog: SyncLog;
  variableManager: VariableManager;
  entryPreviewManager: EntryPreviewManager;
  isDevOverride?: boolean;
}

declare global {
  namespace Express {
    interface Locals {
      site: SiteContext;
    }
  }
}

let _siteMap: Map<string, SiteContext> | null = null;
let _defaultSite: SiteContext | null = null;

/**
 * Construct a brand-new site context map from the current configs WITHOUT
 * touching any live global state. If any site's construction throws, the
 * exception propagates and no globals have been mutated — the caller decides
 * whether/when to commit. This is the shared core for both the lazy initial
 * build and the atomic rebuild used by soft reload.
 */
function constructSiteContextMap(): { map: Map<string, SiteContext>; defaultSite: SiteContext | null } {
  const configs = getSiteConfigs();
  const map = new Map<string, SiteContext>();

  // The first registered site is the primary/default site and inherits any
  // legacy shared data/app.db so existing conversations are not lost on
  // upgrade.  Secondary sites start with an empty DB to prevent cross-site
  // data leakage.
  let isFirstSite = true;

  for (const config of configs) {
    const contentRoot = path.isAbsolute(config.contentFolder)
      ? config.contentFolder
      : path.join(process.cwd(), config.contentFolder);
    const contentRootName = path.relative(process.cwd(), contentRoot);
    const mg = new MediaGallery(config.contentFolder);
    const database = new DatabaseManager(contentRoot, mg);
    const ci = new ContentIndex(config.contentFolder, database);
    const resolvedIssuesArchive = new ResolvedIssuesArchiveService(contentRoot);
    const validationCache = new ValidationCacheService(contentRoot, resolvedIssuesArchive);
    failInterruptedEnvelopes(contentRoot);
    const autoCommitQueue = new AutoCommitQueue(contentRootName);
    const versioningManager = new VersioningManager(contentRoot);
    const siteDb = createSiteDb(contentRootName, isFirstSite);
    const conversationStore = new ConversationStore(siteDb, contentRootName);
    const syncLog = new SyncLog(contentRoot, contentRootName, isFirstSite);
    const variableManager = getVariableManager(contentRoot);
    const entryPreviewManager = new EntryPreviewManager(contentRoot, mg);
    isFirstSite = false;
    const ctx: SiteContext = { config, contentIndex: ci, mediaGallery: mg, contentRoot, contentRootName, validationCache, resolvedIssuesArchive, autoCommitQueue, versioningManager, database, conversationStore, syncLog, variableManager, entryPreviewManager };
    map.set(config.domain, ctx);
    log.info(`[SiteManager] Registered site domain="${config.domain}" contentFolder="${config.contentFolder}"`);
  }

  return { map, defaultSite: map.values().next().value ?? null };
}

export function buildSiteContextMap(): Map<string, SiteContext> {
  if (_siteMap) return _siteMap;

  const { map, defaultSite } = constructSiteContextMap();
  _siteMap = map;
  _defaultSite = defaultSite;
  return map;
}

/**
 * Atomically rebuild the site context map. A fresh map is constructed off to
 * the side first; the live `_siteMap`/`_defaultSite` are only swapped once the
 * new map is fully built. If construction throws, the previously serving map is
 * left completely untouched (no null window, no half-torn-down state), so a
 * failed reload never degrades the running process.
 */
export function rebuildSiteContextMap(): Map<string, SiteContext> {
  const { map, defaultSite } = constructSiteContextMap();
  _siteMap = map;
  _defaultSite = defaultSite;
  resetVariableManagerCache();
  return map;
}

export function getSiteContextMap(): Map<string, SiteContext> {
  return _siteMap ?? buildSiteContextMap();
}

export function getDefaultSite(): SiteContext {
  if (!_defaultSite) buildSiteContextMap();
  if (!_defaultSite) throw new Error("[SiteManager] No sites configured");
  return _defaultSite;
}

export function resetSiteContextMap(): void {
  _siteMap = null;
  _defaultSite = null;
  resetVariableManagerCache();
}

export interface SiteContextMapSnapshot {
  map: Map<string, SiteContext> | null;
  defaultSite: SiteContext | null;
}

/** Capture the current context map so it can be restored after a failed rebuild. */
export function snapshotSiteContextMap(): SiteContextMapSnapshot {
  return { map: _siteMap, defaultSite: _defaultSite };
}

/** Restore a previously captured context map (used to roll back a failed rebuild). */
export function restoreSiteContextMap(snap: SiteContextMapSnapshot): void {
  _siteMap = snap.map;
  _defaultSite = snap.defaultSite;
  resetVariableManagerCache();
}

/** Per-request VariableManager from site context. */
export function getVM(res: Response): VariableManager {
  const site = res.locals.site as SiteContext | undefined;
  return site?.variableManager ?? getVariableManager(site?.contentRoot);
}

// =============================================================================
// DEV SITE OVERRIDE — FILE-BASED APPROACH
// =============================================================================
//
// The active dev site is stored in a plain text file on disk:
//   .local/dev-site-override
//
// ⚠️  DO NOT REPLACE THIS WITH COOKIES — EVER.
//
// We tried cookies. They do not work reliably in the Replit dev environment.
// Here is exactly why:
//
//   Replit's workspace embeds the app (worf.replit.dev) inside an iframe on
//   replit.com. Modern browsers treat the embedded domain as a THIRD-PARTY
//   context relative to the top-level page (replit.com). This means:
//
//   • document.cookie writes from the app are silently ignored by Chrome/Edge
//     when third-party cookie blocking is active (Chrome 115+).
//
//   • Set-Cookie response headers from the server (even with SameSite=None;
//     Secure) are also blocked — the browser receives the header but does NOT
//     store the cookie for future requests.
//
//   • The result: the server calls /api/dev/set-site, gets {"ok":true}, but
//     the cookie is never sent on the next request. The site never switches.
//
//   We tested SameSite=Lax, SameSite=None; Secure, and server-side Set-Cookie.
//   All three fail silently in the Replit iframe context.
//
// The file-based approach bypasses all of this:
//   • The file is written by the server (no browser involved).
//   • The file is read by the server synchronously on every request.
//   • No cookies, no iframe restrictions, no browser policy issues.
//
// localStorage is used as a CLIENT-SIDE MIRROR only — written in lockstep
// with the file so injectDevSite() can append ?__site= to API calls. The file
// is still the canonical server-side truth; localStorage is never the source
// of truth for site resolution.
//
// =============================================================================

const DEV_SITE_FILE = path.join(process.cwd(), ".local", "dev-site-override");

/**
 * Read the active dev-site override from disk.
 * Returns null when the file is absent (no override active).
 * DO NOT replace this with a cookie read — see the warning block above.
 */
export function readDevSiteFile(): string | null {
  try {
    const value = fs.readFileSync(DEV_SITE_FILE, "utf8").trim();
    return value || null;
  } catch {
    return null;
  }
}

/**
 * Write the active dev-site override to disk.
 * Called by GET /api/dev/set-site. Creates .local/ if needed.
 */
export function writeDevSiteFile(domain: string): void {
  fs.mkdirSync(path.dirname(DEV_SITE_FILE), { recursive: true });
  fs.writeFileSync(DEV_SITE_FILE, domain, "utf8");
}

/**
 * Delete the dev-site override file (reverts to req.hostname resolution).
 * Called by GET /api/dev/clear-site.
 */
export function clearDevSiteFile(): void {
  try { fs.unlinkSync(DEV_SITE_FILE); } catch {}
}

/** Cached alias hostname → canonical domain map. Rebuilt when site configs change. */
let _aliasMap: Map<string, string> | null = null;
let _aliasMapSource: SiteConfig[] | null = null;

function getAliasMap(): Map<string, string> {
  const configs = getSiteConfigs();
  // getSiteConfigs() returns a cached array; identity changes only on reload.
  if (_aliasMap && _aliasMapSource === configs) return _aliasMap;
  const map = new Map<string, string>();
  for (const config of configs) {
    for (const alias of config.aliases ?? []) {
      map.set(alias.toLowerCase(), config.domain);
    }
  }
  _aliasMap = map;
  _aliasMapSource = configs;
  return map;
}

export function siteResolutionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const sites = getSiteContextMap();
  let domain = req.hostname;

  // CANONICAL DOMAIN REDIRECT — alias hostnames (e.g. www.4geeks.com) get a
  // permanent redirect to their canonical domain, preserving path and query.
  // Runs before any dev override so aliases never serve duplicate content.
  // In production the target is always canonical HTTPS; in development we
  // preserve the request's protocol and port so local/hosts-file testing
  // stays within the local environment.
  const canonical = getAliasMap().get(domain?.toLowerCase?.() ?? "");
  if (canonical && canonical !== domain) {
    if (process.env.NODE_ENV === "production") {
      res.redirect(301, `https://${canonical}${req.originalUrl}`);
    } else {
      const hostHeader = req.headers.host ?? "";
      const portSuffix = hostHeader.includes(":") ? `:${hostHeader.split(":").pop()}` : "";
      res.redirect(301, `${req.protocol}://${canonical}${portSuffix}${req.originalUrl}`);
    }
    return;
  }
  let isDevOverride = false;

  // DEV SITE OVERRIDE — reads .local/dev-site-override (non-production only).
  //
  // In PRODUCTION this block is skipped entirely. Site resolution is driven
  // by req.hostname (the actual subdomain/domain of the incoming request).
  // There is no override mechanism in production — and there should never be.
  //
  // In DEVELOPMENT the file is the single source of truth. If absent, falls
  // through to req.hostname (which on Replit dev URLs is the worf.replit.dev
  // hostname, not a real site domain, so the default site is used instead).
  //
  // Additionally, ?__site=<domain> on individual requests acts as a per-request
  // override so TanStack Query fetches with the injected param resolve to the
  // correct site even before a full reload (belt-and-suspenders with the file).
  //
  // ⚠️  DO NOT add a cookie-based fallback here. See the warning block above.
  if (process.env.NODE_ENV !== "production") {
    const fileSite = readDevSiteFile();
    if (fileSite) {
      domain = fileSite;
      isDevOverride = true;
    }
    // Per-request override via query param — lets each API call resolve to the
    // correct site immediately after a site switch (before the next full reload).
    const querySite = typeof req.query.__site === "string" ? req.query.__site : null;
    if (querySite && sites.has(querySite)) {
      domain = querySite;
      isDevOverride = true;
    }
  }

  let ctx = sites.get(domain);
  if (!ctx) {
    if (sites.size > 1) {
      log.warn(`[SiteManager] Unknown hostname "${domain}" — falling back to default site`);
    }
    ctx = getDefaultSite();
  }

  res.locals.site = { ...ctx, isDevOverride };
  next();
}

export function getSiteInfo(req: Request, res: Response): { domain: string; contentFolder: string; isMultiSite: boolean; siteCount: number; isDevOverride: boolean; githubRepoUrl?: string } {
  const site = res.locals.site ?? getDefaultSite();
  const configs = getSiteConfigs();
  return {
    domain: site.config.domain,
    contentFolder: site.config.contentFolder,
    isMultiSite: hasMultipleSites(),
    siteCount: configs.length,
    isDevOverride: site.isDevOverride ?? false,
    githubRepoUrl: site.config.githubRepoUrl,
  };
}
