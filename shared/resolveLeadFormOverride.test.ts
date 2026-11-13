import { describe, expect, it } from "vitest";
import {
  applyLeadFormOverrideOutcome,
  resolveLeadFormOverride,
  resolveLeadFormOverrideMatch,
} from "./resolveLeadFormOverride";

describe("resolveLeadFormOverride", () => {
  it("matches form_field_slug against form values", () => {
    const override = resolveLeadFormOverride(
      { program: "ai-engineering" },
      [
        {
          conditions: [{ form_field_slug: "program", value: "ai-engineering" }],
          conversion_name: "student_application",
        },
      ],
    );
    expect(override?.conversion_name).toBe("student_application");
  });

  it("matches entry_field_slug against options.entry", () => {
    const override = resolveLeadFormOverride(
      {},
      [
        {
          conditions: [{ entry_field_slug: "event_started", value: "true" }],
          conversion_name: "live",
        },
        {
          conditions: [{ entry_field_slug: "event_started", value: "false" }],
          conversion_name: "upcoming",
        },
      ],
      { entry: { event_started: "true", slug: "ws-1" } },
    );
    expect(override?.conversion_name).toBe("live");
  });

  it("returns null when no override matches", () => {
    const override = resolveLeadFormOverride(
      { program: "other" },
      [
        {
          conditions: [{ form_field_slug: "program", value: "ai-engineering" }],
          conversion_name: "x",
        },
      ],
    );
    expect(override).toBeNull();
  });

  it("AND across mixed form_field_slug and entry_field_slug", () => {
    const hit = resolveLeadFormOverride(
      { first_name: "test" },
      [
        {
          conditions: [
            { entry_field_slug: "event_started", value: "true" },
            { form_field_slug: "first_name", value: "test" },
          ],
          conversion_name: "both",
        },
      ],
      { entry: { event_started: "true" } },
    );
    expect(hit?.conversion_name).toBe("both");

    const miss = resolveLeadFormOverride(
      { first_name: "other" },
      [
        {
          conditions: [
            { entry_field_slug: "event_started", value: "true" },
            { form_field_slug: "first_name", value: "test" },
          ],
          conversion_name: "both",
        },
      ],
      { entry: { event_started: "true" } },
    );
    expect(miss).toBeNull();
  });

  it("contains: membership on entry array + resolveValue visitor id", () => {
    const resolveValue = (raw: string) => {
      if (raw === "{{ visitor.id }}") return 42;
      return raw;
    };
    const override = resolveLeadFormOverride(
      {},
      [
        {
          conditions: [
            {
              entry_field_slug: "registered_attendee_ids",
              match_method: "contains",
              value: "{{ visitor.id }}",
            },
          ],
          conversion_name: "already",
        },
      ],
      {
        entry: { registered_attendee_ids: [42, 7] },
        resolveValue,
      },
    );
    expect(override?.conversion_name).toBe("already");
  });

  it("contains: substring on strings from form_field_slug", () => {
    const override = resolveLeadFormOverride(
      { program: "ai-engineering-full" },
      [
        {
          conditions: [
            {
              form_field_slug: "program",
              match_method: "contains",
              value: "engineering",
            },
          ],
          conversion_name: "partial",
        },
      ],
    );
    expect(override?.conversion_name).toBe("partial");
  });

  it("condition with neither slug never matches", () => {
    const override = resolveLeadFormOverride(
      { program: "x" },
      [
        {
          conditions: [{ value: "x" } as { value: string }],
          conversion_name: "bad",
        },
      ],
    );
    expect(override).toBeNull();
  });

  it("prefers form_field_slug when both are set on one condition", () => {
    const override = resolveLeadFormOverride(
      { program: "from-form" },
      [
        {
          conditions: [
            {
              form_field_slug: "program",
              entry_field_slug: "program",
              value: "from-form",
            },
          ],
          conversion_name: "form-wins",
        },
      ],
      { entry: { program: "from-entry" } },
    );
    expect(override?.conversion_name).toBe("form-wins");
  });

  it("entry_field_slug without entry option does not match", () => {
    const override = resolveLeadFormOverride(
      {},
      [
        {
          conditions: [{ entry_field_slug: "event_started", value: "false" }],
          conversion_name: "upcoming",
        },
      ],
    );
    expect(override).toBeNull();
  });

  it("matches field_property_slug via resolveValue (form bag template)", () => {
    const resolveValue = (raw: string) => {
      if (raw === "{{ form.program }}") return "ai-engineering";
      return raw;
    };
    const override = resolveLeadFormOverride(
      { program: "ai-engineering" },
      [
        {
          conditions: [
            {
              field_property_slug: "{{ form.program }}",
              value: "ai-engineering",
            },
          ],
          conversion_name: "from-field-prop",
        },
      ],
      { resolveValue },
    );
    expect(override?.conversion_name).toBe("from-field-prop");
  });

  it("prefers field_property_slug over legacy form_field_slug", () => {
    const resolveValue = (raw: string) => {
      if (raw === "{{ form.program }}") return "from-prop";
      if (raw === "{{ form.other }}") return "from-legacy";
      return raw;
    };
    const override = resolveLeadFormOverride(
      { program: "from-prop", other: "from-legacy" },
      [
        {
          conditions: [
            {
              field_property_slug: "{{ form.program }}",
              form_field_slug: "other",
              value: "from-prop",
            },
          ],
          conversion_name: "prop-wins",
        },
      ],
      { resolveValue },
    );
    expect(override?.conversion_name).toBe("prop-wins");
  });

  it("legacy form_field_slug uses {{ form.* }} when resolveValue is set", () => {
    const resolveValue = (raw: string) => {
      if (raw === "{{ form.program }}") return "ai-engineering";
      return raw;
    };
    const override = resolveLeadFormOverride(
      {},
      [
        {
          conditions: [{ form_field_slug: "program", value: "ai-engineering" }],
          conversion_name: "compat",
        },
      ],
      { resolveValue },
    );
    expect(override?.conversion_name).toBe("compat");
  });

  it("legacy entry_field_slug uses {{ entry.* }} when resolveValue is set", () => {
    const resolveValue = (raw: string) => {
      if (raw === "{{ entry.event_started }}") return "true";
      return raw;
    };
    const override = resolveLeadFormOverride(
      {},
      [
        {
          conditions: [{ entry_field_slug: "event_started", value: "true" }],
          conversion_name: "compat-entry",
        },
      ],
      { resolveValue },
    );
    expect(override?.conversion_name).toBe("compat-entry");
  });
});

