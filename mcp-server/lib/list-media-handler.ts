/**
 * MCP list_media handler — gallery inventory (read-only).
 * Kept separate from media.ts / entry-helpers so tests avoid oauth/GCS import cycles.
 */

import fs from "fs";
import path from "path";
import {
  ok,
  fail,
  actionRequired,
  type McpWarning,
  type NextAction,
  type McpTextResult,
} from "./respond.js";
import { resolveSiteContext } from "./content.js";
import type { CatalogGrant } from "../../shared/mcp-tool-catalog.js";
import type { ImageEntry, ImageRegistry } from "../../shared/schema.js";
import {
  filterAndSortMedia,
  type FilterAndSortMediaOpts,
} from "./list-media.js";

export type ListMediaArgs = FilterAndSortMediaOpts & {
  site?: string;
};

export type ListMediaAuthCheck = (
  mcpToken: string | undefined,
  contentType: string | undefined,
  grants: CatalogGrant[] | undefined,
) => Promise<McpTextResult | null>;

export function registryRelativePath(contentFolder: string): string {
  return path.join(contentFolder, "image-registry.json").replace(/\\/g, "/");
}

/** Full site gallery registry (images + tagDefinitions). null if missing/corrupt. */
export function loadImageRegistry(contentPath: string): {
  images: Record<string, ImageEntry>;
  tagDefinitions?: ImageRegistry["tagDefinitions"];
} | null {
  const registryPath = path.join(contentPath, "image-registry.json");
  if (!fs.existsSync(registryPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(registryPath, "utf8")) as {
      images?: Record<string, ImageEntry>;
      tagDefinitions?: ImageRegistry["tagDefinitions"];
    };
    if (!raw.images || typeof raw.images !== "object") {
      return { images: {}, tagDefinitions: raw.tagDefinitions };
    }
    return {
      images: raw.images,
      tagDefinitions: raw.tagDefinitions,
    };
  } catch {
    return null;
  }
}

/** Local site-fail helper — avoid importing entry-helpers (pulls server/GCS). */
function siteFailResult(
  errorJson: string,
  tool?: string,
  retryArgs?: Record<string, unknown>,
): McpTextResult {
  let parsed: {
    error?: string;
    message?: string;
    available_sites?: string[];
    requested_site?: string;
  };
  try {
    parsed = JSON.parse(errorJson) as typeof parsed;
  } catch {
    return actionRequired(
      { success: false, action_required: "site_required", message: errorJson },
      [{ tool: "list_sites", reason: "List configured site domains", priority: "required" }],
    );
  }
  const sites = parsed.available_sites ?? [];
  const requestedSite =
    typeof parsed.requested_site === "string" && parsed.requested_site.trim()
      ? parsed.requested_site.trim()
      : undefined;
  const next: NextAction[] = [
    {
      tool: "list_sites",
      reason: "List configured domains and content folders",
      priority: "required",
    },
  ];
  if (retryArgs && tool) {
    next.push({
      tool,
      reason: "Retry with a valid site domain",
      args_hint: { ...retryArgs, site: sites[0] ?? requestedSite },
      priority: "recommended",
    });
  }
  return actionRequired(
    {
      success: false,
      action_required: "site_required",
      message: parsed.message ?? "Pass a valid site domain.",
      available_sites: sites,
      ...(requestedSite ? { requested_site: requestedSite } : {}),
      ...(parsed.error ? { code: parsed.error } : {}),
    },
    next,
  );
}

async function defaultContentViewCheck(
  mcpToken: string | undefined,
  contentType: string | undefined,
  grants: CatalogGrant[] | undefined,
): Promise<McpTextResult | null> {
  const { denyUnlessContentView } = await import("./auth.js");
  return denyUnlessContentView(mcpToken, contentType, grants);
}

export async function handleListMedia(
  args: ListMediaArgs,
  opts: {
    mcpToken?: string;
    grants?: CatalogGrant[];
    /** Override content_view gate (tests). Defaults to denyUnlessContentView. */
    checkContentView?: ListMediaAuthCheck;
  } = {},
): Promise<McpTextResult> {
  const checkView = opts.checkContentView ?? defaultContentViewCheck;
  const viewDenied = await checkView(opts.mcpToken, undefined, opts.grants);
  if (viewDenied) return viewDenied;

  const siteResult = resolveSiteContext(args.site);
  if (!siteResult.ok) {
    return siteFailResult(siteResult.error, "list_media", {
      ...(args.q ? { q: args.q } : {}),
      ...(args.tags ? { tags: args.tags } : {}),
      ...(args.doctype ? { doctype: args.doctype } : {}),
      ...(args.origin ? { origin: args.origin } : {}),
      ...(args.sort ? { sort: args.sort } : {}),
      page: args.page,
      page_size: args.page_size,
    });
  }
  const { contentPath, contentFolder } = siteResult;

  const registry = loadImageRegistry(contentPath);
  if (!registry) {
    return fail(`image-registry.json not found or unreadable under ${contentFolder}`, {
      code: "registry_missing",
      path: registryRelativePath(contentFolder),
    });
  }

  const result = filterAndSortMedia(
    registry.images,
    {
      q: args.q,
      tags: args.tags,
      doctype: args.doctype,
      origin: args.origin,
      include_derived: args.include_derived,
      sort: args.sort,
      page: args.page,
      page_size: args.page_size,
    },
    registry.tagDefinitions,
  );

  const warnings: McpWarning[] = [
    {
      code: "inventory_only",
      message:
        "list_media is inventory only — it does not write YAML or return full registry entries (srcset / AI meta). Use get_or_set_media_to_gallery with media_id for detail.",
    },
  ];
  if ((args.sort ?? "newest") === "usage") {
    warnings.push({
      code: "usage_count_may_be_stale",
      message:
        "Sort by usage uses stored usage_count from the registry, which may be stale versus live YAML references.",
    });
  }
  if (result.unknown_tags.length > 0) {
    warnings.push({
      code: "unknown_tags",
      message: `Requested tag(s) not in gallery vocabulary: ${result.unknown_tags.join(", ")}. See available_tags.`,
    });
  }

  const next_actions: NextAction[] =
    result.total === 1 && result.items.length === 1
      ? [
          {
            tool: "get_or_set_media_to_gallery",
            reason: "Fetch the full gallery entry for this media_id",
            args_hint: { media_id: result.items[0].media_id },
            priority: "recommended",
          },
        ]
      : [];

  return ok(
    {
      items: result.items,
      total: result.total,
      page: result.page,
      page_size: result.page_size,
      has_more: result.has_more,
      available_tags: result.available_tags,
      message:
        result.total === 0
          ? "No media matched the given filters."
          : `Found ${result.total} media item(s); showing page ${result.page}.`,
    },
    { warnings, next_actions },
  );
}
