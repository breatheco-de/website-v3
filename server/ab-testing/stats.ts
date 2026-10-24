/**
 * Chi-square goodness of fit for sample ratio mismatch (observed split vs configured split).
 */

/** Below this p-value the observed split is too far from the setting to be chance. */
export const SRM_P_THRESHOLD = 0.001;

function logGamma(x: number): number {
  const c = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Regularized upper incomplete gamma Q(a, x). */
function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) {
    let sum = 1 / a;
    let del = sum;
    let ap = a;
    for (let n = 0; n < 500; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
  let b = x + 1 - a;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/** P(X >= stat) for a chi-square distribution with `dof` degrees of freedom. */
export function chiSquareSurvival(stat: number, dof: number): number {
  if (dof <= 0) return 1;
  return Math.min(1, Math.max(0, gammaQ(dof / 2, stat / 2)));
}

/**
 * p-value that `observed` counts come from `expectedPct` shares (percent, summing ~100).
 * Groups with 0% expected are ignored unless they received visitors (then p = 0).
 */
export function srmPValue(
  observed: Record<string, number>,
  expectedPct: Record<string, number>,
): number | null {
  const keys = Object.keys(expectedPct).filter((k) => expectedPct[k] > 0);
  const total = Object.values(observed).reduce((n, v) => n + v, 0);
  if (keys.length < 2 || total === 0) return null;
  for (const [k, v] of Object.entries(observed)) {
    if (v > 0 && !(expectedPct[k] > 0)) return 0;
  }
  const pctTotal = keys.reduce((n, k) => n + expectedPct[k], 0);
  let stat = 0;
  for (const k of keys) {
    const expected = (total * expectedPct[k]) / pctTotal;
    const diff = (observed[k] ?? 0) - expected;
    stat += (diff * diff) / expected;
  }
  return chiSquareSurvival(stat, keys.length - 1);
}

/** Observed shares in whole percent. */
export function sharesPct(counts: Record<string, number>): Record<string, number> {
  const total = Object.values(counts).reduce((n, v) => n + v, 0);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) out[k] = total ? Math.round((v / total) * 1000) / 10 : 0;
  return out;
}

/** Expected shares from allocations: variants as configured, `default` gets the remainder. */
export function expectedSharesPct(variants: Array<{ slug: string; allocation: number }>): Record<string, number> {
  const out: Record<string, number> = {};
  let sum = 0;
  for (const v of variants) {
    if (v.allocation > 0) {
      out[v.slug] = v.allocation;
      sum += v.allocation;
    }
  }
  if (sum < 100) out.default = 100 - sum;
  return out;
}
