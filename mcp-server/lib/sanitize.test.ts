import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { assertSafeLocale, assertSafeSegment, assertWithinBase } from "./sanitize";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("assertSafeSegment", () => {
  it("accepts alphanumerics, hyphens, and underscores", () => {
    expect(() => assertSafeSegment("remote", "slug")).not.toThrow();
    expect(() => assertSafeSegment("full-stack_v2", "slug")).not.toThrow();
    expect(() => assertSafeSegment("Location123", "contentType")).not.toThrow();
  });

  it("rejects path traversal and special characters", () => {
    expect(() => assertSafeSegment("../etc", "slug")).toThrow(/Invalid slug/);
    expect(() => assertSafeSegment("foo/bar", "slug")).toThrow(/Invalid slug/);
    expect(() => assertSafeSegment("a.b", "slug")).toThrow(/Invalid slug/);
    expect(() => assertSafeSegment("", "slug")).toThrow(/Invalid slug/);
  });
});

describe("assertSafeLocale", () => {
  it("accepts BCP-47-ish codes", () => {
    expect(() => assertSafeLocale("en")).not.toThrow();
    expect(() => assertSafeLocale("es")).not.toThrow();
    expect(() => assertSafeLocale("es-mx")).not.toThrow();
  });

  it("rejects invalid locale shapes", () => {
    expect(() => assertSafeLocale("EN")).toThrow(/Invalid locale/);
    expect(() => assertSafeLocale("english")).toThrow(/Invalid locale/);
    expect(() => assertSafeLocale("en_US")).toThrow(/Invalid locale/);
    expect(() => assertSafeLocale("")).toThrow(/Invalid locale/);
  });
});

describe("assertWithinBase", () => {
  it("allows paths inside the base", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-sanitize-"));
    tmpDirs.push(base);
    const child = path.join(base, "pages", "home", "en.yml");
    expect(() => assertWithinBase(child, base)).not.toThrow();
    expect(() => assertWithinBase(base, base)).not.toThrow();
  });

  it("rejects paths outside the base", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-sanitize-"));
    tmpDirs.push(base);
    expect(() => assertWithinBase(path.join(base, "..", "escape"), base)).toThrow(
      /Path traversal detected/,
    );
    expect(() => assertWithinBase("/etc/passwd", base)).toThrow(/Path traversal detected/);
  });
});
