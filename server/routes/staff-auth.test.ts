import { afterEach, describe, expect, it } from "vitest";
import { appendQueryToReturnTo, sanitizeReturnTo } from "./staff-auth";

describe("appendQueryToReturnTo", () => {
  it("preserves MCP staff-return nonce when adding staff_session_code", () => {
    const out = appendQueryToReturnTo(
      "https://4geeks.com/oauth/staff-return?nonce=abc123",
      { staff_session_code: "exchange-1" },
    );
    const url = new URL(out);
    expect(url.origin).toBe("https://4geeks.com");
    expect(url.pathname).toBe("/oauth/staff-return");
    expect(url.searchParams.get("nonce")).toBe("abc123");
    expect(url.searchParams.get("staff_session_code")).toBe("exchange-1");
  });

  it("preserves nonce on login error redirects", () => {
    const out = appendQueryToReturnTo(
      "https://4geeks.com/oauth/staff-return?nonce=abc123",
      { staff_auth: "error", message: "denied" },
    );
    const url = new URL(out);
    expect(url.searchParams.get("nonce")).toBe("abc123");
    expect(url.searchParams.get("staff_auth")).toBe("error");
    expect(url.searchParams.get("message")).toBe("denied");
  });

  it("keeps relative CMS return paths and appends params", () => {
    expect(
      appendQueryToReturnTo("/private/settings", {
        staff_session_code: "x",
      }),
    ).toBe("/private/settings?staff_session_code=x");
  });

  it("defaults to / when returnTo is missing", () => {
    expect(
      appendQueryToReturnTo(undefined, { staff_session_code: "x" }),
    ).toBe("/?staff_session_code=x");
  });

  it("skips empty optional params", () => {
    const out = appendQueryToReturnTo("/oauth/staff-return?nonce=n", {
      staff_session_code: "x",
      github_write: undefined,
      code: "",
    });
    expect(out).toBe("/oauth/staff-return?nonce=n&staff_session_code=x");
  });
});

describe("sanitizeReturnTo", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("allows SITE_URL origin absolute MCP staff-return URLs with nonce", () => {
    process.env.SITE_URL = "https://4geeks.com";
    const raw =
      "https://4geeks.com/oauth/staff-return?nonce=d2d6d7802f93df288c13d83fd4877953e879d280fb830bd4";
    expect(sanitizeReturnTo(raw)).toBe(raw);
  });

  it("rejects disallowed absolute origins", () => {
    process.env.SITE_URL = "https://4geeks.com";
    delete process.env.MCP_PUBLIC_URL;
    expect(sanitizeReturnTo("https://evil.example/oauth/staff-return?nonce=1")).toBe(
      "/",
    );
  });
});
