import { describe, expect, it } from "vitest";
import {
  resolveHardcodedEntriesForDynamic,
  resolveSearchPhraseForDynamic,
  mergeFaqItemsWithLimit,
  applyItemTemplatePreservingUserFilters,
  enrichUserFiltersSplitComma,
  lookupSplitCommaValues,
} from "./dynamic-entries";

describe("resolveHardcodedEntriesForDynamic", () => {
  it("resolves {{ single.faq_entries }} to the JSON array from the bag", () => {
    const faqs = [
      { question: "What is Art. 4?", answer: "AI literacy obligation." },
    ];
    expect(
      resolveHardcodedEntriesForDynamic("{{ single.faq_entries | [] }}", {
        faq_entries: faqs,
      }),
    ).toEqual(faqs);
  });

  it("returns [] for unresolved binds with [] fallback", () => {
    expect(resolveHardcodedEntriesForDynamic("{{ single.faq_entries | [] }}")).toEqual(
      [],
    );
  });

  it("passes through literal arrays", () => {
    const faqs = [{ question: "Q?", answer: "A." }];
    expect(resolveHardcodedEntriesForDynamic(faqs)).toEqual(faqs);
  });

  it("returns [] for non-array unresolved values", () => {
    expect(resolveHardcodedEntriesForDynamic("not-a-bind")).toEqual([]);
  });
});

describe("resolveSearchPhraseForDynamic", () => {
  it("resolves {{ single.title }} for semantic search", () => {
    expect(
      resolveSearchPhraseForDynamic(
        "{{ single.title | ¿Qué significa ser Full Stack? }}",
        { title: "Qué es el artículo 4 del Reglamento de IA" },
      ),
    ).toBe("Qué es el artículo 4 del Reglamento de IA");
  });

  it("uses pipe fallback when title is missing", () => {
    expect(
      resolveSearchPhraseForDynamic(
        "{{ single.title | ¿Qué significa ser Full Stack? }}",
        {},
      ),
    ).toBe("¿Qué significa ser Full Stack?");
  });

  it("trims plain search strings", () => {
    expect(resolveSearchPhraseForDynamic("  hello world  ")).toBe("hello world");
  });
});

describe("location FAQ permanent_filters slug bind", () => {
  it("resolves {{ single.slug | miami-usa }} to the page slug when singleEntry is provided", async () => {
    const { resolveSingleTemplateValue } = await import("@shared/json-field");
    expect(
      resolveSingleTemplateValue("{{ single.slug | miami-usa }}", {
        slug: "atlanta-usa",
      }),
    ).toBe("atlanta-usa");
  });

  it("falls back to miami-usa when singleEntry is missing (the pre-fix location API bug)", async () => {
    const { resolveSingleTemplateValue } = await import("@shared/json-field");
    expect(resolveSingleTemplateValue("{{ single.slug | miami-usa }}", {})).toBe(
      "miami-usa",
    );
  });
});

describe("mergeFaqItemsWithLimit", () => {
  const hard = [
    { question: "H1", answer: "a" },
    { question: "H2", answer: "b" },
    { question: "H3", answer: "c" },
  ];
  const db = [
    { question: "D1", answer: "d" },
    { question: "D2", answer: "e" },
  ];

  it("returns all items when limit is unset", () => {
    expect(mergeFaqItemsWithLimit(hard, db)).toEqual([...hard, ...db]);
  });

  it("caps total at limit with hardcoded first", () => {
    expect(mergeFaqItemsWithLimit(hard, db, 2)).toEqual([
      { question: "H1", answer: "a" },
      { question: "H2", answer: "b" },
    ]);
    expect(mergeFaqItemsWithLimit(hard, db, 4)).toEqual([
      ...hard,
      { question: "D1", answer: "d" },
    ]);
  });

  it("fills remaining slots from DB when hardcoded is shorter than limit", () => {
    expect(mergeFaqItemsWithLimit(hard.slice(0, 1), db, 3)).toEqual([
      { question: "H1", answer: "a" },
      { question: "D1", answer: "d" },
      { question: "D2", answer: "e" },
    ]);
  });
});

describe("applyItemTemplatePreservingUserFilters", () => {
  it("keeps tags from the raw entry when item_template omits them", () => {
    const mapped = applyItemTemplatePreservingUserFilters(
      {
        title: "{{ single.title }}",
        taxonomy: "{{ single.category }}",
      },
      {
        title: "Hello",
        category: "js",
        tags: ["Javascript", "Python"],
      },
      [{ item_property_slug: "tags", component_renderer: "tags" }],
    );
    expect(mapped).toEqual({
      title: "Hello",
      taxonomy: "js",
      tags: ["Javascript", "Python"],
    });
  });

  it("does not overwrite tags already mapped by the template", () => {
    const mapped = applyItemTemplatePreservingUserFilters(
      {
        title: "{{ single.title }}",
        tags: "{{ single.category }}",
      },
      {
        title: "Hello",
        category: "from-category",
        tags: ["raw-tag"],
      },
      [{ item_property_slug: "tags", component_renderer: "tags" }],
    );
    expect(mapped.tags).toBe("from-category");
  });
});

describe("enrichUserFiltersSplitComma", () => {
  it("attaches split_comma_values from database editor", () => {
    const db = {
      exists: (name: string) => name === "interactive-exercises",
      get: () => ({
        editor: { tags: { type: "tags", split_comma_values: true } },
      }),
    };
    const enriched = enrichUserFiltersSplitComma(
      [
        { item_property_slug: "tags", component_renderer: "tags" },
        { item_property_slug: "category", component_renderer: "dropdown" },
      ],
      { database: "interactive-exercises", db: db as never },
    );
    expect(enriched?.[0].split_comma_values).toBe(true);
    expect(enriched?.[1].split_comma_values).toBeUndefined();
  });

  it("lookupSplitCommaValues is false when editor omits the flag", () => {
    const db = {
      exists: () => true,
      get: () => ({ editor: { tags: { type: "tags" } } }),
    };
    expect(
      lookupSplitCommaValues("tags", {
        database: "interactive-exercises",
        db: db as never,
      }),
    ).toBe(false);
  });
});
