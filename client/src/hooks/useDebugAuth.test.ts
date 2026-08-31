import { describe, expect, it } from "vitest";
import { resolveDebugModeActive } from "./useDebugAuth";

describe("resolveDebugModeActive", () => {
  const off = {
    debugParam: null as string | null,
    isDismissed: false,
    isDev: false,
    hasDebugModeFlag: false,
    hasNonExpiredStaffToken: false,
  };

  it("turns off for ?debug=false even when staff token and DEV would enable", () => {
    expect(
      resolveDebugModeActive({
        ...off,
        debugParam: "false",
        isDev: true,
        hasNonExpiredStaffToken: true,
        hasDebugModeFlag: true,
      }),
    ).toBe(false);
  });

  it("turns off when dismissed unless ?debug=true", () => {
    expect(
      resolveDebugModeActive({
        ...off,
        isDismissed: true,
        isDev: true,
        hasNonExpiredStaffToken: true,
        hasDebugModeFlag: true,
      }),
    ).toBe(false);
    expect(
      resolveDebugModeActive({
        ...off,
        isDismissed: true,
        debugParam: "true",
      }),
    ).toBe(true);
  });

  it("turns on for ?debug=true", () => {
    expect(resolveDebugModeActive({ ...off, debugParam: "true" })).toBe(true);
  });

  it("turns on in DEV when not dismissed", () => {
    expect(resolveDebugModeActive({ ...off, isDev: true })).toBe(true);
  });

  it("turns on when debug_mode flag is set", () => {
    expect(resolveDebugModeActive({ ...off, hasDebugModeFlag: true })).toBe(true);
  });

  it("turns on for non-expired staff token", () => {
    expect(
      resolveDebugModeActive({ ...off, hasNonExpiredStaffToken: true }),
    ).toBe(true);
  });

  it("stays off with no opt-in and no staff token", () => {
    expect(resolveDebugModeActive(off)).toBe(false);
  });

  it("treats expired/missing token as off when nothing else enables", () => {
    expect(
      resolveDebugModeActive({ ...off, hasNonExpiredStaffToken: false }),
    ).toBe(false);
  });
});
