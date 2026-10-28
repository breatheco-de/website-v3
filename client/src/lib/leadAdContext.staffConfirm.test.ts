import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { needsStaffSubmitConfirm, skipStaffSubmitConfirmThisSession } from "./leadAdContext";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
    removeItem: (key: string) => {
      delete data[key];
    },
  };
}

describe("staff lead submit confirmation", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("sessionStorage", memoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never asks visitors", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    expect(needsStaffSubmitConfirm()).toBe(false);
  });

  it("asks staff until they skip it for the session", () => {
    vi.stubGlobal(
      "localStorage",
      memoryStorage({ debug_token: "t", debug_validated_expiry: String(Date.now() + 60_000) }),
    );
    expect(needsStaffSubmitConfirm()).toBe(true);
    skipStaffSubmitConfirmThisSession();
    expect(needsStaffSubmitConfirm()).toBe(false);
  });
});
