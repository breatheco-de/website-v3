import { describe, expect, it } from "vitest";
import {
  applyMcpAccessToGrants,
  mcpAccessAllowsCapability,
  normalizeMcpAccess,
  type CapabilityGrant,
} from "./user-store";

describe("normalizeMcpAccess", () => {
  it("defaults missing flags to both on", () => {
    expect(normalizeMcpAccess(null)).toEqual({
      mcpReadEnabled: true,
      mcpWriteEnabled: true,
    });
    expect(normalizeMcpAccess({})).toEqual({
      mcpReadEnabled: true,
      mcpWriteEnabled: true,
    });
  });

  it("forces write off when read is off", () => {
    expect(
      normalizeMcpAccess({ mcpReadEnabled: false, mcpWriteEnabled: true }),
    ).toEqual({ mcpReadEnabled: false, mcpWriteEnabled: false });
  });

  it("allows read-only when write is explicitly false", () => {
    expect(
      normalizeMcpAccess({ mcpReadEnabled: true, mcpWriteEnabled: false }),
    ).toEqual({ mcpReadEnabled: true, mcpWriteEnabled: false });
  });
});

describe("applyMcpAccessToGrants", () => {
  const grants: CapabilityGrant[] = [
    { name: "content_view", contentTypes: "*" },
    { name: "content_edit_text", contentTypes: "*" },
    { name: "metrics_view" },
    { name: "seo_edit", contentTypes: ["blog"] },
    { name: "read_redirects" },
  ];

  it("returns empty when read is off", () => {
    expect(
      applyMcpAccessToGrants(grants, { mcpReadEnabled: false, mcpWriteEnabled: false }),
    ).toEqual([]);
  });

  it("keeps only VIEW_ONLY caps when write is off", () => {
    expect(
      applyMcpAccessToGrants(grants, { mcpReadEnabled: true, mcpWriteEnabled: false }),
    ).toEqual([
      { name: "content_view", contentTypes: "*" },
      { name: "metrics_view" },
      { name: "read_redirects" },
    ]);
  });

  it("passes through all grants when write is on", () => {
    expect(
      applyMcpAccessToGrants(grants, { mcpReadEnabled: true, mcpWriteEnabled: true }),
    ).toEqual(grants);
  });
});

describe("mcpAccessAllowsCapability", () => {
  it("denies everything when read is off", () => {
    const access = { mcpReadEnabled: false, mcpWriteEnabled: false };
    expect(mcpAccessAllowsCapability(access, "content_view")).toBe(false);
    expect(mcpAccessAllowsCapability(access, "content_edit_text")).toBe(false);
  });

  it("allows only view-only caps when write is off", () => {
    const access = { mcpReadEnabled: true, mcpWriteEnabled: false };
    expect(mcpAccessAllowsCapability(access, "content_view")).toBe(true);
    expect(mcpAccessAllowsCapability(access, "metrics_view")).toBe(true);
    expect(mcpAccessAllowsCapability(access, "read_redirects")).toBe(true);
    expect(mcpAccessAllowsCapability(access, "content_edit_text")).toBe(false);
    expect(mcpAccessAllowsCapability(access, "seo_edit")).toBe(false);
  });

  it("allows any cap name when write is on", () => {
    const access = { mcpReadEnabled: true, mcpWriteEnabled: true };
    expect(mcpAccessAllowsCapability(access, "content_edit_text")).toBe(true);
    expect(mcpAccessAllowsCapability(access, "users_manage")).toBe(true);
  });
});
