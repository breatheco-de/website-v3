import React from "react";
import { beforeAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AdsCampaignRef, AdsPageRow } from "./ads-types";
import type * as RowsModule from "./PaidCampaignRows";
import type { PaidPageRow as Row } from "./PaidPageRow";

let PaidPageRow: typeof Row;
let Rows: typeof RowsModule;
beforeAll(async () => {
  // Vitest compiles JSX with the classic runtime; these modules rely on the automatic one.
  (globalThis as { React?: typeof React }).React = React;
  ({ PaidPageRow } = await import("./PaidPageRow"));
  Rows = await import("./PaidCampaignRows");
});

function campaign(over: Partial<AdsCampaignRef>): AdsCampaignRef {
  return {
    platform: "meta",
    campaign_id: "c1",
    campaign_name: "Bootcamp prospecting",
    paid_visits: 500,
    engaged_sessions: 300,
    spend: { USD: 1000 },
    clicks: 600,
    impressions: 20000,
    landing_page_views: 550,
    meta_leads: 30,
    pixel_leads_click: 20,
    google_leads: 0,
    unique_leads: 12,
    cost_per_visit: { USD: 2 },
    ctr: 0.03,
    cpc: { USD: 1.67 },
    conversion_rate: 0.024,
    cost_per_lead: { USD: 83.33 },
    meta_conversion_rate: 0.05,
    meta_cost_per_lead: { USD: 33.33 },
    bounce_rate: 0.4,
    low_sample: false,
    ...over,
  };
}

const CAMPAIGNS: AdsCampaignRef[] = [
  campaign({}),
  campaign({ campaign_id: "c2", campaign_name: "Retargeting", spend: { USD: 300 }, paid_visits: 0, engaged_sessions: 0, cost_per_visit: {}, low_sample: true }),
  campaign({
    platform: null,
    campaign_id: null,
    campaign_name: "Visits without campaign tag",
    untagged: true,
    spend: {},
    paid_visits: 40,
    meta_leads: 0,
    pixel_leads_click: 0,
    tag_texts: [{ text: "Partner push", visits: 30 }],
  }),
];

function row(over: Partial<AdsPageRow> = {}): AdsPageRow {
  return {
    key: "entry:landing/ai-engineering-salaries/en",
    kind: "entry",
    kind_label: "Page",
    host: "example.com",
    path: "/landing/ai-engineering-salaries",
    url: "https://example.com/landing/ai-engineering-salaries",
    content_type: "landing",
    slug: "ai-engineering-salaries",
    locale: "en",
    title: "Ai engineering salaries",
    redirected_from: [],
    paid_visits: 540,
    matched_visits: 500,
    unclear_visits: 0,
    unassigned_visits: 0,
    engaged_sessions: 300,
    bounce_rate: 0.4,
    avg_engaged_seconds: 30,
    ga4_leads: 12,
    spend: { USD: 1300 },
    clicks: 600,
    untagged_clicks: 0,
    landing_page_views: 550,
    meta_leads: 30,
    instant_form_leads: 0,
    google_leads: 0,
    impressions: 20000,
    pixel_leads_click: 20,
    unique_leads: 12,
    submissions: 12,
    repeat_submissions: 0,
    last_visit_organic: 0,
    started_here: 12,
    closed_here: 0,
    conversion_rate: 0.022,
    meta_conversion_rate: 0.05,
    ctr: 0.03,
    landing_rate: 0.9,
    lpv_to_visits: 0.9,
    cost_per_visit: { USD: 2.4 },
    cost_per_lead: { USD: 108 },
    cpc: { USD: 2.17 },
    cpm: { USD: 65 },
    meta_cost_per_lead: { USD: 43 },
    clicks_to_visits: 0.83,
    organic: null,
    low_sample: false,
    meta_low_sample: false,
    platforms: ["meta"],
    campaigns: CAMPAIGNS,
    comparable_campaigns: 1,
    ...over,
  };
}

