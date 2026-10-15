import { afterEach, describe, expect, it, vi } from "vitest";
import { followExternalHref } from "./useInternalNav";

describe("followExternalHref", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends same-tab redirects through location.assign", () => {
    const assign = vi.fn();
    const open = vi.fn();
    vi.stubGlobal("window", { location: { assign }, open });

    followExternalHref("https://calendar.app.google/abc", "same-tab");

    expect(assign).toHaveBeenCalledWith("https://calendar.app.google/abc");
    expect(open).not.toHaveBeenCalled();
  });

  it("opens a new tab only when asked", () => {
    const assign = vi.fn();
    const open = vi.fn();
    vi.stubGlobal("window", { location: { assign }, open });

    followExternalHref("https://calendar.app.google/abc", "new-tab");

    expect(open).toHaveBeenCalledWith(
      "https://calendar.app.google/abc",
      "_blank",
      "noopener,noreferrer",
    );
    expect(assign).not.toHaveBeenCalled();
  });
});
