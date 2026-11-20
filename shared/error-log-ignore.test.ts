import { describe, expect, it } from "vitest";
import {
  errorLogMatchesIgnoreRule,
  errorLogMatchesAnyIgnoreRule,
  formatErrorLogIgnoreRulePreview,
  suggestDefaultErrorLogIgnoreRule,
  suggestFingerprintErrorLogIgnoreRule,
  validateErrorLogIgnoreRuleInput,
  type ErrorLogIgnoreCandidate,
} from "./error-log-ignore";

const base: ErrorLogIgnoreCandidate = {
  level: "error",
  module: "unknown",
  message: "unhandled route error",
  errName: "URIError",
  context: { status: 400, url: "/%c0" },
};

describe("suggestDefaultErrorLogIgnoreRule", () => {
  it("prefers identity with errName", () => {
    const rule = suggestDefaultErrorLogIgnoreRule(base);
    expect(rule.kind).toBe("identity");
    if (rule.kind === "identity") {
      expect(rule.errName).toBe("URIError");
      expect(rule.message).toBe("unhandled route error");
    }
  });

  it("falls back to status_message when no errName", () => {
    const rule = suggestDefaultErrorLogIgnoreRule({
      ...base,
      errName: null,
    });
    expect(rule.kind).toBe("status_message");
    if (rule.kind === "status_message") {
      expect(rule.status).toBe(400);
    }
  });

  it("falls back to identity message+level+module when thin", () => {
    const rule = suggestDefaultErrorLogIgnoreRule({
      level: "warn",
      module: "db",
      message: "something odd",
      errName: null,
      context: null,
    });
    expect(rule).toEqual(
      expect.objectContaining({
        kind: "identity",
        level: "warn",
        module: "db",
        message: "something odd",
      }),
    );
    if (rule.kind === "identity") {
      expect(rule.errName).toBeUndefined();
    }
  });
});

describe("errorLogMatchesIgnoreRule", () => {
  it("matches identity URIError without matching a bare 500 of same message", () => {
    const rule = validateErrorLogIgnoreRuleInput(suggestDefaultErrorLogIgnoreRule(base));
    expect(rule).not.toBeNull();
    expect(errorLogMatchesIgnoreRule(base, rule!)).toBe(true);
    expect(
      errorLogMatchesIgnoreRule(
        {
          level: "error",
          module: "unknown",
          message: "unhandled route error",
          errName: "TypeError",
          context: { status: 500 },
        },
        rule!,
      ),
    ).toBe(false);
  });

  it("status_message requires matching status", () => {
    const rule = validateErrorLogIgnoreRuleInput({
      kind: "status_message",
      message: "unhandled route error",
      status: 400,
      level: "error",
      module: "unknown",
    });
    expect(rule).not.toBeNull();
    expect(errorLogMatchesIgnoreRule({ ...base, errName: null }, rule!)).toBe(true);
    expect(
      errorLogMatchesIgnoreRule(
        { ...base, errName: null, context: { status: 500 } },
        rule!,
      ),
    ).toBe(false);
  });

  it("fingerprint matches normalized message shape", () => {
    const rule = validateErrorLogIgnoreRuleInput(
      suggestFingerprintErrorLogIgnoreRule({
        level: "warn",
        module: "content",
        message: "Failed job 42 for request a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      }),
    );
    expect(rule).not.toBeNull();
    expect(
      errorLogMatchesIgnoreRule(
        {
          level: "warn",
          module: "content",
          message: "Failed job 99 for request ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb",
        },
        rule!,
      ),
    ).toBe(true);
    expect(
      errorLogMatchesIgnoreRule(
        {
          level: "error",
          module: "content",
          message: "Failed job 99 for request ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb",
        },
        rule!,
      ),
    ).toBe(false);
  });

  it("errorLogMatchesAnyIgnoreRule is false for empty rules", () => {
    expect(errorLogMatchesAnyIgnoreRule(base, [])).toBe(false);
    expect(errorLogMatchesAnyIgnoreRule(base, null)).toBe(false);
  });
});

describe("formatErrorLogIgnoreRulePreview", () => {
  it("formats identity rules", () => {
    const text = formatErrorLogIgnoreRulePreview({
      kind: "identity",
      level: "error",
      module: "unknown",
      message: "unhandled route error",
      errName: "URIError",
    });
    expect(text).toContain("URIError");
    expect(text).toContain("unhandled route error");
  });
});
