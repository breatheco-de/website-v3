/**
 * MCP tools for CMS redirects: test_redirect (read) and update_redirect (add|delete|move).
 * Caps: test_redirect → read_redirects; update_redirect → edit_redirects.
 */

import fs from "fs";
import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, fail, actionRequired, type NextAction, type McpWarning, type McpSideEffect } from "../lib/respond.js";
import { checkCap, denyResponse } from "../lib/auth.js";
import { loadVersioning, resolveSiteContext } from "../lib/content.js";
import { getTokenUsername } from "../lib/oauth.js";
import { SITE_PARAM_DESC, siteFailResult } from "../lib/entry-helpers.js";
import {
  collectMissingConfirms,
  failBeforeFromOnPageYaml,
  isCustomRedirectSource,
  isExternalDest,
  isRegexFrom,
  stackedConfirmPayload,
  validateRedirectUpdateInput,
} from "../lib/redirect-update.js";

const MAIN_SERVER_PORT = process.env.PORT || "5000";
const INTERNAL_SECRET = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY || "";

function internalHeaders(mcpToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (INTERNAL_SECRET) {
    headers.Authorization = `Bearer ${INTERNAL_SECRET}`;
    const username = mcpToken ? getTokenUsername(mcpToken) : undefined;
    if (username) headers["x-mcp-author"] = username;
  } else if (mcpToken) {
    const username = getTokenUsername(mcpToken);
    if (username) headers["x-mcp-author"] = username;
  }
  return headers;
}

function siteQuery(domain?: string): string {
  return domain ? `?__site=${encodeURIComponent(domain)}` : "";
}

function siteQueryJoin(domain: string | undefined, params: Record<string, string>): string {
  const q = new URLSearchParams(params);
  if (domain) q.set("__site", domain);
  const s = q.toString();
  return s ? `?${s}` : "";
}

function authorName(mcpToken?: string): string {
  return (mcpToken ? getTokenUsername(mcpToken) : undefined) || "mcp-update_redirect";
}

type InspectPayload = {
  match?: boolean;
  from?: string;
  resolvedTo?: string;
  status?: number;
  priority?: string;
  source?: string;
  matchType?: string;
  captureGroups?: string[];
  pageExists?: boolean;
  destinationExists?: boolean;
  winner?: Record<string, unknown>;
  conflicts?: Array<{ kind: string; from: string; source?: string; message: string }>;
  fixes?: Array<{
    id: string;
    kind: string;
    file?: string;
    from: string;
    effect: string;
    requires_confirmation: boolean;
    args_hint?: Record<string, unknown>;
  }>;
  live_content?: boolean;
  error?: string;
};

async function fetchInspect(
  url: string,
  locale: string | undefined,
  domain?: string,
  mcpToken?: string,
): Promise<{ ok: true; data: InspectPayload } | { ok: false; status: number; error: string }> {
  const qs = siteQueryJoin(domain, {
    url,
    ...(locale ? { locale } : {}),
  });
  const res = await fetch(`http://localhost:${MAIN_SERVER_PORT}/api/debug/redirects/test${qs}`, {
    headers: internalHeaders(mcpToken),
  });
  const data = (await res.json()) as InspectPayload;
  if (!res.ok) {
    return { ok: false, status: res.status, error: (data.error as string) || `Server error: ${res.status}` };
  }
  return { ok: true, data };
}

async function fetchLocaleUrls(
  destUrl: string,
  domain?: string,
  mcpToken?: string,
): Promise<{ ok: true; contentType: string; slug: string } | { ok: false }> {
  const qs = siteQueryJoin(domain, { url: destUrl });
  const res = await fetch(`http://localhost:${MAIN_SERVER_PORT}/api/debug/redirects/locale-urls${qs}`, {
    headers: internalHeaders(mcpToken),
  });
  if (!res.ok) return { ok: false };
  const data = (await res.json()) as { contentType?: string; slug?: string };
  if (!data.contentType || !data.slug) return { ok: false };
  return { ok: true, contentType: data.contentType, slug: data.slug };
}

