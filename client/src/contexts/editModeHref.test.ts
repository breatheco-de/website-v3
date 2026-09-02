import { describe, expect, it } from "vitest";
import {
  extractTemplateVariableName,
  prepareEditModeHref,
} from "./editModeHref";

describe("prepareEditModeHref", () => {
  it("unwraps preserved LearnPack-style templates to external", () => {
    expect(
      prepareEditModeHref(
        "{{ entry.learnpack_url | https://react-tutorial-exercises.learn-pack.com }}",
      ),
    ).toEqual({
      kind: "external",
      href: "https://react-tutorial-exercises.learn-pack.com",
    });
  });

  it("marks unresolved bare templates", () => {
    expect(prepareEditModeHref("{{ entry.learnpack_url }}")).toEqual({
      kind: "unresolved",
      href: "{{ entry.learnpack_url }}",
      variableName: "entry.learnpack_url",
    });
  });

  it("treats plain public paths as internal", () => {
    expect(prepareEditModeHref("/en/interactive-exercise/foo")).toEqual({
      kind: "internal",
      href: "/en/interactive-exercise/foo",
    });
  });

  it("ignores hash and mailto", () => {
    expect(prepareEditModeHref("#pricing")).toEqual({
      kind: "ignore",
      href: "#pricing",
    });
    expect(prepareEditModeHref("mailto:hi@example.com")).toEqual({
      kind: "ignore",
      href: "mailto:hi@example.com",
    });
  });

  it("leaves already-absolute http alone as external", () => {
    expect(prepareEditModeHref("https://example.com/x")).toEqual({
      kind: "external",
      href: "https://example.com/x",
    });
  });

  it("unwraps inline templates inside a longer absolute URL", () => {
    expect(
      prepareEditModeHref(
        "https://example.com/pay?cohort={{ global.c | 1713 }}",
      ),
    ).toEqual({
      kind: "external",
      href: "https://example.com/pay?cohort=1713",
    });
  });
});

describe("extractTemplateVariableName", () => {
  it("reads the name from a preserved template", () => {
    expect(
      extractTemplateVariableName(
        "{{ entry.learnpack_url | https://x.example }}",
      ),
    ).toBe("entry.learnpack_url");
  });
});
