import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { CorruptedTemplateValueError, findCorruptedTemplateKeys } from "@shared/templateVars";
import { dumpContentYaml, loadContentYaml, loadContentYamlObject } from "./content-yaml";

const UNQUOTED = `sections:
  - type: article
    updated_at: {{ entry.updated_at }}
    title: {{ entry.title | blog title }}
`;

describe("content-yaml", () => {
  it("plain js-yaml destroys an unquoted placeholder (the trap this module avoids)", () => {
    const parsed = yaml.load(UNQUOTED) as { sections: Array<Record<string, unknown>> };
    expect(parsed.sections[0].updated_at).toEqual({ "[object Object]": null });
  });

  it("keeps unquoted placeholders as strings on load", () => {
    const parsed = loadContentYamlObject(UNQUOTED) as { sections: Array<Record<string, unknown>> };
    expect(parsed.sections[0].updated_at).toBe("{{ entry.updated_at }}");
    expect(parsed.sections[0].title).toBe("{{ entry.title | blog title }}");
  });

  it("round-trips placeholders through load and dump", () => {
    const out = dumpContentYaml(loadContentYaml(UNQUOTED), { lineWidth: -1, noRefs: true });
    expect(out).toContain("updated_at: {{ entry.updated_at }}");
    expect(loadContentYamlObject(out)).toEqual(loadContentYamlObject(UNQUOTED));
  });

  it("blocks the dump when a placeholder was already destroyed", () => {
    const corrupted = yaml.load(UNQUOTED);
    let thrown: unknown;
    try {
      dumpContentYaml(corrupted, undefined, "blog/post/en.yml");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CorruptedTemplateValueError);
    const err = thrown as CorruptedTemplateValueError;
    expect(err.code).toBe("corrupted_template_value");
    expect(err.paths).toEqual(["sections.0.updated_at", "sections.0.title"]);
    expect(err.message).toContain("blog/post/en.yml");
    expect(err.message).toContain("Nothing was written");
  });

  it("finds corrupted keys at nested and root paths", () => {
    expect(findCorruptedTemplateKeys({ a: [{ b: { "[object Object]": null } }] })).toEqual(["a.0.b"]);
    expect(findCorruptedTemplateKeys({ "[object Object]": null })).toEqual(["(root)"]);
    expect(findCorruptedTemplateKeys({ a: "{{ entry.x }}", b: [1, null] })).toEqual([]);
  });
});
