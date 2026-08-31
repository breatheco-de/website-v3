import { describe, expect, it } from "vitest";
import {
  buildClaudeCodeCli,
  buildHttpMcpConfig,
  mcpServerConfigKey,
  resolveCloudConnectorUrl,
} from "./mcpUrlHelpers";

describe("mcpUrlHelpers role paths", () => {
  it("uses distinct config keys per role", () => {
    expect(mcpServerConfigKey()).toBe("4geeks-cms");
    expect(mcpServerConfigKey(null)).toBe("4geeks-cms");
    expect(mcpServerConfigKey("seo_manager")).toBe("4geeks-cms-seo_manager");
  });

  it("embeds role path in HTTP MCP config", () => {
    const json = buildHttpMcpConfig("https://example.com/mcp/role/seo_manager", "seo_manager");
    const parsed = JSON.parse(json) as { mcpServers: Record<string, { url: string }> };
    expect(parsed.mcpServers["4geeks-cms-seo_manager"].url).toBe(
      "https://example.com/mcp/role/seo_manager",
    );
    expect(parsed.mcpServers["4geeks-cms"]).toBeUndefined();
  });

  it("builds Claude Code CLI with role key", () => {
    expect(buildClaudeCodeCli("https://example.com/mcp", null)).toContain("4geeks-cms https://");
    expect(buildClaudeCodeCli("https://example.com/mcp/role/blog", "blog")).toContain(
      "4geeks-cms-blog https://example.com/mcp/role/blog",
    );
  });

  it("resolveCloudConnectorUrl appends role path", () => {
    expect(
      resolveCloudConnectorUrl({
        siteUrl: "https://site.example",
        siteDomain: null,
        localDev: false,
        publicUrl: "https://fallback/mcp",
        roleId: "metrics_viewer",
      }),
    ).toBe("https://site.example/mcp/role/metrics_viewer");
  });
});
