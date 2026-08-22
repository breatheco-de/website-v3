import { describe, expect, it } from "vitest";
import { matchesPage, pathnameMatchesEntry } from "./useOverlays";

describe("pathnameMatchesEntry", () => {
  it("matches exact path and prefix", () => {
    expect(pathnameMatchesEntry("/us/courses", "/us/courses")).toBe(true);
    expect(pathnameMatchesEntry("/us/courses/foo", "/us/courses")).toBe(true);
    expect(pathnameMatchesEntry("/us/other", "/us/courses")).toBe(false);
  });

  it("treats / as homepage only", () => {
    expect(pathnameMatchesEntry("/", "/")).toBe(true);
    expect(pathnameMatchesEntry("/us", "/")).toBe(false);
  });

  it("supports regex-style entries", () => {
    expect(pathnameMatchesEntry("/us/blog/hello", ".*/blog/.*")).toBe(true);
    expect(pathnameMatchesEntry("/us/courses", ".*/blog/.*")).toBe(false);
  });
});

describe("matchesPage", () => {
  it("includes all pages when pages is \"all\"", () => {
    expect(matchesPage({ pages: "all" }, "/us/courses")).toBe(true);
  });

  it("treats empty include + excludes as all pages minus exclusions", () => {
    const targeting = {
      pages: [] as string[],
      exclude_pages: [".*/blog/.*", ".*/landing/.*"],
    };
    expect(matchesPage(targeting, "/us/courses")).toBe(true);
    expect(matchesPage(targeting, "/us/blog/post")).toBe(false);
    expect(matchesPage(targeting, "/es/landing/foo")).toBe(false);
  });

  it("does not match when include is empty and there are no excludes", () => {
    expect(matchesPage({ pages: [] }, "/us/courses")).toBe(false);
  });

  it("requires a matching include when includes are listed", () => {
    const targeting = {
      pages: ["/us/courses"],
      exclude_pages: [".*/blog/.*"],
    };
    expect(matchesPage(targeting, "/us/courses")).toBe(true);
    expect(matchesPage(targeting, "/us/other")).toBe(false);
  });

  it("applies excludes over includes", () => {
    const targeting = {
      pages: "all" as const,
      exclude_pages: [".*/how-to/.*"],
    };
    expect(matchesPage(targeting, "/us/how-to/setup")).toBe(false);
    expect(matchesPage(targeting, "/us/home")).toBe(true);
  });
});
