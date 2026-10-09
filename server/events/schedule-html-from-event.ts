/**
 * The dispatcher asks for HTML rebuilds from the event that already recorded
 * the change. Callers do not pass a page list.
 */

import path from "path";
import type { ContentIndex } from "../content-index";
import {
  classifyTouchedContentFiles,
  collectAttachedHtmlPaths,
  collectEntryHtmlPaths,
} from "../content-write-flush";
import {
  invalidateHotHtmlAndRebuild,
  scheduleCachedSlugHtmlRebuild,
  scheduleContentTypeListingRebuild,
  scheduleDatabaseReaderRebuild,
  scheduleHotHtmlRebuild,
  scheduleSavedHtmlPaths,
} from "../html-rebuild";
import { isSharedTemplateBasename } from "../shared-layout-paths";
import type { RefreshedDatabaseRow } from "../database-refresh-diff";
import type { ContentEvent } from "./types";

export type HtmlEventSite = {
  contentRootName: string;
  contentRoot: string;
  contentIndex?: ContentIndex;
};

function pages(site: HtmlEventSite, paths: string[]): void {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return;
  scheduleSavedHtmlPaths(site.contentRootName, unique, site.contentRoot);
}

function pagesKept(site: HtmlEventSite, paths: string[]): void {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return;
  scheduleSavedHtmlPaths(site.contentRootName, unique, site.contentRoot, { deleteIfSlow: false });
}

function isLocalDatabase(ci: ContentIndex, dbName: string): boolean {
  try {
    return ci.getDatabase().get(dbName).source.type === "local";
  } catch {
    return false;
  }
}

function refreshedRowPaths(ci: ContentIndex, dbName: string, rows: RefreshedDatabaseRow[]): string[] {
  const paths: string[] = [];
  for (const contentType of ci.getContentTypes()) {
    const config = ci.getContentTypeConfig(contentType);
    if (config?.database?.slug !== dbName || !config.url_pattern) continue;
    const locales = Object.keys(config.url_pattern).filter((locale) => locale !== "default");
    for (const row of rows) {
      if (!row.slug) continue;
      const useLocales = row.locale ? [row.locale] : locales.length > 0 ? locales : ["en"];
      for (const locale of useLocales) {
        const pathname = ci.buildUrl(contentType, locale, row.slug, row.params);
        if (pathname && pathname !== "/") paths.push(pathname);
      }
    }
  }
  return paths;
}

function listing(site: HtmlEventSite, contentType: string): void {
  const ci = site.contentIndex;
  if (!ci || !contentType) return;
  scheduleContentTypeListingRebuild({
    siteId: site.contentRootName,
    contentRoot: site.contentRoot,
    contentType: ci.normalizeType(contentType),
  });
}

/** Public URLs of entries that still use a shared template file in this list. */
function attachedTemplatePaths(ci: ContentIndex, files: string[]): string[] {
  const rootName = path.basename(ci.contentRoot);
  const types = new Set<string>();
  const paths: string[] = [];
  for (const file of files) {
    let rel = file.split("\\").join("/");
    const prefix = `${rootName}/`;
    if (rel.startsWith(prefix)) rel = rel.slice(prefix.length);
    else if (path.isAbsolute(rel)) rel = path.relative(ci.contentRoot, rel).split("\\").join("/");
    const parts = rel.split("/").filter(Boolean);
    if (parts.length !== 2) continue;
    if (!isSharedTemplateBasename(parts[1]!)) continue;
    if (!ci.getContentTypeConfig(parts[0]!)) continue;
    const contentType = ci.normalizeType(parts[0]!);
    if (types.has(contentType)) continue;
    types.add(contentType);
    paths.push(...collectAttachedHtmlPaths(ci, contentType));
  }
  return paths;
}

