import { describe, expect, it } from "vitest";
import {
  extractHrefPaths,
  findMissingMemberLinks,
  pageLinksToHub,
  collectInternalPathsFromData,
} from "./cluster-hub-links";

const stubCi = {
  getRedirects: () => [],
  refreshCustomRedirects: () => [],
  isKnownUrl: () => true,
  findBySlug: () => [],
} as unknown as import("./content-index").ContentIndex;

describe("cluster-hub-links", () => {
  it("extractHrefPaths collects anchor hrefs", () => {
    const html = `<nav><a href="/us/blog/a">A</a></nav><a href="https://4geeks.com/us/blog/b">B</a>`;
    expect(extractHrefPaths(html)).toEqual(["/us/blog/a", "https://4geeks.com/us/blog/b"]);
  });

  it("findMissingMemberLinks flags members not linked from hub html", () => {
    const html = `<a href="/us/blog/linked">Linked</a>`;
    const missing = findMissingMemberLinks({
      html,
      members: [
        {
          memberId: "blog/linked/en",
          memberSlug: "linked",
          memberPath: "/us/blog/linked",
          locale: "en",
        },
        {
          memberId: "blog/missing/en",
          memberSlug: "missing",
          memberPath: "/us/blog/missing",
          locale: "en",
        },
      ],
      ci: stubCi,
    });
    expect(missing).toHaveLength(1);
    expect(missing[0]?.memberSlug).toBe("missing");
  });

  it("pageLinksToHub detects markdown and url fields", () => {
    expect(
      pageLinksToHub({
        sourcePaths: collectInternalPathsFromData({
          content: "See [hub](/en/guides/coding)",
          cta: { url: "/other" },
        }),
        hubPath: "/en/guides/coding",
        locale: "en",
        ci: stubCi,
      }),
    ).toBe(true);
    expect(
      pageLinksToHub({
        sourcePaths: collectInternalPathsFromData({ content: "no link" }),
        hubPath: "/en/guides/coding",
        locale: "en",
        ci: stubCi,
      }),
    ).toBe(false);
  });

  it("collectInternalPathsFromData extracts HTML anchor hrefs from content", () => {
    const paths = collectInternalPathsFromData({
      content: '<a href="https://4geeks.com/es/blog/hub">Hub</a>',
    });
    expect(paths).toContain("/es/blog/hub");
  });

  it("pageLinksToHub detects HTML-only blog body links", () => {
    expect(
      pageLinksToHub({
        sourcePaths: collectInternalPathsFromData({
          content: '<p>Read <a href="/es/blog/herramientas-ia/que-es-grok-bot">hub</a></p>',
        }),
        hubPath: "/es/blog/herramientas-ia/que-es-grok-bot",
        locale: "es",
        ci: stubCi,
      }),
    ).toBe(true);
  });
});
