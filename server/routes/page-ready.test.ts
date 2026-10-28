import { describe, expect, it, vi } from "vitest";
import type { Request } from "express";

vi.mock("../staff-session-resolve", () => ({
  resolveOwnedStaffSession: async (token: string | null) => (token === "staff-token" ? { username: "ana" } : null),
}));

const { shouldDrop } = await import("./page-ready");

function req(headers: Record<string, string>): Request {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { headers: lower, get: (name: string) => lower[name.toLowerCase()] } as unknown as Request;
}

const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";

describe("page-ready drop rules", () => {
  it("keeps normal visitors", async () => {
    expect(await shouldDrop(req({ "user-agent": PHONE }))).toBe(false);
  });

  it("drops bots", async () => {
    expect(await shouldDrop(req({ "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }))).toBe(true);
  });

  it("drops requests carrying a logged-in staff session, keeps unknown tokens", async () => {
    expect(await shouldDrop(req({ "user-agent": PHONE, "x-debug-token": "staff-token" }))).toBe(true);
    expect(await shouldDrop(req({ "user-agent": PHONE, "x-debug-token": "expired" }))).toBe(false);
  });
});
