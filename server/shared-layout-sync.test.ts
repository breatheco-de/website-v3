import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import {
  sectionIsTemplateExpressionsOnly,
  prepareSiblingMirroredSection,
  assignSectionLabel,
  HIDDEN_LOCATION_SENTINEL,
  isHiddenViaSentinel,
  reorderSectionsByIds,
  removeSectionById,
  isAllowlistedSectionFieldPath,
  applyAllowlistedLayout,
  stripSectionLabels,
  MIRRORED_SECTION_NEEDS_EDIT_NOTE,
  cleanSectionIdFromEntryOverlays,
  fanOutStructuralOpsToSiblings,
} from "./shared-layout-sync";

function safeYamlLoad(raw: string): Record<string, unknown> | null {
  try {
    const parsed = yaml.load(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function dumpYaml(data: unknown): string {
  return yaml.dump(data, { lineWidth: -1, noRefs: true });
}

describe("shared-layout-sync", () => {
  it("detects template-expression-only sections", () => {
    expect(
      sectionIsTemplateExpressionsOnly({
        type: "hero",
        version: "1.0",
        section_id: "hero-1",
        title: "{{ entry.title }}",
        subtitle: "{{ entry.description | x }}",
      }),
    ).toBe(true);

    expect(
      sectionIsTemplateExpressionsOnly({
        type: "hero",
        section_id: "hero-1",
        title: "Hardcoded English",
      }),
    ).toBe(false);
  });

  it("mirrors new sections with label + hide when content needs locale work", () => {
    const source = {
      type: "cta",
      section_id: "cta-1",
      title: "Join now",
      paddingY: { desktop: "sm" },
    };
    const mirrored = prepareSiblingMirroredSection(source, "jane.doe");
    expect(mirrored.section_id).toBe("cta-1");
    expect(mirrored.title).toBe("Join now");
    expect((mirrored._label as { needs: string }).needs).toBe("edit");
    expect((mirrored._label as { requester: string }).requester).toBe("jane.doe");
    expect((mirrored._label as { note: string }).note).toBe(MIRRORED_SECTION_NEEDS_EDIT_NOTE);
    expect(isHiddenViaSentinel(mirrored)).toBe(true);
    expect(mirrored.showOnLocations).toEqual([HIDDEN_LOCATION_SENTINEL]);
  });

  it("skips label+hide when section is only template expressions", () => {
    const source = {
      type: "hero",
      section_id: "hero-1",
      title: "{{ entry.title }}",
    };
    const mirrored = prepareSiblingMirroredSection(source, "jane.doe");
    expect(mirrored._label).toBeUndefined();
    expect(isHiddenViaSentinel(mirrored)).toBe(false);
  });

  it("allowlists layout field paths but not content props", () => {
    expect(isAllowlistedSectionFieldPath("showOn")).toBe(true);
    expect(isAllowlistedSectionFieldPath("paddingY.desktop")).toBe(true);
    expect(isAllowlistedSectionFieldPath("title")).toBe(false);
    expect(isAllowlistedSectionFieldPath("cta.text")).toBe(false);
  });

  it("applies allowlisted layout without copying type/variant", () => {
    const target: Record<string, unknown> = {
      type: "hero",
      variant: "old",
      section_id: "h1",
      title: "ES title",
    };
    applyAllowlistedLayout(target, {
      type: "hero",
      variant: "new",
      section_id: "h1",
      showOn: "desktop",
      title: "EN title",
    });
    expect(target.variant).toBe("old");
    expect(target.title).toBe("ES title");
    expect(target.showOn).toBe("desktop");
  });

  it("reorders by section ids preserving content", () => {
    const sections = [
      { section_id: "a", title: "A" },
      { section_id: "b", title: "B" },
      { section_id: "c", title: "C" },
    ];
    const reordered = reorderSectionsByIds(sections, ["c", "a", "b"]);
    expect(reordered.map((s) => s.section_id)).toEqual(["c", "a", "b"]);
    expect(reordered[0].title).toBe("C");
  });

  it("removes by section id", () => {
    const { sections, removed } = removeSectionById(
      [{ section_id: "a" }, { section_id: "b" }],
      "a",
    );
    expect(removed).toBe(true);
    expect(sections).toHaveLength(1);
    expect(sections[0].section_id).toBe("b");
  });

  it("strips _label from nested data", () => {
    const stripped = stripSectionLabels({
      sections: [{ type: "hero", _label: { needs: "edit", note: "x" }, title: "x" }],
    });
    expect((stripped.sections as Record<string, unknown>[])[0]._label).toBeUndefined();
    expect((stripped.sections as Record<string, unknown>[])[0].title).toBe("x");
  });

  it("requires a non-empty note when assigning _label", () => {
    const section: Record<string, unknown> = { type: "hero" };
    expect(() =>
      assignSectionLabel(section, { needs: "edit", note: "   " }),
    ).toThrow(/note/);
    assignSectionLabel(section, { needs: "edit", note: "Translate this CTA" });
    expect((section._label as { note: string }).note).toBe("Translate this CTA");
    expect((section._label as { requester: string }).requester).toBe("system");
  });

  it("stores staff id requester and optional owner", () => {
    const section: Record<string, unknown> = { type: "hero" };
    assignSectionLabel(section, {
      needs: "edit",
      note: "Please translate",
      requester: "alex",
      owner: "maria",
    });
    expect(section._label).toEqual({
      needs: "edit",
      note: "Please translate",
      requester: "alex",
      owner: "maria",
    });
  });

  it("coerces legacy { kind, id } actors to staff ids", () => {
    const section: Record<string, unknown> = { type: "hero" };
    assignSectionLabel(section, {
      needs: "edit",
      note: "Legacy shape",
      requester: { kind: "staff", id: "alex" } as unknown as string,
      owner: { kind: "staff", id: "maria" } as unknown as string,
    });
    expect(section._label).toEqual({
      needs: "edit",
      note: "Legacy shape",
      requester: "alex",
      owner: "maria",
    });
  });

  it("skips detached entries when cleaning deleted section ids from overlays", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shared-layout-clean-"));
    try {
      const attachedDir = path.join(root, "attached-post");
      const detachedDir = path.join(root, "detached-post");
      fs.mkdirSync(attachedDir);
      fs.mkdirSync(detachedDir);

      const sectionPayload = {
        sections: [
          { type: "hero", section_id: "hero-shared", title: "Keep" },
          { type: "article", section_id: "article-gone", content: "Body" },
        ],
      };

      fs.writeFileSync(path.join(attachedDir, "_common.yml"), "slug: attached-post\n");
      fs.writeFileSync(path.join(attachedDir, "en.yml"), dumpYaml(sectionPayload));

      fs.writeFileSync(path.join(detachedDir, "_common.yml"), "slug: detached-post\ndetached: true\n");
      fs.writeFileSync(path.join(detachedDir, "en.yml"), dumpYaml(sectionPayload));

      const written: string[] = [];
      cleanSectionIdFromEntryOverlays(
        root,
        ["article-gone"],
        safeYamlLoad,
        dumpYaml,
        (p) => written.push(p),
      );

      const attachedAfter = safeYamlLoad(fs.readFileSync(path.join(attachedDir, "en.yml"), "utf-8"));
      const detachedAfter = safeYamlLoad(fs.readFileSync(path.join(detachedDir, "en.yml"), "utf-8"));

      expect((attachedAfter?.sections as Record<string, unknown>[]).map((s) => s.section_id)).toEqual([
        "hero-shared",
      ]);
      expect((detachedAfter?.sections as Record<string, unknown>[]).map((s) => s.section_id)).toEqual([
        "hero-shared",
        "article-gone",
      ]);
      expect(written.some((p) => p.includes("detached-post"))).toBe(false);
      expect(written.some((p) => p.includes("attached-post"))).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fan-out does not rewrite sibling when dump is unchanged", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shared-layout-fanout-"));
    try {
      const en = path.join(root, "single.en.yml");
      const es = path.join(root, "single.es.yml");
      const sections = [
        {
          type: "hero",
          section_id: "hero-1",
          title: "{{ entry.title }}",
          paddingY: { desktop: "sm" },
        },
      ];
      const doc = { meta: { page_title: "{{ entry.title }}" }, sections };
      const body = dumpYaml(doc);
      const normalized = body.endsWith("\n") ? body : `${body}\n`;
      fs.writeFileSync(en, normalized);
      fs.writeFileSync(es, normalized);
      const beforeMtime = fs.statSync(es).mtimeMs;
      const written: string[] = [];

      const result = fanOutStructuralOpsToSiblings({
        templateDir: root,
        sourceLocale: "en",
        sourceSections: sections,
        operations: [
          {
            action: "update_section",
            index: 0,
            section: sections[0],
          },
        ],
        safeYamlLoad,
        dumpYaml,
        onSiblingWritten: (p) => written.push(p),
      });

      expect(result.failed).toEqual([]);
      expect(written).toEqual([]);
      expect(fs.statSync(es).mtimeMs).toBe(beforeMtime);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
