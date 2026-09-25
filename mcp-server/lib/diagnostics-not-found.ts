import { fail, type McpTextResult, type McpWarning, type NextAction } from "./respond.js";

const NOT_FOUND_CODES = new Set(["diagnostics_slug_not_found", "diagnostics_file_not_found"]);

/**
 * Final failure for a diagnostics scope that matches no page (HTTP 404 from
 * /api/validation/diagnostics-jobs). Returns null for any other response.
 */
export function diagnosticsNotFoundResult(
  data: Record<string, unknown>,
  opts: { slugs?: string[]; site?: string },
): McpTextResult | null {
  const code = typeof data.code === "string" ? data.code : "";
  if (!NOT_FOUND_CODES.has(code)) return null;

  const emptyDatabases = Array.isArray(data.empty_databases)
    ? data.empty_databases.filter((d): d is string => typeof d === "string")
    : [];
  const warnings: McpWarning[] = [
    {
      code,
      message:
        "No page matched this scope (static and database-backed pages are both covered). Retrying the same call will not help.",
    },
  ];
  if (emptyDatabases.length > 0) {
    warnings.push({
      code: "database_pages_not_checked",
      message: `These databases have no cached items, so their pages are unknown right now: ${emptyDatabases.join(", ")}. Refresh the database cache before retrying.`,
    });
  }
  const next_actions: NextAction[] = [
    {
      tool: "list_entries",
      reason: "Confirm the exact slug; pass contentType to search entries of that type",
      args_hint: {
        ...(opts.slugs?.[0] ? { search: opts.slugs[0] } : {}),
        ...(opts.site ? { site: opts.site } : {}),
      },
      priority: "recommended",
    },
  ];

  return fail(String(data.message ?? "No page found for this scope"), {
    code,
    ...(opts.slugs?.length ? { slugs: opts.slugs } : {}),
    ...(typeof data.file === "string" ? { file: data.file } : {}),
    empty_databases: emptyDatabases,
    warnings,
    next_actions,
  });
}
