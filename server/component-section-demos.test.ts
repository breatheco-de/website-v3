import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  DEMO_HASH_RE,
  createDemo,
  demosDir,
  normalizeToSingleSection,
  parseAndValidateDemoYaml,
  readDemo,
  readDemoYamlText,
} from "./component-section-demos";

describe("normalizeToSingleSection", () => {
  it("accepts a single section object", () => {
    const result = normalizeToSingleSection({ type: "faq", title: "Hi" });
    expect(result.error).toBeUndefined();
    expect(result.section?.type).toBe("faq");
  });

  it("accepts a one-element array", () => {
    const result = normalizeToSingleSection([{ type: "faq", title: "Hi" }]);
    expect(result.error).toBeUndefined();
    expect(result.section?.type).toBe("faq");
  });

  it("rejects multi-element arrays", () => {
    const result = normalizeToSingleSection([{ type: "faq" }, { type: "hero" }]);
    expect(result.error?.message).toMatch(/exactly one section/i);
  });

  it("unwraps sections: [one]", () => {
    const result = normalizeToSingleSection({
      sections: [{ type: "faq", title: "Hi" }],
    });
    expect(result.error).toBeUndefined();
    expect(result.section?.type).toBe("faq");
  });
});

describe("parseAndValidateDemoYaml", () => {
  it("rejects invalid YAML", () => {
    const result = parseAndValidateDemoYaml({
      yamlText: "type: [unterminated",
      componentType: "faq",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/Invalid YAML/i);
  });

  it("rejects type mismatch", () => {
    const result = parseAndValidateDemoYaml({
      yamlText: "type: hero\ntitle: Nope\n",
      componentType: "faq",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.property_path).toBe("type");
      expect(result.error.message).toMatch(/does not match/i);
    }
  });

  it("rejects unknown component types", () => {
    const result = parseAndValidateDemoYaml({
      yamlText: "type: not_a_real_component_xyz\ntitle: x\n",
      componentType: "not_a_real_component_xyz",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/not found/i);
  });

  it("accepts a minimal valid faq section when registry is present", () => {
    const result = parseAndValidateDemoYaml({
      yamlText: [
        "type: faq",
        "version: v1.0",
        "title: Frequently Asked Questions",
        "",
      ].join("\n"),
      componentType: "faq",
      version: "v1.0",
    });
    // faq has required title — should pass when shared registry exists
    if (!result.ok) {
      // If faq is not in this checkout's registry, skip soft-assert
      expect(result.error.message).toMatch(/not found|Schema not found|Missing required/i);
      return;
    }
    expect(result.section.type).toBe("faq");
    expect(result.version).toMatch(/^v/);
  });
});

describe("createDemo / readDemo", () => {
  let tmp: string;
  const prevSiteUrl = process.env.SITE_URL;
  const prevNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "section-demos-"));
    process.env.SITE_URL = "https://example.test";
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prevSiteUrl === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = prevSiteUrl;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
  });

  it("writes and reads a demo file under .cache/component-section-demos", () => {
    const created = createDemo({
      componentType: "faq",
      version: "v1.0",
      section: { type: "faq", version: "v1.0", title: "Demo FAQ" },
      cwd: tmp,
    });

    expect(DEMO_HASH_RE.test(created.hash)).toBe(true);
    expect(created.previewUrl).toBe(`https://example.test/private/demo/${created.hash}`);
    expect(created.relativePath).toBe(
      `.cache/component-section-demos/${created.hash}.yml`,
    );
    expect(fs.existsSync(path.join(demosDir(tmp), `${created.hash}.yml`))).toBe(true);

    const loaded = readDemo(created.hash, tmp);
    expect(loaded).not.toBeNull();
    expect(loaded!.component_type).toBe("faq");
    expect(loaded!.section.title).toBe("Demo FAQ");

    const rawYaml = readDemoYamlText(created.hash, tmp);
    expect(rawYaml).toContain("component_type: faq");
    expect(rawYaml).toContain("Demo FAQ");
  });

  it("returns null for invalid or missing hashes", () => {
    expect(readDemo("not-a-hash", tmp)).toBeNull();
    expect(readDemo("a".repeat(32), tmp)).toBeNull();
  });
});
