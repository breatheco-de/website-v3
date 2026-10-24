import { vi } from "vitest";

type Point = { id: number | string; payload: Record<string, unknown> };

/** In-memory stand-in for the Qdrant REST client methods used by server/vector-search.ts. */
export function makeFakeQdrant() {
  const cols = new Map<string, Map<string, Point>>();
  const notFound = () => Object.assign(new Error("Not found: Collection doesn't exist!"), { status: 404 });
  return {
    cols,
    getCollections: vi.fn(async () => ({ collections: [...cols.keys()].map((name) => ({ name })) })),
    collectionExists: vi.fn(async (name: string) => ({ exists: cols.has(name) })),
    getCollection: vi.fn(async (name: string) => {
      const col = cols.get(name);
      if (!col) throw notFound();
      return { points_count: col.size, config: { params: { vectors: { size: 384 } } } };
    }),
    createCollection: vi.fn(async (name: string) => {
      cols.set(name, new Map());
    }),
    deleteCollection: vi.fn(async (name: string) => {
      cols.delete(name);
    }),
    scroll: vi.fn(async (name: string, args: { limit: number; offset?: number }) => {
      const col = cols.get(name);
      if (!col) throw notFound();
      const all = [...col.values()];
      const start = args.offset ?? 0;
      const next = start + args.limit;
      return { points: all.slice(start, next), next_page_offset: next < all.length ? next : null };
    }),
    upsert: vi.fn(async (name: string, args: { points: Array<{ id: number | string; payload: Record<string, unknown> }> }) => {
      const col = cols.get(name);
      if (!col) throw notFound();
      for (const p of args.points) col.set(String(p.id), { id: p.id, payload: p.payload });
    }),
    delete: vi.fn(async (name: string, args: { points: Array<number | string> }) => {
      const col = cols.get(name);
      if (!col) throw notFound();
      for (const id of args.points) col.delete(String(id));
    }),
    search: vi.fn(async (name: string) => {
      const col = cols.get(name);
      if (!col) throw notFound();
      return [...col.values()].map((p, i) => ({ id: p.id, score: 1 - i * 0.01, payload: p.payload }));
    }),
  };
}

/** Embedder double: constant 384-d vectors; records every batch. */
export function makeFakeEmbedder() {
  const calls: string[][] = [];
  const embedder = vi.fn(async (texts: string[]) => {
    calls.push(texts);
    return texts.map(() => new Array(384).fill(0.1));
  });
  return { embedder, calls, embeddedCount: () => calls.reduce((n, c) => n + c.length, 0) };
}
