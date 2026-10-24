/**
 * Verdict + up to 3 findings for the page stats drawer. Each finding has the numbers behind it,
 * what to try, and a deep link; findings are ranked by how much they move the stage objective.
 * Rate-based findings need PAGE_STATS_MIN_SESSIONS sessions. Pure.
 */

import { CAMPAIGN_GOAL_LABELS, STAGE_OBJECTIVES } from "@shared/page-objectives";
import {
  PAGE_STATS_MIN_SESSIONS,
  biggestFunnelDrop,
  type Finding,
  type LeadsFacts,
  type LinksFacts,
  type Money,
  type ObjectiveBlock,
  type OrganicFacts,
  type PageAdvice,
  type PaidFacts,
  type TargetSource,
  type TrafficFacts,
} from "@shared/page-stats";
import type { FunnelStage } from "@shared/funnel";
import { channelLabel, moneyWithinTarget } from "./objective";

export const MAX_FINDINGS = 3;

export type AdviceInputs = {
  stage: FunnelStage | null;
  path: string;
  objective: ObjectiveBlock | null;
  traffic: TrafficFacts | null;
  leads: LeadsFacts | null;
  organic: OrganicFacts | null;
  paid: PaidFacts | null;
  links: LinksFacts | null;
};

export function pct(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function money(m: Money | null | undefined): string {
  const entries = Object.entries(m ?? {}).filter(([, v]) => Number.isFinite(v));
  if (entries.length === 0) return "—";
  return entries
    .map(([cur, v]) => {
      try {
        return new Intl.NumberFormat("en-US", { style: "currency", currency: cur, maximumFractionDigits: v >= 100 ? 0 : 2 }).format(v);
      } catch {
        return `${v.toFixed(2)} ${cur}`;
      }
    })
    .join(" · ");
}

function spendTotal(m: Money): number {
  return Object.values(m).reduce((s, v) => s + v, 0);
}

function targetPhrase(source: TargetSource): string {
  switch (source) {
    case "settings":
      return "your target";
    case "benchmark":
      return "similar pages";
    case "previous_period":
      return "the previous 28 days";
    default:
      return "";
  }
}

function verdict(inputs: AdviceInputs): PageAdvice["verdict"] {
  const sessions = inputs.traffic?.current.sessions ?? 0;
  if (!inputs.stage) {
    return { tone: "info", text: "Set this page's funnel stage to see its main objective and advice for it." };
  }
  if (!inputs.traffic) {
    return { tone: "info", text: "Visit data isn't available, so the objective can't be measured yet." };
  }
  const o = inputs.objective;
  if (!o || sessions < PAGE_STATS_MIN_SESSIONS) {
    return { tone: "info", text: `Too little traffic to judge: ${sessions} sessions in the last 28 days (needs ${PAGE_STATS_MIN_SESSIONS}).` };
  }
  const p = o.primary;
  const label = p.label.toLowerCase();
  const costBehind = o.cost?.status === "behind";
  if (p.status === "on_track") {
    const base = `On track: ${pct(p.value, 1)} ${label} vs ${pct(p.target, 1)} for ${targetPhrase(p.target_source)}.`;
    return costBehind
      ? { tone: "warn", text: `${base} But ${o.cost!.label.toLowerCase()} is ${money(o.cost!.value)} vs ${money(o.cost!.target)}.` }
      : { tone: "good", text: base };
  }
  if (p.status === "behind") {
    return {
      tone: "bad",
      text: `Behind: ${pct(p.value, 1)} ${label} vs ${pct(p.target, 1)} for ${targetPhrase(p.target_source)}.`,
    };
  }
  return { tone: "info", text: `${pct(p.value, 1)} ${label} this period. Set a target in Settings → Ads → Targets to track progress.` };
}

function biggestLoss(o: ObjectiveBlock): Finding | null {
  if (o.primary.status !== "behind") return null;
  const idx = biggestFunnelDrop(o.funnel);
  const worst = o.funnel[idx];
  if (!worst?.loss_cause) return null;
  const from = o.funnel[idx - 1];
  return {
    id: "funnel_loss",
    tone: "warn",
    title: `Biggest drop: ${from?.label ?? "previous step"} → ${worst.label}`,
    evidence: `${pct(worst.loss_from_previous)} lost (${from?.total ?? 0} → ${worst.total ?? 0}).`,
    action: worst.loss_cause ?? "",
    link: null,
    weight: 74,
  };
}

function paidFindings(inputs: AdviceInputs, out: Finding[]): void {
  const paid = inputs.paid;
  if (!paid) return;
  const spend = spendTotal(paid.spend);

  if (paid.issues.length > 0) {
    const errors = paid.issues.filter((i) => i.severity === "error").length;
    const platform = paid.issues[0]?.platform === "google" ? "google" : paid.issues[0]?.platform === "meta" ? "meta" : null;
    out.push({
      id: "ads_issues",
      tone: errors > 0 ? "bad" : "warn",
      title: `${paid.issues.length} ad tracking issue${paid.issues.length === 1 ? "" : "s"} on this page`,
      evidence: paid.issues.slice(0, 2).map((i) => i.title).join("; "),
      action: "Fix these first: they decide whether ad spend and leads on this page are counted at all.",
      link: { kind: "ads_diagnostics", platform },
      weight: errors > 0 ? 92 : 72,
    });
  }

  if (inputs.stage === "post-enrollment" && spend > 0) {
    out.push({
      id: "post_enrollment_spend",
      tone: "bad",
      title: "Ads are paying to send people to a student page",
      evidence: `${money(paid.spend)} spent on ads landing here in 28 days.`,
      action: "Point those ads at a decision page, or pause them.",
      link: { kind: "ads_diagnostics", platform: null },
      weight: 95,
    });
  }

  if (inputs.stage) {
    const mismatched = paid.campaigns
      .filter((c) => c.fit === "mismatch" && (spendTotal(c.spend) > 0 || c.paid_visits >= 10))
      .sort((a, b) => spendTotal(b.spend) - spendTotal(a.spend))[0];
    if (mismatched && inputs.stage !== "post-enrollment") {
      const share = spend > 0 ? spendTotal(mismatched.spend) / spend : null;
      out.push({
        id: "campaign_goal_mismatch",
        tone: "warn",
        title: `Campaign goal doesn't match this page's job`,
        evidence: `"${mismatched.campaign_name}" optimizes for ${CAMPAIGN_GOAL_LABELS[mismatched.goal].toLowerCase()}${
          share !== null ? ` (${pct(share)} of this page's ad spend)` : ""
        }; this is a ${inputs.stage} page.`,
        action:
          inputs.stage === "decision"
            ? "Use a Leads, Sales or Search campaign here, or send this campaign to an awareness or consideration page."
            : "Point leads-optimized campaigns at a decision page; keep reach, traffic or video campaigns here.",
        link: { kind: "ads_diagnostics", platform: mismatched.platform === "google" ? "google" : "meta" },
        weight: 70 + Math.round((share ?? 0) * 20),
      });
    }
  }

  if (paid.clicks_to_visits !== null && paid.clicks >= 100 && paid.clicks_to_visits < 0.6) {
    out.push({
      id: "clicks_to_visits",
      tone: "warn",
      title: "Many ad clicks never become visits",
      evidence: `${pct(paid.clicks_to_visits)} of ${paid.clicks} ad clicks show up as visits.`,
      action: "Check the ads' tracking parameters and the page's load speed on mobile.",
      link: { kind: "ads_diagnostics", platform: "meta" },
      weight: 62,
    });
  }

  const platformLeads = paid.meta_leads + paid.google_leads;
  if (platformLeads >= 10 && platformLeads > paid.unique_leads * 1.5 + 5) {
    out.push({
      id: "platform_lead_gap",
      tone: "warn",
      title: "Ad platforms report more leads than you received",
      evidence: `Meta and Google report ${platformLeads} leads; your lead records show ${paid.unique_leads}.`,
      action: "Check the pixel and conversion setup: the platforms may be optimizing for leads that never reach you.",
      link: { kind: "ads_diagnostics", platform: paid.meta_leads >= paid.google_leads ? "meta" : "google" },
      weight: 58,
    });
  }

  if (inputs.stage === "decision" && spend > 0) {
    const target = inputs.objective?.cost?.target ?? null;
    for (const c of paid.campaigns) {
      if (c.untagged) continue;
      const cSpend = spendTotal(c.spend);
      const share = cSpend / spend;
      if (c.unique_leads === 0 && cSpend > 0 && share >= 0.15 && c.clicks >= 50) {
        out.push({
          id: `campaign_no_leads:${c.campaign_id ?? c.campaign_name}`,
          tone: "bad",
          title: `"${c.campaign_name}" spent ${money(c.spend)} with no leads`,
          evidence: `${pct(share)} of this page's ad spend, ${c.clicks} clicks, ${c.paid_visits} visits, 0 leads in your records.`,
          action: "Fix the campaign's targeting or landing page, or pause it.",
          link: { kind: "ads_diagnostics", platform: c.platform === "google" ? "google" : "meta" },
          weight: 84,
        });
      } else if (target && c.unique_leads > 0 && share >= 0.15 && !c.low_sample) {
        const within = moneyWithinTarget(c.cost_per_lead, target);
        if (within === false) {
          const cur = Object.keys(c.cost_per_lead).find((k) => k in target);
          const atTarget = cur ? Math.floor((c.spend[cur] ?? 0) / target[cur]!) : null;
          out.push({
            id: `campaign_over_cpl:${c.campaign_id ?? c.campaign_name}`,
            tone: "bad",
            title: `"${c.campaign_name}" costs ${money(c.cost_per_lead)} per lead`,
            evidence: `Target ${money(target)}. It spends ${pct(share)} of this page's ad budget for ${c.unique_leads} leads${
              atTarget !== null ? `; at target cost that spend would buy ${atTarget}` : ""
            }.`,
            action: "Tighten targeting or move budget to the campaigns under target.",
            link: { kind: "ads_diagnostics", platform: c.platform === "google" ? "google" : "meta" },
            weight: 78,
          });
        }
      }
    }
  }
}

