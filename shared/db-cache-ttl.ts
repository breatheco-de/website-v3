/**
 * Resolve private-database cache TTL to minutes.
 * Prefers `ttl_minutes`; falls back to `ttl_hours * 60`; default 24h.
 */

export type DbCacheTtlConfig = {
  ttl_minutes?: number;
  /** @deprecated Prefer ttl_minutes; still read for back-compat. */
  ttl_hours?: number;
};

export function resolveCacheTtlMinutes(cache?: DbCacheTtlConfig | null): number {
  if (cache?.ttl_minutes != null && Number.isFinite(Number(cache.ttl_minutes))) {
    return Number(cache.ttl_minutes);
  }
  if (cache?.ttl_hours != null && Number.isFinite(Number(cache.ttl_hours))) {
    return Number(cache.ttl_hours) * 60;
  }
  return 24 * 60;
}

export type TtlUiUnit = "hours" | "minutes";

/** Derive number input + unit for Private Databases TTL controls. */
export function ttlUiFromCache(cache?: DbCacheTtlConfig | null): {
  value: string;
  unit: TtlUiUnit;
} {
  if (cache?.ttl_minutes != null && Number.isFinite(Number(cache.ttl_minutes))) {
    const m = Number(cache.ttl_minutes);
    if (m >= 60 && m % 60 === 0) {
      return { value: String(m / 60), unit: "hours" };
    }
    return { value: String(m), unit: "minutes" };
  }
  if (cache?.ttl_hours != null && Number.isFinite(Number(cache.ttl_hours))) {
    return { value: String(cache.ttl_hours), unit: "hours" };
  }
  return { value: "24", unit: "hours" };
}

/** Build cache object to persist (always writes ttl_minutes; omits ttl_hours). */
export function ttlCachePayload(
  value: string,
  unit: TtlUiUnit,
): { ttl_minutes: number } {
  const parsed = value !== "" && Number.isFinite(Number(value)) ? Number(value) : NaN;
  const n = Number.isFinite(parsed) ? parsed : unit === "hours" ? 24 : 24 * 60;
  return { ttl_minutes: unit === "hours" ? n * 60 : n };
}
