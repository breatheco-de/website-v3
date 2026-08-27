import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import {
  enableSharedLayoutFromEntry,
  hasUsableSharedTemplate,
  isEnablingSharedLayout,
  sectionIsEntryBagExpressionsOnly,
  summarizeTemplateLocales,
} from "./shared-layout-enable";

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

describe("shared-layout-enable", () => {
  let root: string;
  let typeDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "shared-layout-enable-"));
    // content-types minimal via getFolder defaulting to contentType name
    typeDir = path.join(root, "posts");
    fs.mkdirSync(typeDir, { recursive: true });
    fs.writeFileSync(
      path.join(root, "content-types.yml"),
      "posts:\n  directory: posts\n  url_pattern:\n    en: /en/:slug\n",
      "utf-8",
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("detects usable template only when sections are non-empty", () => {
    fs.writeFileSync(
      path.join(typeDir, "template.en.yml"),
      "meta:\n  page_title: x\nsections: []\n",
      "utf-8",
    );
    expect(hasUsableSharedTemplate(typeDir, safeYamlLoad)).toBe(false);

    fs.writeFileSync(
      path.join(typeDir, "template.en.yml"),
      [
        "sections:",
        "  - type: hero",
        "    version: '1.0'",
        "    section_id: hero-1",
        "    title: '{{ entry.title }}'",
        "",
      ].join("\n"),
      "utf-8",
    );
    expect(hasUsableSharedTemplate(typeDir, safeYamlLoad)).toBe(true);
  });

  it("dual-reads legacy single.* as usable", () => {
    fs.writeFileSync(
      path.join(typeDir, "single.en.yml"),
      [
        "sections:",
        "  - type: hero",
        "    section_id: h1",
        "    title: '{{ entry.title }}'",
        "",
      ].join("\n"),
      "utf-8",
    );
    expect(hasUsableSharedTemplate(typeDir, safeYamlLoad)).toBe(true);
    const summary = summarizeTemplateLocales(typeDir, safeYamlLoad);
    expect(summary[0].naming).toBe("single");
  });

  it("sectionIsEntryBagExpressionsOnly rejects hardcoded props", () => {
    expect(
      sectionIsEntryBagExpressionsOnly({
        type: "hero",
        section_id: "h1",
        title: "{{ entry.title }}",
      }),
    ).toBe(true);
    expect(
      sectionIsEntryBagExpressionsOnly({
        type: "hero",
        section_id: "h1",
        title: "Hardcoded",
      }),
    ).toBe(false);
    expect(
      sectionIsEntryBagExpressionsOnly({
        type: "hero",
        section_id: "h1",
        title: "{{ meta.page_title }}",
      }),
    ).toBe(false);
  });

  it("isEnablingSharedLayout only on new enable", () => {
    expect(
      isEnablingSharedLayout({
        priorSingleTemplate: false,
        bodySingleTemplate: true,
        linkingDatabaseEnablesShared: false,
      }),
    ).toBe(true);
    expect(
      isEnablingSharedLayout({
        priorSingleTemplate: true,
        bodySingleTemplate: true,
        linkingDatabaseEnablesShared: true,
      }),
    ).toBe(false);
    expect(
      isEnablingSharedLayout({
        priorSingleTemplate: false,
        linkingDatabaseEnablesShared: true,
      }),
    ).toBe(true);
  });

  it("requires template_mode when enabling", () => {
    const result = enableSharedLayoutFromEntry({
      contentType: "posts",
      contentRoot: root,
      safeYamlLoad,
      dumpYaml,
      getAvailableLocales: () => ["en"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("template_mode_required");
  });

  it("rejects keep_existing without usable template", () => {
    const result = enableSharedLayoutFromEntry({
      contentType: "posts",
      contentRoot: root,
      templateMode: "keep_existing",
      safeYamlLoad,
      dumpYaml,
      getAvailableLocales: () => ["en"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("no_usable_template");
  });

  it("from_entry requires locale when entry has multiple locales", () => {
    const entryDir = path.join(typeDir, "hello");
    fs.mkdirSync(entryDir);
    const section = [
      "sections:",
      "  - type: hero",
      "    version: '1.0'",
      "    section_id: hero-1",
      "    title: '{{ entry.title }}'",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(entryDir, "en.yml"), section, "utf-8");
    fs.writeFileSync(path.join(entryDir, "es.yml"), section, "utf-8");

    const result = enableSharedLayoutFromEntry({
      contentType: "posts",
      contentRoot: root,
      templateMode: "from_entry",
      templateEntrySourceSlug: "hello",
      safeYamlLoad,
      dumpYaml,
      getAvailableLocales: () => ["en", "es"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("template_entry_source_locale_required");
      expect(result.locales).toEqual(["en", "es"]);
    }
  });

  it("from_entry writes template.en.yml and rewrites legacy single.* vars", () => {
    const entryDir = path.join(typeDir, "hello");
    fs.mkdirSync(entryDir);
    fs.writeFileSync(
      path.join(entryDir, "en.yml"),
      [
        "sections:",
        "  - type: hero",
        "    version: '1.0'",
        "    section_id: hero-1",
        "    title: '{{ single.title }}'",
        "",
      ].join("\n"),
      "utf-8",
    );

    const result = enableSharedLayoutFromEntry({
      contentType: "posts",
      contentRoot: root,
      templateMode: "from_entry",
      templateEntrySourceSlug: "hello",
      safeYamlLoad,
      dumpYaml,
      getAvailableLocales: () => ["en"],
    });
    expect(result.ok).toBe(true);
    const written = path.join(typeDir, "template.en.yml");
    expect(fs.existsSync(written)).toBe(true);
    const raw = fs.readFileSync(written, "utf-8");
    expect(raw).toContain("{{ entry.title }}");
    expect(raw).not.toContain("{{ single.title }}");
    expect(fs.existsSync(path.join(typeDir, "single.en.yml"))).toBe(false);
  });

  it("from_entry overwrite requires confirm when usable template exists", () => {
    fs.writeFileSync(
      path.join(typeDir, "template.en.yml"),
      [
        "sections:",
        "  - type: hero",
        "    section_id: old",
        "    title: '{{ entry.title }}'",
        "",
      ].join("\n"),
      "utf-8",
    );
    const entryDir = path.join(typeDir, "hello");
    fs.mkdirSync(entryDir);
    fs.writeFileSync(
      path.join(entryDir, "en.yml"),
      [
        "sections:",
        "  - type: cta",
        "    section_id: new",
        "    title: '{{ entry.title }}'",
        "",
      ].join("\n"),
      "utf-8",
    );

    const preview = enableSharedLayoutFromEntry({
      contentType: "posts",
      contentRoot: root,
      templateMode: "from_entry",
      templateEntrySourceSlug: "hello",
      safeYamlLoad,
      dumpYaml,
      getAvailableLocales: () => ["en"],
    });
    expect(preview.ok).toBe(false);
    if (!preview.ok) {
      expect(preview.code).toBe("confirm_template_replace");
      expect(preview.preview?.proposed.sectionIds).toContain("new");
    }

    const done = enableSharedLayoutFromEntry({
      contentType: "posts",
      contentRoot: root,
      templateMode: "from_entry",
      templateEntrySourceSlug: "hello",
      confirm: true,
      safeYamlLoad,
      dumpYaml,
      getAvailableLocales: () => ["en"],
    });
    expect(done.ok).toBe(true);
    const raw = fs.readFileSync(path.join(typeDir, "template.en.yml"), "utf-8");
    expect(raw).toContain("section_id: new");
  });

  it("rejects non-template-shaped source entry", () => {
    const entryDir = path.join(typeDir, "hello");
    fs.mkdirSync(entryDir);
    fs.writeFileSync(
      path.join(entryDir, "en.yml"),
      [
        "sections:",
        "  - type: hero",
        "    section_id: hero-1",
        "    title: Hardcoded English",
        "",
      ].join("\n"),
      "utf-8",
    );
    const result = enableSharedLayoutFromEntry({
      contentType: "posts",
      contentRoot: root,
      templateMode: "from_entry",
      templateEntrySourceSlug: "hello",
      safeYamlLoad,
      dumpYaml,
      getAvailableLocales: () => ["en"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("template_entry_not_template_shaped");
  });
});