describe("PaidPageRow", () => {
  it("shows one expand button when the row has campaigns and no campaign list in the details popover", () => {
    const html = renderToStaticMarkup(<PaidPageRow row={row()} perspective="traffic" />);
    expect(html).toContain('data-testid="button-paid-row-expand"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("paid-row-expanded");
  });

  it("hides the expand button when there is nothing to expand", () => {
    const html = renderToStaticMarkup(<PaidPageRow row={row({ campaigns: [] })} perspective="traffic" />);
    expect(html).not.toContain("button-paid-row-expand");
  });

  it("shows own paid visits and own conversion only when the row has own counts", () => {
    expect(renderToStaticMarkup(<PaidPageRow row={row()} perspective="traffic" />)).not.toContain("metric-own-visits");
    const own = { paid_visits: 600, covered_days: 28, total_days: 28 };
    expect(renderToStaticMarkup(<PaidPageRow row={row({ own_counts: own })} perspective="traffic" />)).toContain("metric-own-visits");
    const conversion = renderToStaticMarkup(<PaidPageRow row={row({ own_counts: own })} perspective="conversion" />);
    expect(conversion).toContain("metric-own-cr");
    expect(conversion).toContain("2.0%");
  });

  it("hides own conversion rate when own counts cover only part of the range", () => {
    const html = renderToStaticMarkup(
      <PaidPageRow row={row({ own_counts: { paid_visits: 600, covered_days: 10, total_days: 28 } })} perspective="conversion" />,
    );
    expect(html).toMatch(/data-testid="metric-own-cr"[\s\S]*?—/);
  });
});

describe("PaidCampaignRows", () => {
  const render = (perspective: "traffic" | "conversion" | "engagement" | "integrity", over: Partial<AdsPageRow> = {}) =>
    renderToStaticMarkup(<Rows.PaidCampaignRows row={row(over)} perspective={perspective} />);

  it("says how many campaigns have enough data, ignoring the untagged row", () => {
    expect(render("traffic")).toContain("1 of 2 campaigns have enough data to compare.");
    expect(render("traffic", { campaigns: [CAMPAIGNS[0]!, CAMPAIGNS[2]!] })).not.toContain("text-comparable-campaigns");
  });

  it("renders one sub-row per campaign with the active perspective's columns", () => {
    const traffic = render("traffic");
    expect(traffic).toContain('data-testid="campaign-row-meta-c1"');
    expect(traffic).toContain('data-testid="campaign-row-meta-c2"');
    expect(traffic).toContain('data-testid="campaign-row-untagged"');
    expect(traffic).toContain("campaign-metric-cpv");
    expect(traffic).not.toContain("campaign-metric-leads");

    const integrity = render("integrity");
    expect(integrity).toContain("campaign-metric-spend");
    expect(integrity).toContain("campaign-metric-ctv");
    expect(integrity).not.toContain("campaign-metric-cpv");
  });

  it("flags spend without visits on a campaign, never on the untagged row", () => {
    const html = render("traffic");
    expect(html.match(/button-campaign-spend-no-visits/g)).toHaveLength(1);
  });

  it("shows Meta click leads with a light saw-the-ad-only count and a hint", () => {
    const html = render("conversion");
    expect(html).toContain("+10 saw the ad only");
    expect(html).toContain("button-campaign-hint-meta-leads");
    const hint = renderToStaticMarkup(<Rows.MetaLeadsHint metaSplitDays={{ covered: 10, total: 28 }} />);
    expect(hint).toContain("Leads from clicks:");
    expect(hint).toContain("Saw the ad only:");
    expect(hint).toContain("Based on 10 of 28 days.");
  });

  it("explains the untagged row and lists the tag texts it saw", () => {
    const html = renderToStaticMarkup(<Rows.UntaggedExplainer c={CAMPAIGNS[2]!} />);
    expect(html).toContain("Spend is never put");
    expect(html).toContain("Partner push");
    expect(html).toContain("30 visits");
    expect(html).toContain("By campaign");
  });
});
