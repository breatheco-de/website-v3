/**
 * Emit content events from file paths (web + MCP shared helper).
 */

import path from "path";
import { emitEvent, type EmitResult } from "./events/event-store";
import type { EventActor } from "./events/types";
import { singleAttribution } from "./events/types";
import { getSiteContextMap } from "./site-manager";

function resolveSiteFromPath(filePath: string): string | null {
  const norm = filePath.replace(/\\/g, "/");
  for (const ctx of getSiteContextMap().values()) {
    if (norm.startsWith(ctx.contentRootName + "/")) return ctx.contentRootName;
  }
  const parts = norm.split("/");
  if (parts[0]?.startsWith("site_")) return parts[0];
  return null;
}

function parseResourceFromPath(filePath: string): {
  path: string;
  contentType?: string;
  slug?: string;
  locale?: string;
} {
  const norm = filePath.replace(/\\/g, "/");
  const m = norm.match(
    /\/(programs|landings|locations|pages|blog|workshops|events|courses)\/([^/]+)\/([^/]+)\.ya?ml$/i,
  );
  if (!m) return { path: norm };
  const folder = m[1]!.toLowerCase();
  const typeMap: Record<string, string> = {
    programs: "program",
    landings: "landing",
    locations: "location",
    pages: "page",
    blog: "blog",
    workshops: "workshop",
    events: "event",
    courses: "course",
  };
  const contentType = typeMap[folder] ?? folder.replace(/s$/, "");
  const slug = m[2]!;
  const base = m[3]!.replace(/\.ya?ml$/i, "");
  if (base === "_common") {
    return { path: norm, contentType, slug };
  }
  let locale = base;
  if (base.startsWith("single.")) locale = base.slice("single.".length);
  else if (base.includes(".")) locale = base.split(".").pop() || base;
  return { path: norm, contentType, slug, locale };
}

export function emitContentFileWritten(
  filePath: string,
  opts?: { author?: string; actor?: EventActor; cause?: string },
): EmitResult | null {
  const site = resolveSiteFromPath(filePath);
  if (!site) return null;
  const resource = parseResourceFromPath(filePath);
  return emitEvent({
    site,
    type: "content_file_written",
    resource,
    attribution: singleAttribution(opts?.author, opts?.actor),
    cause: opts?.cause,
    payload: { path: resource.path },
  });
}

export function emitContentEntryDeleted(opts: {
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
}): EmitResult {
  return emitEvent({
    site: opts.site,
    type: "content_entry_deleted",
    resource: {
      contentType: opts.contentType,
      slug: opts.slug,
      ...(opts.locale ? { locale: opts.locale } : {}),
    },
    attribution: singleAttribution(opts.author, opts.actor),
    payload: {
      entryKeys: opts.entryKeys,
      deletedPaths: opts.deletedPaths,
      folderRemoved: opts.folderRemoved,
      ...(opts.localesRemoved?.length ? { localesRemoved: opts.localesRemoved } : {}),
    },
  });
}

export function emitContentBulkSynced(
  site: string,
  files: string[],
  opts?: { author?: string; actor?: EventActor; deletedPaths?: string[] },
): EmitResult {
  const author = opts?.author ?? "github-pull";
  const actor = opts?.actor ?? { type: "system" as const, source: "github-pull" };
  return emitEvent({
    site,
    type: "content_bulk_synced",
    payload: {
      files,
      count: files.length,
      ...(opts?.deletedPaths?.length ? { deletedPaths: opts.deletedPaths } : {}),
    },
    attribution: singleAttribution(author, actor),
  });
}

export function emitRedirectsChanged(
  filePath: string,
  opts?: { author?: string; actor?: EventActor },
): EmitResult | null {
  const site = resolveSiteFromPath(filePath);
  if (!site) return null;
  return emitEvent({
    site,
    type: "redirects_changed",
    resource: parseResourceFromPath(filePath),
    attribution: singleAttribution(opts?.author, opts?.actor),
    payload: { path: filePath },
  });
}

export function emitBindingPropagationStarted(opts: {
  site: string;
  groupId: string;
  locale: string;
  sourceContentType: string;
  sourceSlug: string;
  sectionIndex: number;
  holder: string;
  token: number;
  author?: string;
  actor?: EventActor;
}): EmitResult {
  return emitEvent({
    site: opts.site,
    type: "binding_propagation_started",
    resource: { groupId: opts.groupId, locale: opts.locale },
    attribution: singleAttribution(opts.author, opts.actor),
    payload: {
      groupId: opts.groupId,
      locale: opts.locale,
      sourceContentType: opts.sourceContentType,
      sourceSlug: opts.sourceSlug,
      sectionIndex: opts.sectionIndex,
      holder: opts.holder,
      token: opts.token,
    },
  });
}