function inferWriteCustom(from: string, to: string, destIsContent: boolean): boolean {
  if (isRegexFrom(from)) return true;
  if (isExternalDest(to)) return true;
  return !destIsContent;
}

function sourceHasVersioning(source: string, contentPath: string): boolean {
  const rel = source.replace(/^\/+/, "");
  const abs = path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
  const beside = path.join(path.dirname(abs), "versioning.yml");
  if (fs.existsSync(beside)) return true;
  const underContent = path.join(contentPath, rel.replace(/^[^/]+\//, ""));
  return fs.existsSync(path.join(path.dirname(underContent), "versioning.yml"));
}

function destHasVersioning(contentPath: string, contentType: string, slug: string): boolean {
  return !!loadVersioning(contentType, slug, contentPath);
}

function otherStoreWarning(wroteCustom: boolean): McpWarning {
  return {
    code: "other_store_not_written",
    message: wroteCustom
      ? "Did not write page meta.redirects. The other store is {directory}/{slug}/{locale}.yml meta.redirects (dest locale only — not _common.yml)."
      : "Did not write custom-redirects.yml. The other store is site_<name>/custom-redirects.yml.",
  };
}

function mutateWarnings(opts: { wroteCustom: boolean; regex?: boolean }): McpWarning[] {
  const warnings: McpWarning[] = [
    otherStoreWarning(opts.wroteCustom),
    {
      code: "slug_diagnostics_skip_redirects",
      message:
        "Slug-scoped run_entry_diagnostics does not re-run the redirects validator. This write queued the redirects validation job itself. Verify with test_redirect on the same URL.",
    },
    {
      code: "cap_edit_redirects",
      message:
        "update_redirect requires edit_redirects; test_redirect requires read_redirects. Metrics Viewer (metrics_view only) cannot use these tools.",
    },
  ];
  if (opts.regex) {
    warnings.push({
      code: "regex_order",
      message:
        "Regex is allowed. First-match still applies: an earlier broader pattern can shadow this rule. Use action: move with before_from (custom-redirects.yml only) to raise it.",
    });
  }
  return warnings;
}

function mutateSideEffects(file: string): McpSideEffect[] {
  return [
    { kind: "file_written", summary: `Wrote ${file}` },
    { kind: "redirect_cache_flush", summary: "Redirect cache flushed (clearRedirectCache)" },
    { kind: "redirects_validation_queued", summary: "Redirects validation job queued (scheduleRedirectsValidation)" },
    { kind: "sync_marked", summary: "markFileAsModified so Cloud Sync can commit this path" },
  ];
}

function testNextActions(data: InspectPayload): NextAction[] {
  const conflicts = data.conflicts ?? [];
  if (conflicts.some((c) => c.kind === "overwrites_content")) return [];
  const deleteFixes = (data.fixes ?? []).filter(
    (f) => f.args_hint && f.args_hint.tool === "update_redirect" && f.args_hint.action === "delete",
  );
  if (deleteFixes.length === 1 && deleteFixes[0].args_hint) {
    return [
      {
        tool: "update_redirect",
        priority: "optional",
        reason: deleteFixes[0].effect,
        args_hint: deleteFixes[0].args_hint,
      },
    ];
  }
  return [];
}

export function registerRedirectTools(mcp: McpServer, mcpToken?: string): void {
  mcp.tool(
    "test_redirect",
    "Inspect one public URL against CMS redirects (read_redirects). Two stores: dest-locale {directory}/{slug}/{locale}.yml meta.redirects and site_<name>/custom-redirects.yml. First-match winner only; extra claims in conflicts[] (duplicate_from | regex_shadowed | overwrites_content). Inspect only — use update_redirect to change a rule. Does not dump the catalog. live_content = contentIndex.isKnownUrl only; locale-home aliases (/ , /en, /es, /us) are never live (301 to canonical homes).",
    {
      url: z.string().describe("Public path or full URL to test, e.g. /us or /en/blog/foo"),
      locale: z.string().optional().describe("Request locale for multi-locale redirect targets (default en)"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ url, locale, site }) => {
      if (mcpToken && !(await checkCap(mcpToken, "read_redirects"))) {
        return denyResponse("read_redirects");
      }
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error, "test_redirect", { url, locale });
      const domain = siteResult.domain;

      try {
        const inspected = await fetchInspect(url, locale, domain, mcpToken);
        if (!inspected.ok) return fail(inspected.error);

        const data = inspected.data;
        const conflicts = data.conflicts ?? [];
        const warnings: McpWarning[] = [
          {
            code: "inspect_only",
            message: "Inspect only — use update_redirect to change a rule. Cap: read_redirects.",
          },
        ];
        if (conflicts.length) {
          warnings.push({
            code: "first_match",
            message:
              "Runtime has one winner (first-match: exact before → regex before → fallbacks → canonical soft). Other matching rules are conflicts, never a second winner.",
          });
        }

        return ok(
          {
            message: data.match
              ? `Winner: ${data.from} → ${data.resolvedTo}`
              : data.live_content
                ? "No redirect; this path is a live content URL."
                : "No redirect and not a live content URL.",
            winner: data.winner ?? {
              match: data.match,
              from: data.from,
              resolvedTo: data.resolvedTo,
              status: data.status,
              priority: data.priority,
              source: data.source,
              matchType: data.matchType,
              captureGroups: data.captureGroups,
              pageExists: data.pageExists,
              destinationExists: data.destinationExists,
            },
            conflicts,
            fixes: data.fixes ?? [],
            live_content: data.live_content === true,
          },
          {
            warnings,
            next_actions: testNextActions(data),
          },
        );
      } catch (e) {
        return fail(`test_redirect failed: ${(e as Error).message}`);
      }
    },
  );

  mcp.tool(
    "update_redirect",
    "Call test_redirect first. One rule per call. Mutate CMS redirects (edit_redirects — Webmaster / custom roles with this cap; not Metrics Viewer). action add | delete | move. Two stores: dest-locale meta.redirects (never _common.yml / all_languages) or site_<name>/custom-redirects.yml. before_from and action: move fail on page YAML (custom file only). Live routing only — variant is refused. Stacked confirms: one action_required listing every missing flag (confirm_overwrite_content and/or confirm_live_edit); overwrite confirm does not imply live confirm. Write flushes redirect cache, queues redirects validation (slug-scoped run_entry_diagnostics does not). Regex allowed; omit before_from on add = append.",
    {
      action: z.enum(["add", "delete", "move"]).describe("add: create one rule; delete: remove by from+source; move: splice custom-redirects.yml above before_from"),
      from: z.string().optional().describe("Source path or regex (required for every action)"),
      to: z.string().optional().describe("Destination path or URL (required for add)"),
      source: z.string().optional().describe("Relative YAML path of the rule (required for delete; custom-redirects.yml for move if passed)"),
      before_from: z.string().optional().describe("Insert/move immediately above this custom from. Custom-redirects.yml only. Omit on add = append at end."),
      confirm_overwrite_content: z.boolean().optional().describe("Required to hide or unhide a live content URL (contentIndex.isKnownUrl). Locale-home aliases (/ , /en, /es, /us) are not live."),
      confirm_live_edit: z.boolean().optional().describe("Required when writing a dest-locale file that has versioning.yml. Does not replace confirm_overwrite_content."),
      variant: z.string().optional().describe("Refused — redirects are live routing only"),
      locale: z.string().optional().describe("Optional locale for inspect / dest resolution (add)"),
      status: z.number().optional().describe("301 or 302 (add; default 301)"),
      priority: z.enum(["before", "fallback"]).optional().describe("Custom-file priority (add; default before)"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async (args) => {
      if (mcpToken && !(await checkCap(mcpToken, "edit_redirects"))) {
        return denyResponse("edit_redirects");
      }
      const siteResult = resolveSiteContext(args.site);
      if (!siteResult.ok) {
        return siteFailResult(siteResult.error, "update_redirect", { action: args.action });
      }
      const domain = siteResult.domain;
      const { contentPath, contentFolder } = siteResult;

      const validated = validateRedirectUpdateInput(args);
      if (!validated.ok) return fail(validated.message, validated.details);

      const { action } = validated;
      const from = args.from!.trim();
      const siteHint = args.site ? { site: args.site } : {};

      try {
        if (action === "add") {
          const to = args.to!.trim();
          const destMeta = await fetchLocaleUrls(to, domain, mcpToken);
          const writingCustom = inferWriteCustom(from, to, destMeta.ok);
          const beforeFail = failBeforeFromOnPageYaml(args.before_from, writingCustom);
          if (beforeFail) return fail(beforeFail.message, beforeFail.details);

          const inspected = await fetchInspect(from, args.locale, domain, mcpToken);
          const liveContent = inspected.ok && inspected.data.live_content === true;
          const needsLiveEdit =
            !writingCustom && destMeta.ok && destHasVersioning(contentPath, destMeta.contentType, destMeta.slug);
          const missing = collectMissingConfirms({
            needsOverwrite: liveContent,
            needsLiveEdit,
            confirm_overwrite_content: args.confirm_overwrite_content,
            confirm_live_edit: args.confirm_live_edit,
          });
          if (missing.length) {
            const payload = stackedConfirmPayload(missing);
            return actionRequired(
              {
                ...payload,
                from,
                to,
                writing_custom: writingCustom,
              },
              [
                {
                  tool: "update_redirect",
                  priority: "required",
                  reason: "Re-call with every listed confirm flag.",
                  args_hint: {
                    action: "add",
                    from,
                    to,
                    ...(args.before_from ? { before_from: args.before_from } : {}),
                    ...Object.fromEntries(missing.map((f) => [f, true])),
                    ...siteHint,
                  },
                },
              ],
            );
          }

          const body: Record<string, unknown> = {
            from,
            to,
            isCustomDestination: writingCustom,
            author: authorName(mcpToken),
          };
          if (args.status) body.status = args.status;
          if (args.priority) body.priority = args.priority;
          if (args.before_from) body.before_from = args.before_from;
          // Never allLanguages / _common.yml in v1.

          const res = await fetch(
            `http://localhost:${MAIN_SERVER_PORT}/api/debug/redirects${siteQuery(domain)}`,
            {
              method: "POST",
              headers: internalHeaders(mcpToken),
              body: JSON.stringify(body),
            },
          );
          const data = (await res.json()) as { error?: string; code?: string; file?: string; message?: string };
          if (!res.ok) {
            return fail(data.error || `Server error: ${res.status}`, { code: data.code, status: res.status });
          }
          const file = data.file || `${contentFolder}/custom-redirects.yml`;
          return ok(
            {
              message: data.message || `Redirect added: ${from} -> ${to}`,
              action: "add",
              from,
              to,
              file,
            },
            {
              warnings: mutateWarnings({ wroteCustom: writingCustom || isCustomRedirectSource(file), regex: isRegexFrom(from) }),
              side_effects: mutateSideEffects(file),
              next_actions: [
                {
                  tool: "test_redirect",
                  priority: "recommended",
                  reason: "Verify the winner after this write. Do not use slug-scoped run_entry_diagnostics for redirects.",
                  args_hint: { url: from, ...(args.locale ? { locale: args.locale } : {}), ...siteHint },
                },
              ],
            },
          );
        }

        if (action === "delete") {
          const source = args.source!.trim();
          if (args.before_from) {
            return fail("action: delete requires from and source. Do not pass before_from.", {
              required: ["from", "source"],
              extras_rejected: ["before_from"],
            });
          }

          const inspected = await fetchInspect(from, args.locale, domain, mcpToken);
          const liveContent = inspected.ok && inspected.data.live_content === true;
          const needsLiveEdit = !isCustomRedirectSource(source) && sourceHasVersioning(source, contentPath);
          const missing = collectMissingConfirms({
            needsOverwrite: liveContent,
            needsLiveEdit,
            confirm_overwrite_content: args.confirm_overwrite_content,
            confirm_live_edit: args.confirm_live_edit,
          });
          if (missing.length) {
            const payload = stackedConfirmPayload(missing);
            return actionRequired(
              { ...payload, from, source },
              [
                {
                  tool: "update_redirect",
                  priority: "required",
                  reason: "Re-call with every listed confirm flag.",
                  args_hint: {
                    action: "delete",
                    from,
                    source,
                    ...Object.fromEntries(missing.map((f) => [f, true])),
                    ...siteHint,
                  },
                },
              ],
            );
          }

          const res = await fetch(
            `http://localhost:${MAIN_SERVER_PORT}/api/debug/redirects${siteQuery(domain)}`,
            {
              method: "DELETE",
              headers: internalHeaders(mcpToken),
              body: JSON.stringify({ from, source, author: authorName(mcpToken) }),
            },
          );
          const data = (await res.json()) as { error?: string; message?: string };
          if (!res.ok) return fail(data.error || `Server error: ${res.status}`, { status: res.status });
          const wroteCustom = isCustomRedirectSource(source);
          return ok(
            {
              message: data.message || `Redirect deleted: ${from}`,
              action: "delete",
              from,
              source,
              file: source,
            },
            {
              warnings: mutateWarnings({ wroteCustom }),
              side_effects: mutateSideEffects(source),
              next_actions: [
                {
                  tool: "test_redirect",
                  priority: "recommended",
                  reason: "Verify the path after delete. Do not use slug-scoped run_entry_diagnostics for redirects.",
                  args_hint: { url: from, ...siteHint },
                },
              ],
            },
          );
        }

        // move
        if (args.source && !isCustomRedirectSource(args.source)) {
          return fail(
            "action: move fails on page meta.redirects. Only custom-redirects.yml rules can be reordered with before_from.",
            { code: "move_page_yaml", source: args.source },
          );
        }
        const beforeFrom = args.before_from!.trim();
        const res = await fetch(
          `http://localhost:${MAIN_SERVER_PORT}/api/debug/redirects/move${siteQuery(domain)}`,
          {
            method: "PATCH",
            headers: internalHeaders(mcpToken),
            body: JSON.stringify({
              from,
              before_from: beforeFrom,
              author: authorName(mcpToken),
            }),
          },
        );
        const data = (await res.json()) as { error?: string; code?: string; file?: string; message?: string };
        if (!res.ok) {
          const notCustom =
            res.status === 404
              ? " action: move only applies to custom-redirects.yml (not page meta.redirects)."
              : "";
          return fail((data.error || `Server error: ${res.status}`) + notCustom, {
            code: data.code,
            status: res.status,
          });
        }
        const file = data.file || `${contentFolder}/custom-redirects.yml`;
        return ok(
          {
            message: data.message || `Moved ${from} above ${beforeFrom}`,
            action: "move",
            from,
            before_from: beforeFrom,
            file,
          },
          {
            warnings: mutateWarnings({ wroteCustom: true, regex: isRegexFrom(from) }),
            side_effects: mutateSideEffects(file),
            next_actions: [
              {
                tool: "test_redirect",
                priority: "recommended",
                reason: "Verify first-match after reorder. Do not use slug-scoped run_entry_diagnostics for redirects.",
                args_hint: { url: from, ...siteHint },
              },
            ],
          },
        );
      } catch (e) {
        return fail(`update_redirect failed: ${(e as Error).message}`);
      }
    },
  );
}
