import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hideHiddenFieldsNoticeThisSession,
  isHiddenFieldsNoticeOffThisSession,
  subscribeHiddenFieldsNoticeOff,
} from "./hiddenFieldsNoticeSession";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => Array.from(data.keys())[i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

describe("hiddenFieldsNoticeSession", () => {
  beforeEach(() => {
    vi.stubGlobal("sessionStorage", memoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts off (panel shows)", () => {
    expect(isHiddenFieldsNoticeOffThisSession()).toBe(false);
  });

  it("turns on and notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeHiddenFieldsNoticeOff(listener);
    hideHiddenFieldsNoticeThisSession();
    expect(isHiddenFieldsNoticeOffThisSession()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    hideHiddenFieldsNoticeThisSession();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not throw when storage is blocked and keeps the panel showing", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => hideHiddenFieldsNoticeThisSession()).not.toThrow();
    expect(isHiddenFieldsNoticeOffThisSession()).toBe(false);
  });
});
