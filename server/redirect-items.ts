/**
 * Page `meta.redirects` lists compared as sets of addresses. Page addresses are
 * exact paths (regex rules live in custom-redirects.yml), so order never matters.
 */

export type RedirectItem = { path: string; status: number; raw: unknown };

export function normalizeRedirectPath(p: string): string {
  let n = String(p ?? "").trim().toLowerCase();
  if (!n) return "";
  if (!n.startsWith("/")) n = `/${n}`;
  if (n.length > 1 && n.endsWith("/")) n = n.slice(0, -1);
  return n;
}

function toItem(r: unknown): RedirectItem | null {
  if (typeof r === "string" && r.trim()) return { path: normalizeRedirectPath(r), status: 301, raw: r };
  if (r && typeof r === "object" && "path" in r) {
    const p = normalizeRedirectPath(String((r as { path: unknown }).path ?? ""));
    const s = Number((r as { status?: unknown }).status);
    return p ? { path: p, status: s === 302 ? 302 : 301, raw: r } : null;
  }
  return null;
}

/** `meta.redirects` of a page document (or a raw list), keyed by normalized path. */
export function redirectItems(source: unknown): Map<string, RedirectItem> {
  const list = Array.isArray(source)
    ? source
    : source && typeof source === "object"
      ? ((source as { meta?: { redirects?: unknown } }).meta?.redirects ?? [])
      : [];
  const out = new Map<string, RedirectItem>();
  if (!Array.isArray(list)) return out;
  for (const r of list) {
    const item = toItem(r);
    if (item && !out.has(item.path)) out.set(item.path, item);
  }
  return out;
}

export type RedirectChanges = {
  added: RedirectItem[];
  removed: RedirectItem[];
  /** Same address, different status (the `after` item). */
  changed: RedirectItem[];
};

export function diffRedirectItems(before: unknown, after: unknown): RedirectChanges {
  const a = redirectItems(before);
  const b = redirectItems(after);
  const added: RedirectItem[] = [];
  const removed: RedirectItem[] = [];
  const changed: RedirectItem[] = [];
  for (const [p, item] of b) {
    const prev = a.get(p);
    if (!prev) added.push(item);
    else if (prev.status !== item.status) changed.push(item);
  }
  for (const [p, item] of a) if (!b.has(p)) removed.push(item);
  return { added, removed, changed };
}

export function hasRedirectChanges(c: RedirectChanges): boolean {
  return c.added.length + c.removed.length + c.changed.length > 0;
}

export type RedirectMerge =
  | { ok: true; list: unknown[] }
  | { ok: false; conflicts: Array<{ path: string; author: unknown; live: unknown }> };

/**
 * Three-way merge of one page's `meta.redirects`: today's live, plus what the
 * author added or changed since the base, minus what the author removed.
 * An address both sides touched differently is a conflict.
 */
export function mergeRedirectLists(base: unknown, author: unknown, live: unknown): RedirectMerge {
  const baseItems = redirectItems(base);
  const authorItems = redirectItems(author);
  const liveItems = redirectItems(live);
  const conflicts: Array<{ path: string; author: unknown; live: unknown }> = [];
  const result = new Map(liveItems);

  const paths = new Set([...baseItems.keys(), ...authorItems.keys()]);
  for (const p of paths) {
    const b = baseItems.get(p);
    const a = authorItems.get(p);
    const l = liveItems.get(p);
    const authorTouched = !b || !a || b.status !== a.status;
    if (!authorTouched) continue;
    const liveTouched = !!b !== !!l || (!!b && !!l && b.status !== l.status);
    const sameOutcome = (!a && !l) || (!!a && !!l && a.status === l.status);
    if (liveTouched && !sameOutcome) {
      conflicts.push({ path: p, author: a?.raw ?? null, live: l?.raw ?? null });
      continue;
    }
    if (a) result.set(p, a);
    else result.delete(p);
  }
  if (conflicts.length > 0) return { ok: false, conflicts };
  return { ok: true, list: [...result.values()].map((i) => i.raw) };
}