function organicFindings(inputs: AdviceInputs, out: Finding[]): void {
  const org = inputs.organic;
  if (!org || inputs.stage === "post-enrollment") return;
  const decay = org.flags.find((f) => f.kind === "decay");
  if (decay && decay.kind === "decay") {
    out.push({
      id: "organic_decay",
      tone: "warn",
      title: "Search clicks are dropping",
      evidence: `${decay.clicks} clicks vs ${decay.prior_clicks} in the previous 28 days.`,
      action: "Refresh the content and check whether another page now ranks for the same searches.",
      link: { kind: "seo_modal" },
      weight: inputs.stage === "awareness" ? 66 : 48,
    });
  }
  const lowCtr = org.flags.find((f) => f.kind === "low_ctr");
  if (lowCtr && lowCtr.kind === "low_ctr") {
    out.push({
      id: "organic_low_ctr",
      tone: "warn",
      title: `Few searchers click for "${lowCtr.query}"`,
      evidence: `${pct(lowCtr.ctr, 1)} click-through vs about ${pct(lowCtr.expected_ctr)} expected for that position (${lowCtr.impressions} impressions).`,
      action: "Rewrite the page title and description so they answer that search.",
      link: { kind: "seo_modal" },
      weight: inputs.stage === "awareness" ? 56 : 40,
    });
  }
  const page2 = org.flags.find((f) => f.kind === "page2");
  if (page2 && page2.kind === "page2" && inputs.stage === "awareness") {
    out.push({
      id: "organic_page2",
      tone: "info",
      title: `Almost on page 1 for "${page2.query}"`,
      evidence: `Average position ${page2.position} with ${page2.impressions} impressions.`,
      action: "Expand the section that answers this search and link to it from related pages.",
      link: { kind: "seo_modal" },
      weight: 46,
    });
  }
  const cannibal = org.flags.find((f) => f.kind === "cannibalization");
  if (cannibal && cannibal.kind === "cannibalization") {
    out.push({
      id: "organic_cannibalization",
      tone: "info",
      title: `Another page competes for "${cannibal.query}"`,
      evidence: `Google splits ${cannibal.impressions} impressions between this page and ${cannibal.other_url}.`,
      action: "Pick one page for this search and link the other to it.",
      link: { kind: "url", href: cannibal.other_url, label: "Open the other page" },
      weight: 38,
    });
  }
}