describe("applyLeadFormOverrideOutcome", () => {
  it("deep-merges messages", () => {
    const merged = applyLeadFormOverrideOutcome(
      {
        messages: {
          ready: { subtitle: "base", submit_label: "Go" },
          guest: { subtitle: "hi" },
        },
      },
      {
        messages: {
          ready: { subtitle: "overlay", submit_disabled: true },
        },
      },
    );
    expect(merged.messages).toEqual({
      ready: { subtitle: "overlay", submit_label: "Go", submit_disabled: true },
      guest: { subtitle: "hi" },
    });
  });

  it("returns formData when override is null", () => {
    const form = { conversion_name: "root" };
    expect(applyLeadFormOverrideOutcome(form, null)).toBe(form);
  });
});

describe("resolveLeadFormOverrideMatch", () => {
  const overrides = [
    { conditions: [], conversion_name: "skipped-no-conditions" },
    { conditions: [{ form_field_slug: "program", value: "web" }], conversion_name: "web-lead" },
    { conditions: [{ form_field_slug: "program", value: "ai" }], conversion_name: "ai-lead", tags: "ai" },
  ];

  it("returns the matched index and the same outcome as resolveLeadFormOverride", () => {
    const match = resolveLeadFormOverrideMatch({ program: "ai" }, overrides);
    expect(match?.index).toBe(2);
    expect(match?.outcome).toEqual(resolveLeadFormOverride({ program: "ai" }, overrides));
    expect(match?.outcome).toEqual({ conversion_name: "ai-lead", tags: "ai" });
  });

  it("returns the first match", () => {
    const match = resolveLeadFormOverrideMatch({ program: "web" }, [...overrides, overrides[1]!]);
    expect(match?.index).toBe(1);
  });

  it("returns null when nothing matches or the list is empty", () => {
    expect(resolveLeadFormOverrideMatch({ program: "none" }, overrides)).toBeNull();
    expect(resolveLeadFormOverrideMatch({}, undefined)).toBeNull();
  });
});