export function scheduleHtmlFromEvent(event: ContentEvent, site: HtmlEventSite): void {
  const ci = site.contentIndex;
  if (!ci) return;
  const layer = event.resource.layer ?? event.payload.layer;

  switch (event.type) {
    case "entry_locale_saved":
    case "entry_locale_promoted": {
      if (layer === "variant") return;
      const { contentType, slug, locale } = event.resource;
      if (!contentType || !slug) return;
      pages(site, collectEntryHtmlPaths(ci, contentType, slug, locale));
      listing(site, contentType);
      return;
    }
    case "entry_common_saved": {
      const { contentType, slug } = event.resource;
      if (!contentType || !slug) return;
      pages(site, collectEntryHtmlPaths(ci, contentType, slug));
      listing(site, contentType);
      return;
    }
    case "entry_deleted":
    case "entry_locale_unpublished": {
      const { contentType, slug, locale } = event.resource;
      if (contentType && slug) {
        pages(site, collectEntryHtmlPaths(ci, contentType, slug, locale));
        listing(site, contentType);
      }
      if (slug) scheduleCachedSlugHtmlRebuild(site.contentRootName, slug, site.contentRoot);
      return;
    }
    case "shared_template_saved": {
      const contentType = String(event.resource.contentType || event.payload.contentType || "");
      if (!contentType) return;
      pages(site, collectAttachedHtmlPaths(ci, contentType));
      listing(site, contentType);
      return;
    }
    case "site_bulk_synced": {
      const files = (event.payload.files as string[] | undefined) ?? [];
      if (files.length === 0) return;
      try {
        ci.refresh({ syncSlow: false });
      } catch {
        /* the rebuild job reads disk itself */
      }
      const classified = classifyTouchedContentFiles(ci, files);
      pages(site, [...classified.htmlPaths, ...attachedTemplatePaths(ci, files)]);
      for (const contentType of classified.contentTypes) listing(site, contentType);
      for (const dbName of classified.databaseNames) {
        if (isLocalDatabase(ci, dbName)) continue;
        scheduleDatabaseReaderRebuild({
          siteId: site.contentRootName,
          contentRoot: site.contentRoot,
          dbName,
        });
      }
      return;
    }
    case "theme_changed": {
      if (event.payload.affectsInheritingSites === true) {
        scheduleHotHtmlRebuild("theme");
      } else {
        scheduleHotHtmlRebuild("theme", site.contentRoot);
      }
      return;
    }
    case "menu_changed": {
      scheduleHotHtmlRebuild("menu", site.contentRoot);
      return;
    }
    case "tag_manager_changed": {
      invalidateHotHtmlAndRebuild("tag-manager");
      return;
    }
    case "variables_changed": {
      const names = Array.isArray(event.payload.names)
        ? (event.payload.names as string[])
        : [];
      if (names.length === 0) {
        scheduleHotHtmlRebuild("variables", site.contentRoot);
        return;
      }
      const files = names.flatMap((name) => ci.getVariableUsage(name));
      const classified = classifyTouchedContentFiles(ci, files);
      pages(site, [...classified.htmlPaths, ...attachedTemplatePaths(ci, files)]);
      for (const contentType of classified.contentTypes) listing(site, contentType);
      return;
    }
    case "database_row_changed": {
      const dbName = String(event.payload.dbName ?? "");
      const slug = String(event.payload.slug ?? event.resource.slug ?? "");
      if (dbName) {
        scheduleDatabaseReaderRebuild({
          siteId: site.contentRootName,
          contentRoot: site.contentRoot,
          dbName,
        });
      }
      if (slug) scheduleCachedSlugHtmlRebuild(site.contentRootName, slug, site.contentRoot);
      return;
    }
    case "database_refreshed": {
      const dbName = String(event.payload.dbName ?? "");
      const rows = Array.isArray(event.payload.rows) ? (event.payload.rows as RefreshedDatabaseRow[]) : [];
      if (dbName) {
        scheduleDatabaseReaderRebuild({
          siteId: site.contentRootName,
          contentRoot: site.contentRoot,
          dbName,
        });
      }
      pagesKept(site, refreshedRowPaths(ci, dbName, rows));
      return;
    }
    default:
      return;
  }
}
