/**
 * Light guard: mutating page tools must route success/gate/error through respond helpers.
 * Crude source scan — fails if a mutating tool callback still returns bare `{ content:`.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { ok, fail, actionRequired, diagnosticsAfterGoLiveNextAction } from "../mcp-server/lib/respond";

const MUTATING_TOOLS = [
  "update_fields",
  "update_meta_fields",
  "create_variant",
  "delete_variant",
  "promote_variant",
  "convert_to_draft",
  "publish_draft",
  "create_entry",
  "add_section",
  "remove_section",
  "reorder_sections",
  "replace_entry_sections",
  "translate_entry",
  "set_entry_attachment",
  "regenerate_entry_previews",
  "ensure_content_type_schema_org",
  "update_content_type",
  "update_redirect",
] as const;

const TOOL_SOURCE_FILE: Record<string, string> = {
  update_redirect: "mcp-server/tools/redirects.ts",
};

function mutatingToolSource(toolName: string): string {
  const rel = TOOL_SOURCE_FILE[toolName] ?? "mcp-server/tools/pages.ts";
  return fs.readFileSync(path.join(process.cwd(), rel), "utf-8");
}

function extractToolHandlerSource(src: string, toolName: string): string | null {
  const marker = `mcp.tool(\n    "${toolName}"`;
  const alt = `mcp.tool(\n    '${toolName}'`;
  let start = src.indexOf(marker);
  if (start < 0) start = src.indexOf(alt);
  if (start < 0) {
    // compact form
    const m = src.indexOf(`"${toolName}"`);
    if (m < 0) return null;
    // walk back to nearest mcp.tool(
    const toolCall = src.lastIndexOf("mcp.tool(", m);
    if (toolCall < 0) return null;
    start = toolCall;
  }
  const nextTool = src.indexOf("\n  mcp.tool(", start + 10);
  const end = nextTool > 0 ? nextTool : src.length;
  return src.slice(start, end);
}

describe("respond helpers", () => {
  it("ok always includes warnings and next_actions arrays", () => {
    const result = ok({ message: "done" });
    const payload = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(payload.success).toBe(true);
    expect(Array.isArray(payload.warnings)).toBe(true);
    expect(Array.isArray(payload.next_actions)).toBe(true);
  });

  it("fail sets isError and success false", () => {
    const result = fail("nope", { code: "x" });
    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(payload.success).toBe(false);
    expect(payload.message).toBe("nope");
  });

  it("actionRequired keeps action_required and next_actions", () => {
    const result = actionRequired(
      { action_required: "confirm_live_edit", message: "ask" },
      [{ tool: "create_variant", reason: "draft first", priority: "recommended" }],
    );
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(payload.action_required).toBe("confirm_live_edit");
    expect(Array.isArray(payload.next_actions)).toBe(true);
    expect((payload.next_actions as unknown[]).length).toBe(1);
  });

  it("diagnosticsAfterGoLiveNextAction shapes required hard refresh", () => {
    const withSite = diagnosticsAfterGoLiveNextAction("my-slug", "4geeks.com");
    expect(withSite).toEqual({
      tool: "run_entry_diagnostics",
      priority: "required",
      reason:
        "Hard-refresh diagnostics for the live page (async — then poll get_diagnostics_job)",
      args_hint: { slugs: ["my-slug"], freshness: "hard", confirm: true, site: "4geeks.com" },
    });
    const noSite = diagnosticsAfterGoLiveNextAction("other");
    expect(noSite.args_hint).toEqual({ slugs: ["other"], freshness: "hard", confirm: true });
  });
});

describe("mcp-server mutating tools use respond helpers", () => {
  const pagesPath = path.join(process.cwd(), "mcp-server/tools/pages.ts");
  const src = fs.readFileSync(pagesPath, "utf-8");
  const redirectsSrc = fs.readFileSync(path.join(process.cwd(), "mcp-server/tools/redirects.ts"), "utf-8");

  it("pages.ts imports ok/fail helpers", () => {
    expect(src.includes("from \"../lib/page-tool-helpers.js\"") || src.includes("from \"../lib/respond.js\"")).toBe(
      true,
    );
    expect(src.includes("ok(")).toBe(true);
    expect(src.includes("fail(")).toBe(true);
  });

  it("redirects.ts imports ok/fail helpers", () => {
    expect(redirectsSrc.includes("from \"../lib/respond.js\"")).toBe(true);
    expect(redirectsSrc.includes("ok(")).toBe(true);
    expect(redirectsSrc.includes("fail(")).toBe(true);
    expect(redirectsSrc.includes("actionRequired(")).toBe(true);
  });

  it("publish_draft and promote_variant use diagnosticsAfterGoLiveNextAction", () => {
    expect(src.includes("diagnosticsAfterGoLiveNextAction")).toBe(true);
    const publishChunk = extractToolHandlerSource(src, "publish_draft");
    const promoteChunk = extractToolHandlerSource(src, "promote_variant");
    expect(publishChunk).toBeTruthy();
    expect(promoteChunk).toBeTruthy();
    expect(publishChunk!.includes("diagnosticsAfterGoLiveNextAction")).toBe(true);
    expect(promoteChunk!.includes("diagnosticsAfterGoLiveNextAction")).toBe(true);
  });

  for (const tool of MUTATING_TOOLS) {
    it(`${tool} handler does not return bare { content: success payloads`, () => {
      const chunk = extractToolHandlerSource(mutatingToolSource(tool), tool);
      expect(chunk, `tool ${tool} not found`).toBeTruthy();
      // Allow denyResponse / conflictError which may still use content blocks,
      // but forbid prose-style success: return { content: [{ type: "text", text: `Updated
      // or return { content: [{ type: "text", text: `Section
      const bareSuccess = /return\s*\{\s*content:\s*\[\s*\{\s*type:\s*"text",\s*text:\s*[`'](?!\{)/g;
      const matches = [...(chunk as string).matchAll(bareSuccess)];
      // Filter known allowed patterns inside helpers called from the chunk (none expected)
      expect(matches.map((m) => m[0].slice(0, 80))).toEqual([]);
      // Must call ok( or actionRequired( for success/gate paths
      expect(chunk!.includes("ok(") || chunk!.includes("actionRequired(") || chunk!.includes("confirmLiveEditGate(")).toBe(
        true,
      );
    });
  }
});
