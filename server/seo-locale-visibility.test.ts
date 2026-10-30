import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildLocaleVisibility } from "./seo-locale-visibility";

let dir: string;

function write(rel: string, content: string) {
  fs.writeFileSync(path.join(dir, rel), content, "utf-8");
}

const ci = {
  loadCommonData: () => {
    const p = path.join(dir, "_common.yml");
    return fs.existsSync(p) ? yaml.load(fs.readFileSync(p, "utf-8")) : null;
  },
  loadLocaleData: (_t: string, _s: string, locale: string) => {
    const p = path.join(dir, `${locale}.yml`);
    return fs.existsSync(p) ? { data: yaml.load(fs.readFileSync(p, "utf-8")) } : { data: null };
  },
};

function build(locale = "en") {
  return buildLocaleVisibility({
    ci,
    contentType: "blog",
    slug: "post-a",
    locale,
    contentDir: dir,
    locales: ["en", "es", "pt"],
  });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "locale-visibility-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("buildLocaleVisibility", () => {
  it("lists other live languages with their effective values", () => {
    write("_common.yml", "meta:\n  robots: noindex\n");
    write("en.yml", "title: EN\n");
    write("es.yml", "title: ES\nmeta:\n  robots: index, follow\n  priority: 0.8\n");
    write("pt.yml", "title: PT\nmeta:\n  change_frequency: weekly\n");
    const res = build();
    expect(res.supported).toBe(true);
    expect(res.current_inherited_robots).toBe("noindex");
    expect(res.locales).toEqual([
      { locale: "es", robots: "index, follow", priority: "0.8", change_frequency: "", inherited_robots: "noindex" },
      { locale: "pt", robots: "noindex", priority: "", change_frequency: "weekly", inherited_robots: "noindex" },
    ]);
  });

  it("skips the current language and languages that are only drafts", () => {
    write("en.yml", "title: EN\n");
    write("draft.es.yml", "title: ES draft\n");
    expect(build().locales).toEqual([]);
    write("es.yml", "title: ES\n");
    expect(build("es").locales.map((r) => r.locale)).toEqual(["en"]);
  });
});
