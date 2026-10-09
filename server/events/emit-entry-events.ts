/**
 * Emit scoped entry/site events from file changes (shared by web listener + MCP).
 */

import { emitEvent, type EmitResult } from "./event-store";
import type { EventActor, EventType } from "./types";
import { singleAttribution } from "./types";
import { getSiteContextMap } from "../site-manager";
import type { AgentSimpleChange } from "@shared/agent-report-structured";
import {
  diffEntryCommonParts,
  diffEntryLocaleParts,
  parseContentFilePath,
  parseUnresolvedContentPath,
  siteRedirectsChanged,
  type EntryCommonPart,
  type EntryLocalePart,
  type RegistryPart,
} from "./entry-change-parts";
import { shouldSuppressPipelineEmit } from "./save-batch-context";

export type EmitFileChangeOpts = {
  filePath: string;
  prevRaw?: string;
  nextRaw: string;
  author?: string;
  actor?: EventActor;
  cause?: string;
  agent_session_id?: string;
  report?: string;
  why?: string;
  highlights?: string[];
  simple_changes?: AgentSimpleChange[];
  /** @deprecated unused — legacy types removed */
  dualWriteLegacy?: boolean;
  /**
   * When the fixed folder list does not recognize the path, map a content
   * folder to its type. Return null for folders that are not content types.
   */
  resolveFolderType?: (folder: string) => string | null;
};

export type EmittedFileChange = {
  type: EventType;
  id: number;
};

function resolveSiteFromPath(filePath: string): string | null {
  const norm = filePath.replace(/\\/g, "/");
  for (const ctx of getSiteContextMap().values()) {
    if (norm.startsWith(ctx.contentRootName + "/")) return ctx.contentRootName;
  }
  const parts = norm.split("/");
  if (parts[0]?.startsWith("site_")) return parts[0];
  return null;
}

function basePayload(
  path: string,
  opts?: {
    report?: string;
    why?: string;
    highlights?: string[];
    simple_changes?: AgentSimpleChange[];
  },
): Record<string, unknown> {
  return {
    path,
    ...(opts?.report ? { report: opts.report } : {}),
    ...(opts?.why ? { why: opts.why } : {}),
    ...(opts?.highlights?.length ? { highlights: opts.highlights } : {}),
    ...(opts?.simple_changes?.length ? { simple_changes: opts.simple_changes } : {}),
  };
}

/**
 * Classify and emit entry/site events for a tracked content file write.
 */
export function emitEntryEventsFromFileChange(opts: EmitFileChangeOpts): EmittedFileChange[] {
  if (shouldSuppressPipelineEmit()) return [];

  const norm = opts.filePath.replace(/\\/g, "/");
  const site = resolveSiteFromPath(norm);
  if (!site) return [];

  const parsed = (() => {
    const known = parseContentFilePath(norm);
    if (known.scope !== "unknown" || !opts.resolveFolderType) return known;
    return parseUnresolvedContentPath(norm, opts.resolveFolderType);
  })();
  const prev = opts.prevRaw ?? "";
  const next = opts.nextRaw;
  const attribution = singleAttribution(opts.author, opts.actor);
  const emitted: EmittedFileChange[] = [];

  const push = (type: EventType, resource: Record<string, unknown>, payload: Record<string, unknown>) => {
    const r = emitEvent({
      site,
      type,
      resource,
      attribution,
      cause: opts.cause,
      agent_session_id: opts.agent_session_id,
      payload,
    });
    emitted.push({ type, id: r.id });
  };

  switch (parsed.scope) {
    case "entry_locale": {
      const parts = diffEntryLocaleParts(prev, next);
      if (parts.length === 0 && prev === next) break;
      push(
        "entry_locale_saved",
        {
          path: norm,
          contentType: parsed.contentType,
          slug: parsed.slug,
          locale: parsed.locale,
          layer: parsed.layer,
        },
        {
          ...basePayload(norm, opts),
          parts,
          layer: parsed.layer,
        },
      );
      break;
    }
    case "entry_common": {
      const parts = diffEntryCommonParts(prev, next);
      if (parts.length === 0 && prev === next) break;
      push(
        "entry_common_saved",
        {
          path: norm,
          contentType: parsed.contentType,
          slug: parsed.slug,
          layer: "common",
        },
        {
          ...basePayload(norm, opts),
          parts,
          layer: "common",
        },
      );
      break;
    }
    case "site_redirects": {
      if (!siteRedirectsChanged(prev, next)) break;
      push("site_redirects_changed", { path: norm }, basePayload(norm, opts));
      break;
    }
    case "registry": {
      push(
        "registry_file_saved",
        { path: norm },
        {
          ...basePayload(norm, opts),
          parts: [parsed.registryPart] as RegistryPart[],
        },
      );
      break;
    }
    case "shared_template": {
      push(
        "shared_template_saved",
        { path: norm, contentType: parsed.contentType },
        { ...basePayload(norm, opts), contentType: parsed.contentType },
      );
      break;
    }
    default:
      break;
  }

  return emitted;
}

