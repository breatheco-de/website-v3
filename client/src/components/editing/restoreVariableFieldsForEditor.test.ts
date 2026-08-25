import { describe, expect, it } from "vitest";
import {
  restoreVariableFieldsForEditor,
  mergeSavedSectionForLivePreview,
} from "./restoreVariableFieldsForEditor";

describe("restoreVariableFieldsForEditor", () => {
  it("restores permanent_filters value from _variableFields over resolved slug", () => {
    const section = {
      type: "faq",
      dynamic_entries: {
        database: "frequently_asked_questions",
        permanent_filters: [
          { item_property_slug: "locations", value: "miami-usa" },
        ],
      },
      items: [{ question: "Q?", answer: "A." }],
      _variableFields: {
        "dynamic_entries.permanent_filters.0.value": "{{ single.slug }}",
      },
      _dynamic_meta: { total: 1 },
    };

    expect(restoreVariableFieldsForEditor(section)).toEqual({
      type: "faq",
      dynamic_entries: {
        database: "frequently_asked_questions",
        permanent_filters: [
          { item_property_slug: "locations", value: "{{ single.slug }}" },
        ],
      },
    });
  });

  it("strips private keys; keeps items when there is no dynamic_entries", () => {
    const section = {
      type: "faq",
      title: "FAQ",
      items: [{ question: "Q?", answer: "A." }],
      _dynamic_meta: { total: 1 },
    };
    expect(restoreVariableFieldsForEditor(section)).toEqual({
      type: "faq",
      title: "FAQ",
      items: [{ question: "Q?", answer: "A." }],
    });
  });

  it("returns non-objects unchanged", () => {
    expect(restoreVariableFieldsForEditor(null)).toBeNull();
    expect(restoreVariableFieldsForEditor("x")).toBe("x");
  });
});

describe("mergeSavedSectionForLivePreview", () => {
  it("keeps previous items when saved section has dynamic_entries but no items", () => {
    const previous = {
      type: "faq",
      items: [{ question: "Miami Q?", answer: "A." }],
      _dynamic_meta: { total: 1 },
      _variableFields: {},
    };
    const saved = {
      type: "faq",
      dynamic_entries: {
        database: "frequently_asked_questions",
        permanent_filters: [
          { item_property_slug: "locations", value: "{{ single.slug }}" },
        ],
      },
    };

    const merged = mergeSavedSectionForLivePreview(previous, saved);
    expect(merged.items).toEqual([{ question: "Miami Q?", answer: "A." }]);
    expect(merged._dynamic_meta).toEqual({ total: 1 });
    expect(merged._variableFields).toEqual({
      "dynamic_entries.permanent_filters.0.value": "{{ single.slug }}",
    });
    expect(
      (merged.dynamic_entries as { permanent_filters: Array<{ value: string }> })
        .permanent_filters[0].value,
    ).toBe("{{ single.slug }}");
  });

  it("does not override items when the saved payload already has them", () => {
    const previous = {
      type: "faq",
      items: [{ question: "Old?", answer: "A." }],
    };
    const saved = {
      type: "faq",
      dynamic_entries: { database: "frequently_asked_questions" },
      items: [{ question: "New?", answer: "B." }],
    };
    expect(mergeSavedSectionForLivePreview(previous, saved).items).toEqual([
      { question: "New?", answer: "B." },
    ]);
  });

  it("drops stale _variableFields after unbind to static literal", () => {
    const previous = {
      type: "list_cards",
      badge: "Guides",
      _variableFields: {
        badge: "{{ single.category | category }}",
      },
    };
    const saved = {
      type: "list_cards",
      badge: "Guides",
    };
    const merged = mergeSavedSectionForLivePreview(previous, saved);
    expect(merged.badge).toBe("Guides");
    expect(merged._variableFields).toBeUndefined();
  });
});
