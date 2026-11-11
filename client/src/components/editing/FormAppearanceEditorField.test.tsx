import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fieldEditors as heroFieldEditors } from "@shared/component-registry/hero/v1.0/field-editors";
import {
  buildFormAppearanceClearUpdates,
  splitFormAppearanceEntries,
  type FormAppearanceEntry,
} from "@shared/form-appearance";
import { applyRawValuesAtPaths } from "./applyRawValueAtPath";

vi.mock("./RichTextArea", () => ({ RichTextArea: () => null }));
vi.mock("./LinkPicker", () => ({ LinkPicker: () => null }));
vi.mock("./ImageWithStylePicker", () => ({ ImageWithStylePicker: () => null }));

import { FormAppearanceEditorField } from "./FormAppearanceEditorField";

/** Same variant resolution as SectionEditorPanel: prefixed keys only for the active variant. */
function resolveVariant(fields: Record<string, string>, variant: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, type] of Object.entries(fields)) {
    const idx = key.indexOf(":");
    if (idx > 0) {
      if (key.slice(0, idx) === variant) out[key.slice(idx + 1)] = type;
    } else {
      out[key] = type;
    }
  }
  return out;
}

const HERO_FORM_VARIANTS = ["productShowcase", "ApplyFormProductShowcase", "exercise", "workshop", "course"];

function renderBox(props: Partial<React.ComponentProps<typeof FormAppearanceEditorField>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const entries: FormAppearanceEntry[] = props.entries ?? [
    { path: "form_card_title", role: "title" },
    { path: "form.submit_label", role: "submit-label" },
    { path: "form_card_background", role: "background" },
  ];
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <FormAppearanceEditorField
        entries={entries}
        section={{ form_card_title: "Get details", form: { conversion_name: "x" } }}
        onChange={() => {}}
        onChangeMany={() => {}}
        onPickIcon={() => {}}
        formPresent
        formPath="form"
        formObjectPresent
        isAuthForm={false}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe("hero form-appearance tags", () => {
  it.each(HERO_FORM_VARIANTS)("%s groups form keys into the box, never loose rows", (variant) => {
    const { entries, rest, unknown } = splitFormAppearanceEntries(
      resolveVariant(heroFieldEditors, variant),
    );
    expect(unknown).toEqual([]);
    expect(entries.length).toBeGreaterThan(0);
    for (const path of Object.keys(rest)) {
      expect(path).not.toMatch(/^form_card_|^form_terms_color$|^form_vertical_align$|^form\.button_variant$/);
    }
  });

  it.each(HERO_FORM_VARIANTS)("%s never offers the layout role", (variant) => {
    const { entries } = splitFormAppearanceEntries(resolveVariant(heroFieldEditors, variant));
    expect(entries.some((e) => e.role === "layout")).toBe(false);
  });

  it("does not leak course signup_card editors into other variants", () => {
    const loose = resolveVariant(heroFieldEditors, "productShowcase");
    expect(Object.keys(loose).some((k) => k.startsWith("signup_card."))).toBe(false);
  });
});

describe("FormAppearanceEditorField", () => {
  it("renders tagged content rows inside the Form box", () => {
    const html = renderBox();
    expect(html).toContain('data-testid="form-appearance-editor-field"');
    expect(html).toContain('data-testid="form-appearance-title-row"');
    expect(html).toContain('data-testid="form-appearance-submit-label-row"');
    expect(html).toContain('data-testid="form-appearance-group-bar"');
  });

  it("shows the no-form note when the form is missing and locks form keys", () => {
    const html = renderBox({ formPresent: false, formObjectPresent: false });
    expect(html).toContain('data-testid="form-appearance-no-form-note"');
    expect(html).toContain('data-testid="form-appearance-submit-label-locked"');
    expect(html).not.toContain('data-testid="form-appearance-title-locked"');
  });

  it("shows the signup hint under submit label for auth forms", () => {
    expect(renderBox({ isAuthForm: true })).toContain('data-testid="form-appearance-signup-hint"');
    expect(renderBox()).not.toContain('data-testid="form-appearance-signup-hint"');
  });
});

describe("clearing a form-appearance value", () => {
  it("removes the key (and image siblings) instead of writing an empty value", () => {
    const section: Record<string, unknown> = {
      form_card_image: "https://example.com/a.webp",
      form_card_image_alt: "Badge",
      form_card_image_object_fit: "contain",
      form: { button_variant: "outline", conversion_name: "x" },
    };
    applyRawValuesAtPaths(section, {
      ...buildFormAppearanceClearUpdates({ path: "form_card_image", role: "image" }),
      "form.button_variant": undefined,
    });
    expect(section).toEqual({ form: { conversion_name: "x" } });
  });
});
