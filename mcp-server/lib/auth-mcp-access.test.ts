import { afterEach, describe, expect, it, vi } from "vitest";

describe("fetchMcpAccess", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("treats missing flags as both enabled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ capabilities: [] }),
      }),
    );
    const { fetchMcpAccess } = await import("./auth.js");
    await expect(fetchMcpAccess("alice")).resolves.toEqual({
      mcpReadEnabled: true,
      mcpWriteEnabled: true,
    });
  });

  it("honors explicit read/write flags", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          mcp_read_enabled: true,
          mcp_write_enabled: false,
        }),
      }),
    );
    const { fetchMcpAccess } = await import("./auth.js");
    await expect(fetchMcpAccess("bob")).resolves.toEqual({
      mcpReadEnabled: true,
      mcpWriteEnabled: false,
    });
  });

  it("fails closed when user-info is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    const { fetchMcpAccess } = await import("./auth.js");
    await expect(fetchMcpAccess("carol")).resolves.toEqual({
      mcpReadEnabled: false,
      mcpWriteEnabled: false,
    });
  });

  it("fails closed on non-OK user-info", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: "not found" }),
      }),
    );
    const { fetchMcpAccess } = await import("./auth.js");
    await expect(fetchMcpAccess("dave")).resolves.toEqual({
      mcpReadEnabled: false,
      mcpWriteEnabled: false,
    });
  });
});
