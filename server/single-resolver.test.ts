import { describe, expect, it } from "vitest";
import { resolveSingleVars } from "./single-resolver";

describe("resolveSingleVars exact structured pipe fallbacks", () => {
  it("returns bag arrays/objects as-is", () => {
    const data = { items: "{{ entry.faq_entries }}" };
    const out = resolveSingleVars(data, {
      faq_entries: [{ question: "Q?", answer: "A." }],
    }) as { items: unknown };
    expect(out.items).toEqual([{ question: "Q?", answer: "A." }]);
  });

  it("parses JSON literal pipe fallbacks on exact miss", () => {
    const data = {
      items: "{{ entry.faq_entries | [] }}",
      config: '{{ entry.widget | {"enabled": false} }}',
      image: "{{ entry.image | /fallback.webp }}",
    };
    const out = resolveSingleVars(data, {}) as Record<string, unknown>;
    expect(out.items).toEqual([]);
    expect(out.config).toEqual({ enabled: false });
    expect(out.image).toBe("/fallback.webp");
  });

  it("returns null on exact miss with no pipe", () => {
    const out = resolveSingleVars(
      { items: "{{ entry.missing }}" },
      {},
    ) as { items: unknown };
    expect(out.items).toBeNull();
  });

  it("keeps inline interpolation string-only", () => {
    const out = resolveSingleVars(
      { title: "About {{ entry.name }}" },
      { name: "Blog" },
    ) as { title: string };
    expect(out.title).toBe("About Blog");
  });

  it("dual-accepts legacy {{ single.* }} the same as {{ entry.* }}", () => {
    const bag = { title: "Hello" };
    const entryOut = resolveSingleVars({ t: "{{ entry.title }}" }, bag) as { t: string };
    const singleOut = resolveSingleVars({ t: "{{ single.title }}" }, bag) as { t: string };
    expect(entryOut.t).toBe("Hello");
    expect(singleOut.t).toBe("Hello");
  });

  it("preserves item_template subtree (list row semantics)", () => {
    const out = resolveSingleVars(
      {
        title: "{{ entry.title }}",
        dynamic_entries: {
          item_template: { title: "{{ entry.title }}" },
        },
      },
      { title: "Page" },
    ) as {
      title: string;
      dynamic_entries: { item_template: { title: string } };
    };
    expect(out.title).toBe("Page");
    expect(out.dynamic_entries.item_template.title).toBe("{{ entry.title }}");
  });
});
