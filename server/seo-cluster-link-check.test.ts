import { describe, expect, it } from "vitest";
import {
  checkHubOutboundLinks,
  checkMemberBackLink,
  HUB_MISSING_MEMBER_LINKS,
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
