import { describe, expect, it } from "vitest";
import { resolveDeep, resolveTemplateString } from "./variable-manager";
import { reapplyFormOverrideConditionOperands } from "@shared/preserveFormOverrideOperands";

describe("resolveTemplateString form bag", () => {
  const defs = {};
  const ctx = {};

  it("resolves form.program from the form bag", () => {
    const { text } = resolveTemplateString(
      "picked={{ form.program }}",
      defs,
      ctx,
      { form: { program: "ai-engineering" } },
    );
    expect(text).toBe("picked=ai-engineering");
  });

  it("leaves token when form bag is absent and no fallback", () => {
    const { text } = resolveTemplateString("{{ form.program }}", defs, ctx);
    expect(text).toBe("{{ form.program }}");
  });
});

describe("reapplyFormOverrideConditionOperands", () => {
  it("restores condition templates after resolveDeep bakes entry/visitor", () => {
    const section = {
      conversion_name: "root",
      tags: "{{ entry.tag }}",
      form_overrides: [
        {
          conditions: [
            {
              field_property_slug: "{{ form.program }}",
              value: "{{ visitor.id }}",
              match_method: "equals",
            },
          ],
          tags: "{{ entry.tag }}",
        },
      ],
    };
    const { data } = resolveDeep(section, {}, {}, {
      singleEntry: { tag: "from-entry" },
      visitor: { id: 9 },
    });
    const resolved = reapplyFormOverrideConditionOperands(section, data as typeof section);
    expect(resolved.tags).toBe("from-entry");
    expect(resolved.form_overrides[0].conditions[0].field_property_slug).toBe(
      "{{ form.program }}",
    );
    expect(resolved.form_overrides[0].conditions[0].value).toBe(
      "{{ visitor.id }}",
    );
    expect(resolved.form_overrides[0].tags).toBe("from-entry");
  });

  it("keeps legacy form_field_slug / entry_field_slug strings intact", () => {
    const section = {
      form_overrides: [
        {
          conditions: [
            { form_field_slug: "program", entry_field_slug: "event_started", value: "x" },
          ],
        },
      ],
    };
    const { data } = resolveDeep(section, {}, {}, {
      singleEntry: { event_started: "true" },
    });
    const restored = reapplyFormOverrideConditionOperands(section, data as typeof section);
    const cond = restored.form_overrides[0].conditions[0];
    expect(cond.form_field_slug).toBe("program");
    expect(cond.entry_field_slug).toBe("event_started");
    expect(cond.value).toBe("x");
  });
});
