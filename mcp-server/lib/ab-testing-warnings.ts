/**
 * list_variants warnings about page tests: stickiness, readiness, and live split health.
 * Built from the main app's GET /api/versioning payload.
 */

export type AbWarning = { code: string; message: string };

type LocaleBlock = { variants?: Array<{ slug: string; allocation: number }>; started_at?: string };

type SplitSource = {
  status: string;
  total: number;
  observed_pct: Record<string, number>;
  p_value: number | null;
  through_date?: string | null;
};

type SplitLocale = {
  experiment_id: string;
  expected_pct: Record<string, number>;
  server: SplitSource;
  ga4: SplitSource;
  status: string;
};

function pct(shares: Record<string, number>): string {
  return Object.entries(shares)
    .map(([k, v]) => `${k} ${Math.round(v)}%`)
    .join(" / ");
}

export function abTestingWarnings(input: {
  versioning: Record<string, LocaleBlock> | null | undefined;
  ab_testing?: { set_up?: boolean; latest_check_ok?: boolean } | null;
  split_health?: Record<string, SplitLocale> | null;
}): AbWarning[] {
  const warnings: AbWarning[] = [];
  const versioning = input.versioning ?? {};
  const running = Object.entries(versioning).filter(([, b]) => (b?.variants ?? []).some((v) => v.allocation > 0));

  if (input.ab_testing && input.ab_testing.set_up === false) {
    warnings.push({
      code: "ab_testing_not_setup",
      message:
        "A/B testing is not set up for this site: visitors only see Default and no version gets traffic. " +
        "Staff must complete Settings → A/B testing → Setup before any test runs. Allocation stays staff-only.",
    });
  } else if (input.ab_testing && input.ab_testing.latest_check_ok === false) {
    warnings.push({
      code: "ab_check_failing",
      message:
        "The last A/B check failed: running tests continue, but starting or raising traffic is blocked until a check passes " +
        "(Settings → A/B testing → Health). Lowering or stopping traffic still works (staff-only).",
    });
  }

  if (running.length > 0) {
    const runs = running.map(([locale, b]) => `${locale}: started ${b.started_at ?? "unknown (before run dates)"}`).join("; ");
    warnings.push({
      code: "variant_assignment_sticky",
      message:
        "Visitors keep the version they first saw (cookie 4g_versioning_v2, per page and locale); a new split only affects new visitors. " +
        `Traffic allocation is staff-only (Versioning panel). Runs: ${runs}.`,
    });
  }

  for (const [locale, h] of Object.entries(input.split_health ?? {})) {
    if (h.status !== "mismatch") continue;
    const source = h.server.status === "mismatch" ? "server" : "ga4";
    const s = source === "server" ? h.server : h.ga4;
    warnings.push({
      code: "split_mismatch",
      message:
        `${locale} (${h.experiment_id}): results unreliable. Set ${pct(h.expected_pct)}, observed ${pct(s.observed_pct)} ` +
        `from ${source === "server" ? "server counts" : "GA4 sessions"} (n=${s.total}, p=${s.p_value?.toExponential(1) ?? "n/a"}` +
        `${source === "ga4" && s.through_date ? `, through ${s.through_date}` : ""}). Check caching or tracking before reading results.`,
    });
  }

  return warnings;
}
