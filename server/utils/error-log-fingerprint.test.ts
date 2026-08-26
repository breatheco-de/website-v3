import { describe, expect, it } from "vitest";
import {
  errorLogFingerprint,
  normalizeErrorLogMessage,
} from "./error-log-fingerprint";

describe("normalizeErrorLogMessage", () => {
  it("collapses differing content slugs in buildUrl warns", () => {
    const a = normalizeErrorLogMessage(
      "[ContentIndex] buildUrl(program, es, ai-engineering-bootcamp-chile): unresolved URL pattern variable(s) :campus — pass them via params",
    );
    const b = normalizeErrorLogMessage(
      "[ContentIndex] buildUrl(program, es, coding-bootcamp-miami): unresolved URL pattern variable(s) :campus — pass them via params",
    );
    expect(a).toBe(b);
    expect(a).toContain("<slug>");
    expect(a).not.toContain("ai-engineering");
  });

  it("collapses UUIDs and numbers", () => {
    const a = normalizeErrorLogMessage(
      "Failed job 42 for request a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    );
    const b = normalizeErrorLogMessage(
      "Failed job 99 for request ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb",
    );
    expect(a).toBe(b);
    expect(a).toContain("<uuid>");
    expect(a).toContain("<n>");
  });

  it("collapses ISO timestamps", () => {
    const a = normalizeErrorLogMessage("Stale cache at 2024-03-15T12:30:00.000Z");
    const b = normalizeErrorLogMessage("Stale cache at 2025-01-01T00:00:00Z");
    expect(a).toBe(b);
    expect(a).toContain("<ts>");
  });
});

describe("errorLogFingerprint", () => {
  it("includes module and normalized message", () => {
    const fp = errorLogFingerprint(
      "content-index",
      "buildUrl(program, es, some-slug-here): unresolved",
    );
    expect(fp.startsWith("content-index|")).toBe(true);
    expect(fp).toContain("<slug>");
  });

  it("differs by module even when messages match", () => {
    const msg = "something went wrong with id 123";
    expect(errorLogFingerprint("a", msg)).not.toBe(errorLogFingerprint("b", msg));
  });
});