function journeyFindings(inputs: AdviceInputs, out: Finding[]): void {
  const t = inputs.traffic;
  if (!t || !inputs.stage) return;
  const sessions = t.current.sessions;
  const enough = sessions >= PAGE_STATS_MIN_SESSIONS;

  if (inputs.links?.no_next_stage_link) {
    const next = inputs.stage === "awareness" ? "consideration" : "decision";
    out.push({
      id: "no_next_stage_link",
      tone: "warn",
      title: `No link to a ${next} page`,
      evidence: `This page links to ${inputs.links.outbound.length} pages, none of them in the ${next} stage.`,
      action: `Add a clear next step (CTA or in-text link) to a ${next} page.`,
      link: null,
      weight: inputs.stage === "awareness" ? 76 : 70,
    });
  }

  const convertedHere = inputs.leads?.converted_here.count ?? 0;
  if ((inputs.stage === "awareness" || inputs.stage === "consideration") && convertedHere >= 10 && sessions > 0 && convertedHere / sessions >= 0.02) {
    out.push({
      id: "stage_collects_leads",
      tone: "info",
      title: "This page collects leads directly",
      evidence: `${convertedHere} leads converted here (${pct(convertedHere / sessions, 1)} of sessions): that's how a decision page behaves.`,
      action: "If capturing leads is this page's job, set its stage to decision so it's judged on leads and cost per lead.",
      link: { kind: "funnel_tab" },
      weight: 64,
    });
  }

  if (inputs.stage === "consideration" && enough) {
    const back = t.current.moved_back / sessions;
    if (back >= 0.25) {
      out.push({
        id: "back_rate",
        tone: "warn",
        title: `${pct(back)} go back to awareness pages`,
        evidence: `${t.current.moved_back} of ${sessions} sessions went back instead of forward.`,
        action: "Answer the questions people leave to look up: outcomes, price, schedule, proof.",
        link: null,
        weight: 60,
      });
    }
    const overall = t.current.reached_decision / sessions;
    const weak = t.channels
      .filter((c) => c.sessions >= sessions * 0.15 && c.sessions >= 30)
      .find((c) => c.reached_decision / c.sessions < overall * 0.5);
    if (weak) {
      out.push({
        id: `weak_source:${weak.channel}`,
        tone: "warn",
        title: `${channelLabel(weak.channel)} brings visitors with little intent`,
        evidence: `${weak.sessions} sessions, ${pct(weak.reached_decision / weak.sessions, 1)} reach a decision page (page average ${pct(overall, 1)}).`,
        action: "Adjust targeting or the message for this source so it matches what the page offers.",
        link: null,
        weight: 55,
      });
    }
  }

  if (inputs.stage === "decision" && enough) {
    const backTo = t.next_pages
      .filter((p) => p.relation === "back" && p.stage === "consideration")
      .sort((a, b) => b.sessions - a.sessions)[0];
    if (backTo && backTo.sessions / sessions >= 0.15) {
      out.push({
        id: "decision_back_to_consideration",
        tone: "info",
        title: `Many visitors go back to ${backTo.path} before deciding`,
        evidence: `${backTo.sessions} of ${sessions} sessions (${pct(backTo.sessions / sessions)}).`,
        action: "Bring the proof they look for (outcomes, FAQ, testimonials) onto this page.",
        link: { kind: "url", href: backTo.path, label: "Open that page" },
        weight: 50,
      });
    }
    if (inputs.objective?.primary.status === "behind") {
      out.push({
        id: "decision_test_variant",
        tone: "warn",
        title: "Conversion is below target",
        evidence: `${pct(inputs.objective.primary.value, 1)} vs ${pct(inputs.objective.primary.target, 1)} for ${targetPhrase(
          inputs.objective.primary.target_source,
        )}.`,
        action: "Test a new version of the hero, offer or form against the current one.",
        link: null,
        weight: 80,
      });
    }
  }

  if (inputs.stage === "post-enrollment" && enough) {
    const lost = t.current.lost / sessions;
    if (lost >= 0.4) {
      out.push({
        id: "post_lost",
        tone: "warn",
        title: `${pct(lost)} of visitors look lost`,
        evidence: `${t.current.lost} sessions left without engaging or went to contact / support pages.`,
        action: "Make the main task (log in, find the next step) the first thing on the page.",
        link: null,
        weight: 70,
      });
    }
    const organic = t.channels.find((c) => c.channel === "organic");
    if (organic && organic.sessions / sessions >= 0.4) {
      out.push({
        id: "post_organic_prospects",
        tone: "warn",
        title: "Search brings prospects to a student page",
        evidence: `${pct(organic.sessions / sessions)} of sessions come from organic search.`,
        action: "Consider a noindex, or add a clear path for prospects to the program pages.",
        link: { kind: "seo_modal" },
        weight: 60,
      });
    }
    if ((inputs.leads?.converted_here.count ?? 0) > 0) {
      out.push({
        id: "post_leads",
        tone: "info",
        title: "Leads are arriving on a post-enrollment page",
        evidence: `${inputs.leads!.converted_here.count} leads converted here in 28 days.`,
        action: "Check that this page's funnel stage is right.",
        link: { kind: "funnel_tab" },
        weight: 52,
      });
    }
  }
}

