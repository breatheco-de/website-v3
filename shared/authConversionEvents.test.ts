import { describe, expect, it } from "vitest";
import {
  appendAliasOnRename,
  DEFAULT_AUTH_CONVERSION_EVENTS,
  isAuthConversionName,
  isLoginConversionName,
  isReservedAuthEventName,
  isSignupConversionName,
  parseAuthConversionEventConfig,
  resolveAuthConversionKind,
  validateAuthConversionEventConfig,
} from "./authConversionEvents";

describe("parseAuthConversionEventConfig", () => {
  it("defaults to sign_up / login", () => {
    const cfg = parseAuthConversionEventConfig({});
    expect(cfg.signup_event_name).toBe("sign_up");
    expect(cfg.login_event_name).toBe("login");
    expect(cfg.signup_event_aliases).toEqual([]);
  });

  it("reads custom names and aliases", () => {
    const cfg = parseAuthConversionEventConfig({
      signup_event_name: "website_sign_up",
      login_event_name: "website_login",
      signup_event_aliases: ["sign_up", "sign_up", ""],
      login_event_aliases: ["login"],
    });
    expect(cfg.signup_event_name).toBe("website_sign_up");
    expect(cfg.signup_event_aliases).toEqual(["sign_up"]);
    expect(cfg.login_event_aliases).toEqual(["login"]);
  });
});

describe("alias-aware matchers", () => {
  const cfg = {
    ...DEFAULT_AUTH_CONVERSION_EVENTS,
    signup_event_name: "website_sign_up",
    signup_event_aliases: ["sign_up"],
    login_event_name: "website_login",
    login_event_aliases: ["login"],
  };

  it("matches canonical and aliases", () => {
    expect(isSignupConversionName("website_sign_up", cfg)).toBe(true);
    expect(isSignupConversionName("sign_up", cfg)).toBe(true);
    expect(isLoginConversionName("login", cfg)).toBe(true);
    expect(isAuthConversionName("request_more_info", cfg)).toBe(false);
    expect(resolveAuthConversionKind("sign_up", cfg)).toBe("signup");
    expect(resolveAuthConversionKind("login", cfg)).toBe("login");
  });

  it("reserves aliases", () => {
    expect(isReservedAuthEventName("sign_up", cfg)).toBe(true);
    expect(isReservedAuthEventName("student_application", cfg)).toBe(false);
  });
});

describe("appendAliasOnRename", () => {
  it("appends previous canonical and drops new canonical from aliases", () => {
    expect(appendAliasOnRename("sign_up", "website_sign_up", [])).toEqual(["sign_up"]);
    expect(appendAliasOnRename("sign_up", "website_sign_up", ["sign_up", "website_sign_up"])).toEqual([
      "sign_up",
    ]);
    expect(appendAliasOnRename("sign_up", "sign_up", ["old"])).toEqual(["old"]);
  });
});

describe("validateAuthConversionEventConfig", () => {
  it("rejects collisions", () => {
    expect(
      validateAuthConversionEventConfig({
        signup_event_name: "sign_up",
        login_event_name: "sign_up",
        signup_event_aliases: [],
        login_event_aliases: [],
      }),
    ).toMatch(/must be different/);
    expect(
      validateAuthConversionEventConfig({
        signup_event_name: "sign_up",
        login_event_name: "login",
        signup_event_aliases: ["login"],
        login_event_aliases: [],
      }),
    ).toMatch(/collides/);
  });

  it("accepts defaults", () => {
    expect(validateAuthConversionEventConfig(DEFAULT_AUTH_CONVERSION_EVENTS)).toBeNull();
  });
});
