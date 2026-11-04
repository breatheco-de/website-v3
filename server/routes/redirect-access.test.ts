import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CapabilityGrant } from "../user-store";

const grantsByUser: Record<string, CapabilityGrant[]> = {
  steward: [{ name: "read_redirects" }, { name: "edit_redirects" }],
  ppc: [
    { name: "content_view", contentTypes: ["landing"] },
    { name: "edit_page_redirects", contentTypes: ["landing"] },
  ],
  reader: [{ name: "read_redirects" }],
  editor: [{ name: "content_edit_text", contentTypes: "*" }],
};

vi.mock("../staff-session-resolve", () => ({
  resolveOwnedStaffSession: async (token: string) => (grantsByUser[token] ? { username: token } : null),
}));

vi.mock("../user-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../user-store")>();
  const grants = (username: string) => grantsByUser[username] ?? [];
  return {
    ...actual,
    getEffectiveCapabilities: (username: string) => grants(username),
    hasCapability: (username: string, cap: string, scope?: string) =>
      actual.grantAllowsCap(grants(username).find((g) => g.name === cap), cap as never, scope),
  };
});

import { requireRedirectReadAccess, requireRedirectWriteAccess } from "./_helpers";

function call(user: string | null, body: Record<string, unknown> = {}) {
  const req = {
    headers: user ? { "x-debug-token": user } : {},
    params: {},
    body,
  } as unknown as Request;
  const sent: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(payload: unknown) {
      sent.body = payload;
      return this;
    },
  } as unknown as Response;
  return { req, res, sent };
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("MCP_SERVER_SECRET", "");
  vi.stubEnv("MCP_API_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("requireRedirectWriteAccess", () => {
  it("edit_redirects is global", async () => {
    const { req, res } = call("steward");
    const auth = await requireRedirectWriteAccess(req, res);
    expect(auth).toMatchObject({ authorized: true, hasGlobal: true });
  });

  it("edit_page_redirects is page scoped to its content types", async () => {
    const { req, res } = call("ppc");
    const auth = await requireRedirectWriteAccess(req, res);
    expect(auth).toMatchObject({ authorized: true, hasGlobal: false });
    expect(auth.canEditPage("landing")).toBe(true);
    expect(auth.canEditPage("blog")).toBe(false);
  });

  it("refuses users with neither capability", async () => {
    for (const user of ["reader", "editor"]) {
      const { req, res, sent } = call(user);
      const auth = await requireRedirectWriteAccess(req, res);
      expect(auth.authorized).toBe(false);
      expect(sent.status).toBe(403);
    }
  });

  it("MCP loopback / dev without a session is global unless page_scope is set", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const global = await requireRedirectWriteAccess(call(null).req, call(null).res);
    expect(global).toMatchObject({ authorized: true, hasGlobal: true });
    const scoped = call(null, { page_scope: true });
    const auth = await requireRedirectWriteAccess(scoped.req, scoped.res);
    expect(auth).toMatchObject({ authorized: true, hasGlobal: false });
    expect(auth.canEditPage("anything")).toBe(true);
  });
});

describe("requireRedirectReadAccess", () => {
  it("allows read_redirects or edit_page_redirects at any scope", async () => {
    for (const user of ["steward", "ppc", "reader"]) {
      const { req, res } = call(user);
      expect((await requireRedirectReadAccess(req, res)).authorized).toBe(true);
    }
  });

  it("refuses content editors without redirect access", async () => {
    const { req, res, sent } = call("editor");
    expect((await requireRedirectReadAccess(req, res)).authorized).toBe(false);
    expect(sent.status).toBe(403);
  });
});
