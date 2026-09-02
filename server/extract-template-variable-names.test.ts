import { describe, expect, it } from "vitest";
import { extractTemplateVariableNames } from "./content-index";

describe("extractTemplateVariableNames", () => {
  it("captures dotted global and brand namespaces", () => {
    const raw = `
title: "{{ global.campus_phone }}"
logo: "{{ brand.logo }}"
mixed: Hello {{ global.global_total_alumni | 0 }} alumni
`;
    expect(extractTemplateVariableNames(raw)).toEqual([
      "global.campus_phone",
      "brand.logo",
      "global.global_total_alumni",
    ]);
  });

  it("still captures bare names and entry/meta/param", () => {
    const raw = `{{ entry.title }} {{ meta.page_title }} {{ param.category }} {{ plain }}`;
    expect(extractTemplateVariableNames(raw)).toEqual([
      "entry.title",
      "meta.page_title",
      "param.category",
      "plain",
    ]);
  });

  it("ignores non-template text", () => {
    expect(extractTemplateVariableNames("no templates here")).toEqual([]);
  });
});
