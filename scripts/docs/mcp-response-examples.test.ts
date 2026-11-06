import fs from "fs";
import { describe, expect, it } from "vitest";
import { TOOL_GATES } from "../../shared/mcp-tool-catalog.js";
import { DOC_PATH, buildMcpResponseExamples, renderDoc } from "./mcp-response-examples.js";

describe("docs/mcp-response-examples.md", () => {
  it("matches what the MCP helpers produce today (run npm run docs:mcp-examples)", () => {
    const doc = fs.readFileSync(DOC_PATH, "utf-8");
    expect(renderDoc(doc)).toBe(doc);
  });

  it("only names catalog tools", () => {
    const catalog = new Set(Object.keys(TOOL_GATES));
    const json = JSON.stringify(buildMcpResponseExamples());
    const tools = [...json.matchAll(/"tool":"([a-z_]+)"/g)].map((m) => m[1]);
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.filter((t) => !catalog.has(t))).toEqual([]);
  });
});