export function emitEntrySeoChanged(opts: {
  site: string;
  contentType: string;
  slug: string;
  locale: string;
  path: string;
  author?: string;
  actor?: EventActor;
  agent_session_id?: string;
  seoIndexSynced?: boolean;
  memberEntryKeys?: string[];
  report?: string;
}): EmitResult {
  return emitEvent({
    site: opts.site,
    type: "entry_seo_changed",
    resource: {
      path: opts.path,
      contentType: opts.contentType,
      slug: opts.slug,
      locale: opts.locale,
      layer: "live",
    },
    attribution: singleAttribution(opts.author, opts.actor),
    agent_session_id: opts.agent_session_id,
    payload: {
      path: opts.path,
      seoIndexSynced: opts.seoIndexSynced ?? false,
      ...(opts.memberEntryKeys?.length ? { memberEntryKeys: opts.memberEntryKeys } : {}),
      ...(opts.report ? { report: opts.report } : {}),
    },
  });
}

export function emitClusterHubPathRewriteStarted(opts: {
  site: string;
  contentType: string;
  slug: string;
  locale: string;
  oldUrl: string;
  newUrl: string;
  author?: string;
  actor?: EventActor;
  agent_session_id?: string;
}): EmitResult {
  return emitEvent({
    site: opts.site,
    type: "cluster_hub_path_rewrite_started",
    resource: {
      contentType: opts.contentType,
      slug: opts.slug,
      locale: opts.locale,
    },
    attribution: singleAttribution(opts.author, opts.actor),
    agent_session_id: opts.agent_session_id,
    payload: {
      oldUrl: opts.oldUrl,
      newUrl: opts.newUrl,
      contentType: opts.contentType,
      slug: opts.slug,
      locale: opts.locale,
      author: opts.author,
    },
  });
}

export function emitEntryDeleted(opts: {
  site: string;
  contentType: string;
  slug: string;
  locale?: string;
  entryKeys: string[];
  deletedPaths: string[];
  folderRemoved: boolean;
  localesRemoved?: string[];
  author?: string;
  actor?: EventActor;
  agent_session_id?: string;
  report?: string;
}): EmitResult {
  return emitEvent({
    site: opts.site,
    type: "entry_deleted",
    resource: {
      contentType: opts.contentType,
      slug: opts.slug,
      ...(opts.locale ? { locale: opts.locale } : {}),
    },
    attribution: singleAttribution(opts.author, opts.actor),
    agent_session_id: opts.agent_session_id,
    payload: {
      entryKeys: opts.entryKeys,
      deletedPaths: opts.deletedPaths,
      folderRemoved: opts.folderRemoved,
      ...(opts.localesRemoved?.length ? { localesRemoved: opts.localesRemoved } : {}),
      ...(opts.report ? { report: opts.report } : {}),
    },
  });
}

