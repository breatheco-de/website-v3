import { describe, expect, it, vi } from "vitest";
import {
  buildSeoModalSavedDetail,
  notifySeoModalSaved,
} from "@/components/editing/seoModalSaved";

describe("buildSeoModalSavedDetail", () => {
  it("includes identity and areas for keyword saves", () => {
    expect(
      buildSeoModalSavedDetail(
        { contentType: "blog", slug: "hello", locale: "es" },
        ["keywords"],
      ),
    ).toEqual({
      contentType: "blog",
      slug: "hello",
      locale: "es",
      areas: ["keywords"],
    });
  });

  it("includes variant when provided", () => {
    expect(
      buildSeoModalSavedDetail(
        { contentType: "blog", slug: "hello", locale: "en", variant: "draft" },
        ["meta", "locations"],
      ),
    ).toEqual({
      contentType: "blog",
      slug: "hello",
      locale: "en",
      variant: "draft",
      areas: ["meta", "locations"],
    });
  });

  it("omits variant when undefined", () => {
    const detail = buildSeoModalSavedDetail(
      { contentType: "landing", slug: "home", locale: "en", variant: undefined },
      ["fields"],
    );
    expect(detail).not.toHaveProperty("variant");
    expect(detail.areas).toEqual(["fields"]);
  });
});

describe("notifySeoModalSaved", () => {
  it("invokes onSaved with keyword detail after SEO field writes", () => {
    const onSaved = vi.fn();
    notifySeoModalSaved(
      onSaved,
      { contentType: "blog", slug: "aprende-a-programacion-desde-cero", locale: "es" },
      ["keywords"],
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith({
      contentType: "blog",
      slug: "aprende-a-programacion-desde-cero",
      locale: "es",
      areas: ["keywords"],
    });
  });

  it("no-ops when onSaved is omitted", () => {
    expect(() =>
      notifySeoModalSaved(
        undefined,
        { contentType: "blog", slug: "x", locale: "en" },
        ["meta"],
      ),
    ).not.toThrow();
  });

  it("notifies fields and funnel areas used by nested modal tabs", () => {
    const onSaved = vi.fn();
    notifySeoModalSaved(onSaved, { contentType: "program", slug: "fs", locale: "en" }, ["fields"]);
    notifySeoModalSaved(onSaved, { contentType: "program", slug: "fs", locale: "en" }, ["funnel"]);
    expect(onSaved.mock.calls.map((c) => c[0].areas)).toEqual([["fields"], ["funnel"]]);
  });
});