export function buildPageAdvice(inputs: AdviceInputs): PageAdvice {
  const findings: Finding[] = [];
  if (!inputs.stage) {
    findings.push({
      id: "set_stage",
      tone: "info",
      title: "This page has no funnel stage",
      evidence: "Without a stage the drawer can't tell which number matters most here.",
      action: "Pick awareness, consideration, decision or post-enrollment in the Funnel tab.",
      link: { kind: "funnel_tab" },
      weight: 100,
    });
  }
  if (inputs.objective) {
    const loss = biggestLoss(inputs.objective);
    if (loss) findings.push(loss);
    if (inputs.objective.primary.target_source === "none" && inputs.objective.primary.status !== "too_little_data") {
      findings.push({
        id: "no_target",
        tone: "info",
        title: `No target for ${STAGE_OBJECTIVES[inputs.objective.stage].primary.label.toLowerCase()}`,
        evidence: "There aren't enough similar pages or past data to benchmark this page.",
        action: "Set a stage target so progress can be tracked.",
        link: { kind: "targets" },
        weight: 30,
      });
    }
  }
  paidFindings(inputs, findings);
  organicFindings(inputs, findings);
  journeyFindings(inputs, findings);

  const seen = new Set<string>();
  const ranked = findings
    .sort((a, b) => b.weight - a.weight)
    .filter((f) => {
      const key = f.id.split(":")[0]!;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_FINDINGS);
  return { verdict: verdict(inputs), findings: ranked };
}