export function emitSiteBulkSynced(
  site: string,
  files: string[],
  opts?: { author?: string; actor?: EventActor; deletedPaths?: string[] },
): EmitResult {
  const author = opts?.author ?? "github-pull";
  const actor = opts?.actor ?? { type: "system" as const, source: "github-pull" };
  return emitEvent({
    site,
    type: "site_bulk_synced",
    payload: {
      files,
      count: files.length,
      ...(opts?.deletedPaths?.length ? { deletedPaths: opts.deletedPaths } : {}),
    },
    attribution: singleAttribution(author, actor),
  });
}

export function emitEntryLocalePromoted(opts: {
  site: string;
  contentType: string;
  slug: string;
  locale: string;
  author?: string;
  actor?: EventActor;
  agent_session_id?: string;
}): EmitResult {
  return emitEvent({
    site: opts.site,
    type: "entry_locale_promoted",
    resource: {
      contentType: opts.contentType,
      slug: opts.slug,
      locale: opts.locale,
      layer: "live",
    },
    attribution: singleAttribution(opts.author, opts.actor),
    agent_session_id: opts.agent_session_id,
    payload: { path: `${opts.contentType}/${opts.slug}/${opts.locale}` },
  });
}

export function emitEntryLocaleUnpublished(opts: {
  site: string;
  contentType: string;
  slug: string;
  locale: string;
  author?: string;
  actor?: EventActor;
  agent_session_id?: string;
}): EmitResult {
  return emitEvent({
    site: opts.site,
    type: "entry_locale_unpublished",
    resource: {
      contentType: opts.contentType,
      slug: opts.slug,
      locale: opts.locale,
    },
    attribution: singleAttribution(opts.author, opts.actor),
    agent_session_id: opts.agent_session_id,
    payload: { path: `${opts.contentType}/${opts.slug}/${opts.locale}` },
  });
}

export function emitThemeChanged(site: string, affectsInheritingSites: boolean): EmitResult {
  return emitEvent({
    site,
    type: "theme_changed",
    attribution: singleAttribution(undefined, { type: "ui" }),
    payload: { affectsInheritingSites },
  });
}

export function emitVariablesChanged(site: string, names?: string[]): EmitResult {
  return emitEvent({
    site,
    type: "variables_changed",
    attribution: singleAttribution(undefined, { type: "system", source: "variables" }),
    payload: names?.length ? { names } : {},
  });
}

export function emitMenuChanged(site: string, menuName: string, locale?: string): EmitResult {
  return emitEvent({
    site,
    type: "menu_changed",
    attribution: singleAttribution(undefined, { type: "ui" }),
    payload: locale ? { menuName, locale } : { menuName },
  });
}

export function emitTagManagerChanged(site: string): EmitResult {
  return emitEvent({
    site,
    type: "tag_manager_changed",
    attribution: singleAttribution(undefined, { type: "ui" }),
    payload: {},
  });
}

export function emitDatabaseRowChanged(site: string, dbName: string, slug: string): EmitResult {
  return emitEvent({
    site,
    type: "database_row_changed",
    resource: { slug },
    attribution: singleAttribution(undefined, { type: "system", source: "database" }),
    payload: { dbName, slug },
  });
}

export function emitContentTypeChanged(
  site: string,
  contentType: string,
  opts?: { previousUrlPattern?: Record<string, string> | null },
): EmitResult {
  const urlPatternChanged = !!opts && "previousUrlPattern" in opts;
  return emitEvent({
    site,
    type: "content_type_changed",
    resource: { contentType },
    attribution: singleAttribution(undefined, { type: "ui" }),
    payload: urlPatternChanged
      ? { contentType, urlPatternChanged: true, previousUrlPattern: opts?.previousUrlPattern ?? null }
      : { contentType, urlPatternChanged: false },
  });
}

export function emitDatabaseRefreshed(
  site: string,
  dbName: string,
  rows: { slug: string; locale?: string; params?: Record<string, string> }[],
): EmitResult {
  return emitEvent({
    site,
    type: "database_refreshed",
    attribution: singleAttribution(undefined, { type: "system", source: "database" }),
    payload: { dbName, rows },
  });
}

export type { EntryLocalePart, EntryCommonPart, RegistryPart };
