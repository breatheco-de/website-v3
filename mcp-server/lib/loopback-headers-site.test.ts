import { describe, expect, it, vi } from "vitest";

vi.mock("./auth.js", () => ({
  getActiveRoleId: () => undefined,
  getActiveMcpToken: () => undefined,
}));
vi.mock("./oauth.js", () => ({
  getTokenUsername: () => "alice",
  getTokenClientName: () => "Cursor",
}));

const { buildLoopbackHeaders } = await import("./loopback.js");

describe("buildLoopbackHeaders x-mcp-site", () => {
  it("sets x-mcp-site when site is provided", () => {
    const headers = buildLoopbackHeaders("tok", { site: "fl.4geeksacademy.com" });
    expect(headers["x-mcp-site"]).toBe("fl.4geeksacademy.com");
  });

  it("omits x-mcp-site when site is absent or blank", () => {
    expect(buildLoopbackHeaders("tok")["x-mcp-site"]).toBeUndefined();
    expect(buildLoopbackHeaders("tok", { site: "  " })["x-mcp-site"]).toBeUndefined();
  });
});
