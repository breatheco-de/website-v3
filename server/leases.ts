/**
 * Generic lease store in per-site app.db (TTL + fencing token).
 */

import { getSiteSqlite } from "./db";
import { ensurePipelineDb } from "./pipeline-db/runner";

function ensureSchema(site: string): void {
  ensurePipelineDb(site);
}

export type LeaseRecord = {
  resource: string;
  holder: string;
  token: number;
  expiresAt: number;
};

export type AcquireLeaseResult =
  | { ok: true; lease: LeaseRecord }
  | { ok: false; lease: LeaseRecord };

const DEFAULT_TTL_MS = 30_000;

/** Compare-and-set lease acquire / renew. */
export function acquireLease(
  site: string,
  resource: string,
  holder: string,
  ttlMs = DEFAULT_TTL_MS,
): AcquireLeaseResult {
  ensureSchema(site);
  const db = getSiteSqlite(site);
  const now = Date.now();
  const expiresAt = now + ttlMs;

  const txn = db.transaction(() => {
    const existing = db
      .prepare("SELECT resource, holder, token, expires_at FROM leases WHERE resource = ?")
      .get(resource) as { resource: string; holder: string; token: number; expires_at: number } | undefined;

    if (!existing || existing.expires_at <= now) {
      const nextToken = (existing?.token ?? 0) + 1;
      db.prepare(`
        INSERT INTO leases (resource, holder, token, expires_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(resource) DO UPDATE SET holder = excluded.holder, token = excluded.token, expires_at = excluded.expires_at
      `).run(resource, holder, nextToken, expiresAt);
      return {
        ok: true as const,
        lease: { resource, holder, token: nextToken, expiresAt },
      };
    }

    if (existing.holder === holder) {
      db.prepare("UPDATE leases SET expires_at = ? WHERE resource = ?").run(expiresAt, resource);
      return {
        ok: true as const,
        lease: { resource, holder, token: existing.token, expiresAt },
      };
    }

    return {
      ok: false as const,
      lease: {
        resource,
        holder: existing.holder,
        token: existing.token,
        expiresAt: existing.expires_at,
      },
    };
  });

  return txn();
}

export function getActiveLease(site: string, resource: string): LeaseRecord | null {
  ensureSchema(site);
  const db = getSiteSqlite(site);
  const now = Date.now();
  const row = db
    .prepare("SELECT resource, holder, token, expires_at FROM leases WHERE resource = ?")
    .get(resource) as { resource: string; holder: string; token: number; expires_at: number } | undefined;
  if (!row || row.expires_at <= now) return null;
  return { resource: row.resource, holder: row.holder, token: row.token, expiresAt: row.expires_at };
}

export function renewLease(site: string, resource: string, holder: string, token: number, ttlMs = DEFAULT_TTL_MS): boolean {
  ensureSchema(site);
  const db = getSiteSqlite(site);
  const expiresAt = Date.now() + ttlMs;
  const info = db
    .prepare("UPDATE leases SET expires_at = ? WHERE resource = ? AND holder = ? AND token = ?")
    .run(expiresAt, resource, holder, token);
  return info.changes > 0;
}

export function verifyLeaseToken(site: string, resource: string, token: number): boolean {
  const lease = getActiveLease(site, resource);
  return lease !== null && lease.token === token;
}

export function releaseLease(site: string, resource: string, holder: string, token: number): void {
  ensureSchema(site);
  const db = getSiteSqlite(site);
  db.prepare("DELETE FROM leases WHERE resource = ? AND holder = ? AND token = ?").run(resource, holder, token);
}

export function bindingLeaseResource(groupId: string, locale: string): string {
  return `binding:${groupId}:${locale}`;
}

/** All leases that have not expired yet. */
export function listActiveLeases(site: string): LeaseRecord[] {
  ensureSchema(site);
  const db = getSiteSqlite(site);
  const now = Date.now();
  const rows = db
    .prepare("SELECT resource, holder, token, expires_at FROM leases WHERE expires_at > ? ORDER BY expires_at ASC")
    .all(now) as { resource: string; holder: string; token: number; expires_at: number }[];
  return rows.map((row) => ({
    resource: row.resource,
    holder: row.holder,
    token: row.token,
    expiresAt: row.expires_at,
  }));
}
