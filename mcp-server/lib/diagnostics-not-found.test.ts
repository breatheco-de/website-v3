import { describe, expect, it } from "vitest";
import { TOOL_GATES } from "../../shared/mcp-tool-catalog";
import { assertCatalogToolNames } from "./respond";
import { diagnosticsNotFoundResult } from "./diagnostics-not-found";

const CATALOG = new Set(Object.keys(TOOL_GATES));

function parse(result: NonNullable<ReturnType<typeof diagnosticsNotFoundResult>>) {
  return JSON.parse(result.content[0]!.text) as {
    success: boolean;
    code: string;
    empty_databases: string[];
    warnings: Array<{ code: string; message: string }>;
    next_actions: Array<{ tool: string; args_hint?: Record<string, unknown> }>;
  };
}

describe("diagnosticsNotFoundResult", () => {
  it("returns a final failure that tells the agent not to retry and points to list_entries", () => {
    const result = diagnosticsNotFoundResult(
      {
        code: "diagnostics_slug_not_found",
        message: "No page found for slugs: bootstrap-exercisez",
        slugs: ["bootstrap-exercisez"],
        empty_databases: [],
      },
      { slugs: ["bootstrap-exercisez"], site: "4geeks.com" },
    );
    expect(result).not.toBeNull();
    expect(result!.isError).toBe(true);
    const payload = parse(result!);
    expect(payload.success).toBe(false);
    expect(payload.code).toBe("diagnostics_slug_not_found");
    expect(payload.warnings.map((w) => w.code)).toEqual(["diagnostics_slug_not_found"]);
    expect(payload.warnings[0]!.message).toMatch(/will not help/);
    expect(payload.next_actions[0]).toMatchObject({
      tool: "list_entries",
      args_hint: { search: "bootstrap-exercisez", site: "4geeks.com" },
    });
    expect(assertCatalogToolNames(payload.next_actions.map((a) => a.tool), CATALOG)).toEqual({
      ok: true,
    });
  });

  it("names databases whose cache is empty", () => {
    const result = diagnosticsNotFoundResult(
      {
        code: "diagnostics_file_not_found",
        message: "No page found for file: x.yml",
        file: "x.yml",
        empty_databases: ["exercises"],
      },
      {},
    );
    const payload = parse(result!);
    expect(payload.empty_databases).toEqual(["exercises"]);
    const dbWarning = payload.warnings.find((w) => w.code === "database_pages_not_checked");
    expect(dbWarning?.message).toContain("exercises");
  });

  it("ignores other failures", () => {
    expect(diagnosticsNotFoundResult({ error: "boom" }, {})).toBeNull();
  });
});
