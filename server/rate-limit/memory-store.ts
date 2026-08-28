import type { RateLimitStore } from "./types.js";

type Bucket = { count: number; expiresAt: number };

/**
 * In-memory fixed-window store. Counters are per Node process and lost on restart.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, Bucket>();
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts?: { pruneIntervalMs?: number }) {
    const interval = opts?.pruneIntervalMs ?? 60_000;
    this.pruneTimer = setInterval(() => this.prune(), interval);
    if (this.pruneTimer.unref) this.pruneTimer.unref();
  }

  getCount(key: string): number {
    const bucket = this.buckets.get(key);
    if (!bucket) return 0;
    if (bucket.expiresAt <= Date.now()) {
      this.buckets.delete(key);
      return 0;
    }
    return bucket.count;
  }

  increment(key: string, windowMs: number): number {
    const now = Date.now();
    const existing = this.buckets.get(key);
    if (!existing || existing.expiresAt <= now) {
      const next = { count: 1, expiresAt: now + windowMs };
      this.buckets.set(key, next);
      return 1;
    }
    existing.count += 1;
    return existing.count;
  }

  reset(): void {
    this.buckets.clear();
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.expiresAt <= now) this.buckets.delete(key);
    }
  }

  destroy(): void {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.pruneTimer = null;
    this.buckets.clear();
  }
}

let defaultStore: MemoryRateLimitStore | null = null;

export function getDefaultRateLimitStore(): MemoryRateLimitStore {
  if (!defaultStore) defaultStore = new MemoryRateLimitStore();
  return defaultStore;
}

/** @internal tests */
export function resetDefaultRateLimitStore(): void {
  defaultStore?.reset();
}
