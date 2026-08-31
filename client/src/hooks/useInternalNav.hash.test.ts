import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { scrollToSectionWhenReady } = vi.hoisted(() => ({
  scrollToSectionWhenReady: vi.fn(),
}));

vi.mock("./useScrollToLocationHashWhenReady", () => ({
  scrollToSectionWhenReady,
}));

import { activateHashTarget } from "./useInternalNav";

describe("activateHashTarget", () => {
  let locationHash: string;
  let locationSearch: string;
  let locationPathname: string;
  let hashChangeCount: number;
  let replaceStateCalls: string[];
  let elements: Map<string, { dataset: { sectionType?: string } }>;

  beforeEach(() => {
    locationHash = "";
    locationSearch = "";
    locationPathname = "/programs/ai-engineering";
    hashChangeCount = 0;
    replaceStateCalls = [];
    elements = new Map();
    scrollToSectionWhenReady.mockClear();

    vi.stubGlobal("document", {
      getElementById: (id: string) => {
        const el = elements.get(id);
        if (!el) return null;
        return { dataset: el.dataset };
      },
    });

    vi.stubGlobal("history", {
      replaceState: (_a: unknown, _b: unknown, url: string) => {
        replaceStateCalls.push(url);
        const u = new URL(url, "http://localhost");
        locationPathname = u.pathname;
        locationSearch = u.search;
        if (u.hash) locationHash = u.hash;
      },
    });

    vi.stubGlobal("window", {
      location: {
        get pathname() {
          return locationPathname;
        },
        get search() {
          return locationSearch;
        },
        get hash() {
          return locationHash;
        },
        set hash(v: string) {
          const next = v.startsWith("#") ? v : `#${v}`;
          if (next !== locationHash) {
            locationHash = next;
            hashChangeCount += 1;
          }
        },
      },
      dispatchEvent: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fires hashchange for modal targets without replaceState hash first", () => {
    elements.set("modal-ubwgcj", { dataset: { sectionType: "modal" } });

    activateHashTarget("modal-ubwgcj", "");

    expect(locationHash).toBe("#modal-ubwgcj");
    expect(hashChangeCount).toBe(1);
    expect(replaceStateCalls).toEqual([]);
  });

  it("merges search before assigning modal hash", () => {
    elements.set("modal-ubwgcj", { dataset: { sectionType: "modal" } });

    activateHashTarget("modal-ubwgcj", "?cohort=1713");

    expect(locationPathname).toBe("/programs/ai-engineering");
    expect(locationSearch).toBe("?cohort=1713");
    expect(locationHash).toBe("#modal-ubwgcj");
    expect(replaceStateCalls).toEqual(["/programs/ai-engineering?cohort=1713"]);
  });

  it("uses replaceState with hash for non-modal sections", () => {
    elements.set("pricing-6svo9e", { dataset: { sectionType: "pricing" } });

    activateHashTarget("pricing-6svo9e", "?cohort=1713");

    expect(replaceStateCalls).toEqual([
      "/programs/ai-engineering?cohort=1713#pricing-6svo9e",
    ]);
    expect(scrollToSectionWhenReady).toHaveBeenCalledWith("pricing-6svo9e");
  });
});
