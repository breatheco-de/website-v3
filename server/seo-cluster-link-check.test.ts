import { describe, expect, it } from "vitest";
import {
  checkHubLoad,
  checkHubOutboundLinks,
  checkMemberBackLink,
  countBodyWords,
  HUB_MISSING_MEMBER_LINKS,
  HUB_OVERLOADED,
  HUB_THIN_LINK_DENSE,
  MEMBER_MISSING_HUB_LINK,
} from "./seo-cluster-link-check";
import type { SeoIndex } from "./seo-index";

const stubCi = {
  getRedirects: () => [],
  refreshCustomRedirects: () => [],
  isKnownUrl: () => true,
  findBySlug: () => [],
} as unknown as import("./content-index").ContentIndex;

function indexWithHub(): SeoIndex {
  return {
    version: 1,
    entries: {
      "blog/hub/en": {
        content_type: "blog",
        slug: "hub",
        locale: "en",
        path: "/en/hub",
        is_pillar: true,
        file: "blog/hub/en.yml",
      },
      "blog/spoke/en": {
        content_type: "blog",
        slug: "spoke",
        locale: "en",
        path: "/en/spoke",
        pillar_path: "/en/hub",
        file: "blog/spoke/en.yml",
      },
    },
    by_path: { "/en/hub": "blog/hub/en" },
    clusters: {
      "blog/hub/en": { path: "/en/hub", members: ["blog/spoke/en"] },
    },
    orphans: [],
    warnings: [],
  };
}

describe("seo-cluster-link-check", () => {
  it("flags hub missing member link", () => {
    const issue = checkHubOutboundLinks({
      hubId: "blog/hub/en",
      hubPath: "/en/hub",
      hubLocale: "en",
      pageData: { content: "no links" },
      index: indexWithHub(),
      ci: stubCi,
    });
    expect(issue?.code).toBe(HUB_MISSING_MEMBER_LINKS);
  });

  it("passes when hub links to member", () => {
    const issue = checkHubOutboundLinks({
      hubId: "blog/hub/en",
      hubPath: "/en/hub",
      hubLocale: "en",
      pageData: { content: "See [spoke](/en/spoke)" },
      index: indexWithHub(),
      ci: stubCi,
    });
    expect(issue).toBeNull();
  });

  it("flags member missing hub back-link", () => {
    const issue = checkMemberBackLink({
      memberLocale: "en",
      pillarPath: "/en/hub",
      pageData: { content: "orphan" },
      ci: stubCi,
    });
    expect(issue?.code).toBe(MEMBER_MISSING_HUB_LINK);
  });
});

describe("checkHubLoad", () => {
  const links = (n: number) =>
    Array.from({ length: n }, (_, i) => `[page ${i}](/en/blog/spoke-${i})`).join(" ");
  const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");

  it("counts reader words, not SEO/meta or link targets", () => {
    expect(
      countBodyWords({
        content: "<p>Three plain words</p> and [a link](/en/x)",
        seo: { main_keyword: "should not count at all here" },
        meta: { description: "should not count either for this" },
      }),
    ).toBe(6);
  });

  it("flags a small hub that reads like a link list (expand, do not split)", () => {
    const issue = checkHubLoad({ pageData: { content: `${words(40)} ${links(8)}` }, memberCount: 8 });
    expect(issue?.code).toBe(HUB_THIN_LINK_DENSE);
    expect(issue?.links).toBe(8);
  });

  it("passes a written-out hub of the same size", () => {
    expect(checkHubLoad({ pageData: { content: `${words(800)} ${links(8)}` }, memberCount: 8 })).toBeNull();
  });

  it("flags many members as overloaded and names open split ideas", () => {
    const issue = checkHubLoad({
      pageData: { content: `${words(4000)} ${links(30)}` },
      memberCount: 30,
      openSplits: [{ id: "idea-1", title: "Salaries hub", members: ["blog/salary-mx"] }],
    });
    expect(issue?.code).toBe(HUB_OVERLOADED);
    expect(issue?.message).toContain("idea-1");
  });

  it("thresholds come from seo-config hub_load", () => {
    const thresholds = { thin_links_per_100_words: 3, thin_max_members: 15, overloaded_min_members: 10 };
    expect(checkHubLoad({ pageData: { content: words(2000) }, memberCount: 12, thresholds })?.code).toBe(HUB_OVERLOADED);
  });
});
