import { afterEach, describe, expect, it, vi } from "vitest";
import { followExternalHref, leaveAfter, LEAVE_WAIT_MAX_MS } from "./useInternalNav";

describe("leaveAfter (tracked click before a page load)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("leaves right away when nothing is in flight", () => {
    const go = vi.fn();
    leaveAfter(null, go);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("leaves once the send settles, only once", async () => {
    vi.useFakeTimers();
    const go = vi.fn();
    let finish!: () => void;
    leaveAfter(new Promise<void>((r) => (finish = r)), go);
    expect(go).not.toHaveBeenCalled();
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(go).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(LEAVE_WAIT_MAX_MS);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it(`never waits longer than ${LEAVE_WAIT_MAX_MS} ms (GTM missing or slow), even if the send fails`, async () => {
    vi.useFakeTimers();
    const go = vi.fn();
    leaveAfter(new Promise(() => {}), go);
    await vi.advanceTimersByTimeAsync(LEAVE_WAIT_MAX_MS - 1);
    expect(go).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(go).toHaveBeenCalledTimes(1);

    const failed = vi.fn();
    leaveAfter(Promise.reject(new Error("blocked")), failed);
    await vi.advanceTimersByTimeAsync(0);
    expect(failed).toHaveBeenCalledTimes(1);
  });
});

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
