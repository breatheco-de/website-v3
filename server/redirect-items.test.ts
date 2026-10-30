import { describe, expect, it } from "vitest";
import { diffRedirectItems, hasRedirectChanges, mergeRedirectLists, redirectItems } from "./redirect-items";

describe("redirectItems / diffRedirectItems", () => {
  it("normalizes paths and reads string and { path, status } items", () => {
    const items = redirectItems({ meta: { redirects: ["/Old/", { path: "/b", status: 302 }, "", null] } });
    expect([...items.keys()]).toEqual(["/old", "/b"]);
    expect(items.get("/b")!.status).toBe(302);
  });

  it("reports added, removed and status-changed addresses", () => {
    const changes = diffRedirectItems(
      { meta: { redirects: ["/a", "/b"] } },
      { meta: { redirects: ["/a/", { path: "/b", status: 302 }, "/c"] } },
    );
    expect(changes.added.map((i) => i.path)).toEqual(["/c"]);
    expect(changes.removed).toEqual([]);
    expect(changes.changed.map((i) => i.path)).toEqual(["/b"]);
    expect(hasRedirectChanges(changes)).toBe(true);
    expect(hasRedirectChanges(diffRedirectItems({ meta: { redirects: ["/a"] } }, { meta: { redirects: ["/A"] } }))).toBe(false);
  });
});

describe("mergeRedirectLists (base, author, live)", () => {
  it("keeps live additions and applies author additions", () => {
    const merged = mergeRedirectLists(["/a"], ["/a", "/draft"], ["/a", "/live"]);
    expect(merged).toEqual({ ok: true, list: ["/a", "/live", "/draft"] });
  });

  it("applies author removals, including addresses copied from live", () => {
    expect(mergeRedirectLists(["/a", "/b"], ["/a"], ["/a", "/b", "/live"])).toEqual({ ok: true, list: ["/a", "/live"] });
  });

  it("keeps a live removal even though the draft still has its old copy", () => {
    expect(mergeRedirectLists(["/a", "/b"], ["/a", "/b", "/draft"], ["/a"])).toEqual({ ok: true, list: ["/a", "/draft"] });
  });

  it("same address added on both sides with the same status is not a conflict", () => {
    expect(mergeRedirectLists([], ["/x"], ["/x"])).toEqual({ ok: true, list: ["/x"] });
  });

  it("same address changed differently on both sides is a conflict on that address only", () => {
    const merged = mergeRedirectLists(["/a", "/b"], ["/a", { path: "/b", status: 302 }, "/c"], ["/a"]);
    expect(merged.ok).toBe(false);
    if (!merged.ok) expect(merged.conflicts.map((c) => c.path)).toEqual(["/b"]);
  });
});
