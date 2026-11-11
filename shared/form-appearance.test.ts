import { describe, expect, it } from "vitest";
import {
  buildFormAppearanceClearUpdates,
  parseFormAppearanceRole,
  resolveFormAppearanceAnchor,
  splitFormAppearanceEntries,
} from "./form-appearance";

describe("parseFormAppearanceRole", () => {
  it("reads known roles", () => {
    expect(parseFormAppearanceRole("form-appearance:background")).toBe("background");
    expect(parseFormAppearanceRole("form-appearance:button-style")).toBe("button-style");
  });

  it("rejects other editors and unknown roles", () => {
    expect(parseFormAppearanceRole("color-picker:background")).toBeNull();
    expect(parseFormAppearanceRole("form-appearance")).toBeNull();
    expect(parseFormAppearanceRole("form-appearance:card-background")).toBeNull();
  });
});

describe("splitFormAppearanceEntries", () => {
  it("pulls tagged keys out of the loose fields, in catalog order", () => {
    const { entries, rest, unknown } = splitFormAppearanceEntries({
      "form.button_variant": "form-appearance:button-style",
      form_card_title: "form-appearance:title",
      form_card_background: "form-appearance:background",
      form: "form-settings",
      "left_images[].src": "image-picker",
    });
    expect(entries.map((e) => e.role)).toEqual(["title", "background", "button-style"]);
    expect(rest).toEqual({ form: "form-settings", "left_images[].src": "image-picker" });
    expect(unknown).toEqual([]);
  });

  it("drops unknown roles from both lists", () => {
    const { entries, rest, unknown } = splitFormAppearanceEntries({
      x: "form-appearance:nope",
    });
    expect(entries).toEqual([]);
    expect(rest).toEqual({});
    expect(unknown).toEqual(["x: form-appearance:nope"]);
  });
});

describe("resolveFormAppearanceAnchor", () => {
  it("uses the shared parent of the tagged keys", () => {
    expect(
      resolveFormAppearanceAnchor(
        ["signup_card.title", "signup_card.form.button_variant"],
        "signup_card.form",
      ),
    ).toBe("signup_card");
  });

  it("falls back to the form path when keys sit at the root", () => {
    expect(
      resolveFormAppearanceAnchor(["form_card_background", "form.button_variant"], "form"),
    ).toBe("form");
  });

  it("uses the section root for root forms", () => {
    expect(resolveFormAppearanceAnchor(["button_variant", "title"], "")).toBe("");
    expect(resolveFormAppearanceAnchor(["button_variant"], null)).toBe("");
  });
});

describe("buildFormAppearanceClearUpdates", () => {
  it("removes the key", () => {
    expect(
      buildFormAppearanceClearUpdates({ path: "form_card_background", role: "background" }),
    ).toEqual({ form_card_background: undefined });
  });

  it("removes image siblings too", () => {
    expect(buildFormAppearanceClearUpdates({ path: "form_card_image", role: "image" })).toEqual({
      form_card_image: undefined,
      form_card_image_alt: undefined,
      form_card_image_object_fit: undefined,
      form_card_image_object_position: undefined,
    });
  });
});
