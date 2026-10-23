import type { FindingTone, Money, NextRelation, TargetSource } from "@shared/page-stats";
import { formatMoney } from "@/components/ads/ads-format";

export function pct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function num(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 1 : 0 });
}

export function money(m: Money | null | undefined): string {
  if (!m || Object.keys(m).length === 0) return "—";
  return formatMoney(m);
}

export function seconds(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return "—";
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return r ? `${m}m ${r}s` : `${m}m`;
}

/** Relative change vs prior (null when prior is 0 / missing). */
export function delta(cur: number | null | undefined, prior: number | null | undefined): number | null {
  if (cur === null || cur === undefined || prior === null || prior === undefined || prior === 0) return null;
  return (cur - prior) / prior;
}

export function shortDay(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

export function targetSourceLabel(source: TargetSource): string {
  switch (source) {
    case "settings":
      return "your target";
    case "benchmark":
      return "similar pages";
    case "previous_period":
      return "previous 28 days";
    default:
      return "no target";
  }
}

export const TONE_TEXT: Record<FindingTone, string> = {
  good: "text-status-online",
  warn: "text-status-away",
  bad: "text-status-busy",
  info: "text-muted-foreground",
};

export const TONE_BORDER: Record<FindingTone, string> = {
  good: "border-status-online/40 bg-status-online/5",
  warn: "border-status-away/40 bg-status-away/5",
  bad: "border-status-busy/40 bg-status-busy/5",
  info: "border-border bg-muted/30",
};

export const RELATION_LABEL: Record<NextRelation, string> = {
  forward: "Forward",
  same: "Same stage",
  back: "Back",
  unknown: "No stage",
  exit: "Left the site",
};

export const RELATION_BAR: Record<NextRelation, string> = {
  forward: "bg-status-online/60",
  same: "bg-chart-3/60",
  back: "bg-status-away/60",
  unknown: "bg-muted-foreground/30",
  exit: "bg-status-busy/50",
};

export const CHANNEL_LABELS: Record<string, string> = {
  paid: "Paid ads",
  organic: "Organic search",
  direct: "Direct",
  email: "Email",
  social: "Social",
  referral: "Referral",
  other: "Other",
  organic_search: "Organic search",
  organic_social: "Organic social",
  ai_assistant: "AI assistant",
  meta_unclear: "Meta, unclear",
  tagged_other: "Other tagged",
  "(not tracked)": "Not tracked",
};

export function channelLabel(key: string): string {
  return CHANNEL_LABELS[key] ?? key;
}
