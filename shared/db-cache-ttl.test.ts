import { describe, expect, it } from "vitest";
import {
  resolveCacheTtlMinutes,
  ttlCachePayload,
  ttlUiFromCache,
} from "./db-cache-ttl";

describe("resolveCacheTtlMinutes", () => {
  it("prefers ttl_minutes", () => {
    expect(resolveCacheTtlMinutes({ ttl_minutes: 5, ttl_hours: 24 })).toBe(5);
  });

  it("falls back to ttl_hours * 60", () => {
    expect(resolveCacheTtlMinutes({ ttl_hours: 2 })).toBe(120);
  });

  it("defaults to 24 hours in minutes", () => {
    expect(resolveCacheTtlMinutes(undefined)).toBe(24 * 60);
    expect(resolveCacheTtlMinutes({})).toBe(24 * 60);
  });
});

describe("ttlUiFromCache", () => {
  it("shows minutes for non-hour multiples", () => {
    expect(ttlUiFromCache({ ttl_minutes: 5 })).toEqual({
      value: "5",
      unit: "minutes",
    });
  });

  it("shows hours when ttl_minutes is divisible by 60", () => {
    expect(ttlUiFromCache({ ttl_minutes: 120 })).toEqual({
      value: "2",
      unit: "hours",
    });
  });

  it("loads legacy ttl_hours as hours", () => {
    expect(ttlUiFromCache({ ttl_hours: 24 })).toEqual({
      value: "24",
      unit: "hours",
    });
  });
});

describe("ttlCachePayload", () => {
  it("converts hours to minutes", () => {
    expect(ttlCachePayload("2", "hours")).toEqual({ ttl_minutes: 120 });
  });

  it("stores minutes as-is", () => {
    expect(ttlCachePayload("5", "minutes")).toEqual({ ttl_minutes: 5 });
  });
});
