import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import { commonKeysInLocale, isOrphanVersioning, localeKeysInCommon } from "./draft-integrity";
import { planFieldScopeFix } from "../fixers/draft-integrity";
import type { ScannedEntry } from "../shared/draft-scan";

let dir: string;

function write(name: string, data: unknown): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, yaml.dump(data));
  return p;
}

function entry(partial: Partial<ScannedEntry>): ScannedEntry {
  return { contentType: "blog", slug: "hello", dir, commonPath: null, versioningPath: null, live: [], variants: [], ...partial };
}

describe("draft-integrity", () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "draft-integrity-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("orphan versioning: empty lists or only missing files", () => {
    const empty = write("versioning.yml", { es: { variants: [] } });
    expect(isOrphanVersioning(entry({ versioningPath: empty }))).toBe(true);
    write("versioning.yml", { es: { variants: [{ slug: "draft", allocation: 0 }] } });
    expect(isOrphanVersioning(entry({ versioningPath: empty }))).toBe(true);
    const draft = write("draft.es.yml", { title: "x" });
    expect(
      isOrphanVersioning(entry({ versioningPath: empty, variants: [{ variant: "draft", locale: "es", filePath: draft }] })),
    ).toBe(false);
  });

  it("only listed per-language keys count as misplaced in _common.yml", () => {
    expect(localeKeysInCommon({ slug: "x", title: "T", city: "Miami", funnel: {} })).toEqual(["title"]);
    expect(localeKeysInCommon({ slug: "x", meta: { robots: "noindex", og_type: "article" } })).toEqual(["meta.robots"]);
    expect(commonKeysInLocale({ title: "T", funnel: { stage: "a" }, meta: { robots: "noindex", page_title: "P" } })).toEqual([
      "funnel",
    ]);
  });

  it("field-scope fix plan keeps what each language shows", () => {
    const commonPath = write("_common.yml", { slug: "hello", status: "published", meta: { robots: "noindex" } });
    const es = write("es.yml", { title: "Hola", authors: ["a"] });
    const en = write("en.yml", { title: "Hi", status: "draft", authors: ["a"], meta: { robots: "index" } });
    const draft = write("draft.es.yml", { title: "Hola 2" });
    const plan = planFieldScopeFix(
      entry({
        commonPath,
        live: [
          { locale: "es", filePath: es },
          { locale: "en", filePath: en },
        ],
        variants: [{ variant: "draft", locale: "es", filePath: draft }],
      }),
    );
    expect(plan.moved_to_locales).toEqual(["status", "meta.robots"]);
    expect(plan.moved_to_common).toEqual(["authors"]);
    expect(plan.writes.get(commonPath)).toEqual({ slug: "hello", authors: ["a"] });
    expect(plan.writes.get(es)).toEqual({ title: "Hola", status: "published", meta: { robots: "noindex" } });
    expect(plan.writes.get(en)).toEqual({ title: "Hi", status: "draft", meta: { robots: "index" } });
    expect(plan.writes.get(draft)).toEqual({ title: "Hola 2", status: "published", meta: { robots: "noindex" } });
  });

  it("leaves differing page-wide values for a person", () => {
    const commonPath = write("_common.yml", { slug: "hello" });
    const es = write("es.yml", { authors: ["a"] });
    const en = write("en.yml", { authors: ["b"] });
    const plan = planFieldScopeFix(
      entry({
        commonPath,
        live: [
          { locale: "es", filePath: es },
          { locale: "en", filePath: en },
        ],
      }),
    );
    expect(plan.writes.size).toBe(0);
    expect(plan.needs_review).toEqual([{ field: "authors", reason: "languages have different values" }]);
  });
});
