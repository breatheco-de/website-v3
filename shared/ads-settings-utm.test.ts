import { describe, expect, it } from "vitest";
import {
  DEFAULT_UTM_CONVENTION,
  googleUrlSuffixTemplate,
  metaTemplateSource,
  metaUtmTemplate,
  parseAdsSettings,
  parseUtmConvention,
} from "./ads-settings";

const OLD_META_TEMPLATE =
  "utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_id={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}";
const OLD_GOOGLE_SUFFIX =
  "utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_id={campaignid}&utm_term={adgroupid}&utm_content={creative}";

describe("UTM templates", () => {
  it("defaults reproduce the templates staff already pasted", () => {
    expect(metaUtmTemplate()).toBe(OLD_META_TEMPLATE);
    expect(googleUrlSuffixTemplate()).toBe(OLD_GOOGLE_SUFFIX);
  });

  it("Meta keeps {{site_source_name}} only for a multi-value subset of Meta's placement values", () => {
    expect(metaTemplateSource(DEFAULT_UTM_CONVENTION)).toBe("{{site_source_name}}");
    const single = parseUtmConvention({ sources: { meta: { canonical: ["facebook"] } } }).convention;
    expect(metaTemplateSource(single)).toBe("facebook");
    const pair = parseUtmConvention({ sources: { meta: { canonical: ["fb", "ig"] } } }).convention;
    expect(metaTemplateSource(pair)).toBe("{{site_source_name}}");
    const withFacebook = parseUtmConvention({ sources: { meta: { canonical: ["fb", "ig", "msg", "an", "facebook"] } } }).convention;
    expect(metaTemplateSource(withFacebook)).toBe("{{site_source_name}}");
    const fbAndFacebook = parseUtmConvention({ sources: { meta: { canonical: ["fb", "facebook"] } } }).convention;
    expect(metaTemplateSource(fbAndFacebook)).toBe("fb");
  });

  it("templates follow the configured medium", () => {
    const c = parseUtmConvention({ mediums: { meta: "cpc", google: "ppc" } }).convention;
    expect(metaUtmTemplate(c)).toContain("utm_medium=cpc&");
    expect(googleUrlSuffixTemplate(c)).toContain("utm_medium=ppc&");
  });
});

describe("parseUtmConvention", () => {
  it("missing block → defaults, nothing rejected", () => {
    const { convention, rejected } = parseUtmConvention(undefined);
    expect(convention).toEqual(DEFAULT_UTM_CONVENTION);
    expect(rejected).toEqual([]);
  });

  it("rejects mediums GA4 doesn't count as paid and keeps the default", () => {
    const { convention, rejected } = parseUtmConvention({ mediums: { meta: "social_paid", google: "display" } });
    expect(convention.mediums.meta).toBe("paid_social");
    expect(convention.mediums.google).toBe("display");
    expect(rejected).toEqual([expect.objectContaining({ field: "mediums.meta", value: "social_paid", default_used: "paid_social" })]);
  });

  it("display mediums are only accepted for Google", () => {
    const { convention, rejected } = parseUtmConvention({ mediums: { meta: "display" } });
    expect(convention.mediums.meta).toBe("paid_social");
    expect(rejected[0]?.field).toBe("mediums.meta");
  });

  it("rejects sources outside GA4's lists, falling back when none are left", () => {
    const { convention, rejected } = parseUtmConvention({ sources: { meta: { canonical: ["meta_ads"] }, google: { canonical: ["google", "gads"] } } });
    expect(convention.sources.meta.canonical).toEqual(DEFAULT_UTM_CONVENTION.sources.meta.canonical);
    expect(convention.sources.google.canonical).toEqual(["google"]);
    expect(rejected.map((r) => r.value).sort()).toEqual(["gads", "meta_ads"]);
  });

  it("accepts msg / an for Meta (Meta's own placement values)", () => {
    const { rejected } = parseUtmConvention({ sources: { meta: { canonical: ["fb", "ig", "msg", "an"] } } });
    expect(rejected).toEqual([]);
  });

  it("rejects an invalid campaign pattern and bad case / separator values", () => {
    const { convention, rejected } = parseUtmConvention({ campaign_pattern: "([", case: "upper", separator: "/" });
    expect(convention.campaign_pattern).toBeNull();
    expect(convention.case).toBe("lowercase");
    expect(rejected.map((r) => r.field).sort()).toEqual(["campaign_pattern", "case", "separator"]);
  });

  it("drops aliases that are also canonical", () => {
    const { convention } = parseUtmConvention({ sources: { meta: { canonical: ["fb", "facebook"], aliases: ["facebook", "FB_ads"] } } });
    expect(convention.sources.meta.aliases).toEqual(["fb_ads"]);
  });

  it("drops default aliases that become canonical when aliases aren't set", () => {
    const { convention } = parseUtmConvention({ sources: { meta: { canonical: ["fb", "ig", "msg", "an", "facebook"] } } });
    expect(convention.sources.meta.aliases).toEqual(["instagram"]);
  });

  it("parseAdsSettings carries the convention and its rejections", () => {
    const s = parseAdsSettings({ utm_convention: { mediums: { google: "banner" }, require_ids: false } });
    expect(s.utm_convention.mediums.google).toBe("banner");
    expect(s.utm_convention.require_ids).toBe(false);
    expect(s.utm_convention_rejected).toEqual([]);
    expect(parseAdsSettings({ utm_convention: "nope" }).utm_convention_rejected).toHaveLength(1);
  });
});
