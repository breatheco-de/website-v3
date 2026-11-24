import { describe, expect, it } from "vitest";
import {
  isConnectionTokenBootstrapUsername,
  validateConnectionOwnerUsername,
} from "./connection-token-owner";

describe("validateConnectionOwnerUsername", () => {
  it("accepts lowercase slug usernames", () => {
    expect(validateConnectionOwnerUsername("alejo-local")).toEqual({
      ok: true,
      username: "alejo-local",
    });
  });

  it("normalizes case", () => {
    expect(validateConnectionOwnerUsername("Alejo_Dev")).toEqual({
      ok: true,
      username: "alejo_dev",
    });
  });

  it("rejects email", () => {
    expect(validateConnectionOwnerUsername("a@b.com").ok).toBe(false);
  });

  it("rejects empty", () => {
    expect(validateConnectionOwnerUsername("  ").ok).toBe(false);
  });
});

describe("isConnectionTokenBootstrapUsername", () => {
  it("is false when no owner configured", () => {
    const prev = process.env.WEBLIFY_CONNECTION_OWNER;
    delete process.env.WEBLIFY_CONNECTION_OWNER;
    expect(isConnectionTokenBootstrapUsername("anyone")).toBe(false);
    if (prev !== undefined) process.env.WEBLIFY_CONNECTION_OWNER = prev;
  });

  it("matches env owner", () => {
    process.env.WEBLIFY_CONNECTION_OWNER = "dev-alice";
    expect(isConnectionTokenBootstrapUsername("dev-alice")).toBe(true);
    expect(isConnectionTokenBootstrapUsername("other")).toBe(false);
    delete process.env.WEBLIFY_CONNECTION_OWNER;
  });
});
