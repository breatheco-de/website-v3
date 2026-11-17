/**
 * MCP tools for site llms.txt prompt + regenerate job.
 * Cap: seo_settings (same family as ensure_content_type_schema_org / SEO settings UI).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, fail, type McpWarning, type NextAction } from "../lib/respond.js";
import { checkCap, denyResponse } from "../lib/auth.js";
import { resolveSiteContext } from "../lib/content.js";
import { buildLoopbackHeaders } from "../lib/loopback.js";
import { requiredAgentSessionIdField } from "../lib/page-tool-helpers.js";
import { MULTI_SITE_TOOL_BLURB, SITE_PARAM_DESC, siteFailResult } from "../lib/entry-helpers.js";
import type { CatalogGrant } from "../lib/tool-catalog.js";

const MAIN_SERVER_PORT = process.env.PORT || "5000";

function internalHeaders(
  mcpToken?: string,
  opts?: { agentSessionId?: string; site?: string },
): Record<string, string> {
  return buildLoopbackHeaders(mcpToken, opts);
}

const STANDING_WARNINGS: McpWarning[] = [
  {
    code: "does_not_toggle_serve",
    message:
      "These tools do not change Serve / llms_txt.enabled. Staff toggle serving in Settings → SEO/GEO → llms.txt.",
  },
];

export function registerLlmsTxtTools(
  mcp: McpServer,
  mcpToken?: string,
  _grants?: CatalogGrant[],
): void {
  mcp.tool(
    "get_llms_txt_prompt",
    "Read the site llms.txt regenerate prompt (llms.regenerate-prompt.md) and job input slots. " +
      "Also returns whether a template exists and whether public /llms.txt is serving. " +
      "Does not toggle Serve. Requires seo_settings. " +
      MULTI_SITE_TOOL_BLURB,
    {
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return siteFailResult(siteResult.error, "get_llms_txt_prompt");
      const { domain, contentFolder } = siteResult;
      if (mcpToken && !(await checkCap(mcpToken, "seo_settings"))) {
        return denyResponse("seo_settings");
      }
      try {
        const res = await fetch(`http://127.0.0.1:${MAIN_SERVER_PORT}/api/settings/llms-txt`, {
          headers: internalHeaders(mcpToken, { site: domain }),
        });
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          return fail(String(data.error ?? `Failed to load llms.txt settings (${res.status})`), data);
        }
        const next_actions: NextAction[] = data.has_prompt
          ? [
              {
                tool: "update_llms_txt_prompt",
                args_hint: { prompt: "(full prompt body)", site: domain },
                priority: "optional",
                reason: "Replace the regenerate prompt, then optionally regenerate_llms_txt.",
              },
            ]
          : [
              {
                tool: "update_llms_txt_prompt",
                args_hint: { prompt: "(full prompt body with {{slots}})", site: domain },
                priority: "required",
                reason: "Save a prompt before regenerate_llms_txt will succeed.",
              },
            ];
        return ok(
          {
            message: data.has_prompt
              ? "Loaded llms.txt regenerate prompt."
              : "No regenerate prompt saved yet — use update_llms_txt_prompt before regenerate_llms_txt.",
            prompt: data.prompt ?? null,
            has_prompt: !!data.has_prompt,
            prompt_slots: data.prompt_slots ?? [],
            has_template: !!data.has_template,
            serving: !!data.serving,
            enabled: !!data.enabled,
            public_url: data.public_url ?? "/llms.txt",
            prompt_path: `${contentFolder}/llms.regenerate-prompt.md`,
            template_path: `${contentFolder}/llms.template.md`,
          },
          {
            warnings: STANDING_WARNINGS,
            next_actions,
          },
        );
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  mcp.tool(
    "update_llms_txt_prompt",
    "Create or overwrite the site llms.txt regenerate prompt file (llms.regenerate-prompt.md). " +
      "Marks the file for Sync like other content. Does not regenerate the template and does not toggle Serve. " +
      "Unknown {{slots}} are left as literal text (only the five job inputs are filled on regenerate). " +
      "Requires seo_settings. " +
      MULTI_SITE_TOOL_BLURB,
    {
      prompt: z.string().describe("Full prompt body. Use {{company_profile}}, {{site_facts}}, {{products}}, {{pages}}, {{previous_llms_txt}} for job inputs."),
      ...requiredAgentSessionIdField,
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ prompt, agent_session_id, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) {
        return siteFailResult(siteResult.error, "update_llms_txt_prompt", { agent_session_id });
      }
      const { domain, contentFolder } = siteResult;
      if (mcpToken && !(await checkCap(mcpToken, "seo_settings"))) {
        return denyResponse("seo_settings");
      }
      if (!prompt.trim()) {
        return fail("Prompt cannot be empty");
      }
      try {
        const res = await fetch(`http://127.0.0.1:${MAIN_SERVER_PORT}/api/settings/llms-txt/prompt`, {
          method: "PUT",
          headers: internalHeaders(mcpToken, { agentSessionId: agent_session_id, site: domain }),
          body: JSON.stringify({ prompt }),
        });
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          return fail(String(data.error ?? `Failed to save prompt (${res.status})`), data);
        }
        const promptPath = `${contentFolder}/llms.regenerate-prompt.md`;
        return ok(
          {
            message: "Saved llms.txt regenerate prompt (pending Sync).",
            prompt: data.prompt ?? prompt,
            has_prompt: true,
            prompt_path: promptPath,
          },
          {
            warnings: [
              ...STANDING_WARNINGS,
              {
                code: "does_not_regenerate",
                message:
                  "Template was not rebuilt. Call regenerate_llms_txt to enqueue the Sidequest job.",
              },
            ],
            side_effects: [
              {
                kind: "content_file_written",
                summary: `Wrote ${promptPath} and marked it for Sync.`,
                paths: [promptPath],
              },
            ],
            next_actions: [
              {
                tool: "regenerate_llms_txt",
                args_hint: { site: domain },
                priority: "recommended",
                reason: "Enqueue rebuild of llms.template.md from this prompt.",
              },
            ],
          },
        );
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  mcp.tool(
    "regenerate_llms_txt",
    "Enqueue the Sidequest job that rebuilds llms.template.md from the saved regenerate prompt and site inputs. " +
      "Async — does not wait for the LLM. Fails if no prompt file is saved yet. " +
      "Does not turn Serve on/off. Requires seo_settings. " +
      MULTI_SITE_TOOL_BLURB,
    {
      ...requiredAgentSessionIdField,
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({ agent_session_id, site }) => {
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) {
        return siteFailResult(siteResult.error, "regenerate_llms_txt", { agent_session_id });
      }
      const { domain, contentFolder } = siteResult;
      if (mcpToken && !(await checkCap(mcpToken, "seo_settings"))) {
        return denyResponse("seo_settings");
      }
      try {
        const res = await fetch(`http://127.0.0.1:${MAIN_SERVER_PORT}/api/settings/llms-txt/regenerate`, {
          method: "POST",
          headers: internalHeaders(mcpToken, { agentSessionId: agent_session_id, site: domain }),
          body: JSON.stringify({}),
        });
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          const next_actions: NextAction[] =
            data.has_prompt === false
              ? [
                  {
                    tool: "update_llms_txt_prompt",
                    args_hint: { prompt: "(full prompt body)", site: domain },
                    priority: "required",
                    reason: "Save a regenerate prompt first.",
                  },
                  {
                    tool: "get_llms_txt_prompt",
                    args_hint: { site: domain },
                    priority: "optional",
                    reason: "Inspect current prompt / slots.",
                  },
                ]
              : [];
          return fail(String(data.error ?? `Regenerate enqueue failed (${res.status})`), {
            ...data,
            next_actions,
          });
        }
        return ok(
          {
            message: data.deduped
              ? "Rebuild already queued."
              : data.busy
                ? "Queue busy — try again shortly."
                : "llms.txt regenerate job queued.",
            queued: data.queued === true,
            deduped: data.deduped === true,
            busy: data.busy === true,
            enabled: data.enabled,
            template_path: `${contentFolder}/llms.template.md`,
          },
          {
            warnings: [
              ...STANDING_WARNINGS,
              {
                code: "async_job",
                message:
                  "Sidequest writes llms.template.md when the job finishes; then it is Sync-pending (or auto-commit if enabled). Poll staff UI or re-check get_llms_txt_prompt.has_template / serving later.",
              },
            ],
            side_effects: [
              {
                kind: "job_enqueued",
                summary: "Enqueued llms_txt_regenerate (does not wait for completion).",
              },
            ],
            next_actions: [],
          },
        );
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
