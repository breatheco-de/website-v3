import { QdrantClient } from "@qdrant/js-client-rest";
import { createHash } from "crypto";
import { setJobState } from "./db-job-state";
import { child } from "./logger";
const log = child({ module: "vector-search" });



const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const VECTOR_SIZE = 384;
const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
const BATCH_SIZE = 32;

const AVAILABILITY_TTL_MS = 30_000;

let qdrantClient: QdrantClient | null = null;
let _embedder: ((texts: string[]) => Promise<number[][]>) | null = null;
let _embedderLoading: Promise<void> | null = null;
let _available: boolean | null = null;
let _availabilityCheckedAt = 0;

function getQdrantClient(): QdrantClient {
  if (!qdrantClient) {
    qdrantClient = new QdrantClient({ url: QDRANT_URL });
  }
  return qdrantClient;
}

async function getEmbedder(): Promise<(texts: string[]) => Promise<number[][]>> {
  if (_embedder) return _embedder;

  if (!_embedderLoading) {
    _embedderLoading = (async () => {
      const { pipeline, env } = await import("@xenova/transformers");
      env.allowLocalModels = false;
      env.cacheDir = ".cache/xenova-models";
      const pipe = await pipeline("feature-extraction", EMBEDDING_MODEL);

      _embedder = async (texts: string[]): Promise<number[][]> => {
        const output = await pipe(texts, { pooling: "mean", normalize: true });
        const data: number[][] = [];
        const dims = output.dims;
        const batchSize = dims[0];
        const vecSize = dims[dims.length - 1];
        for (let i = 0; i < batchSize; i++) {
          data.push(Array.from(output.data.slice(i * vecSize, (i + 1) * vecSize) as Float32Array));
        }
        return data;
      };

      log.info(`[vector-search] Local embedding model "${EMBEDDING_MODEL}" loaded`);
    })();
  }

  await _embedderLoading;
  return _embedder!;
}

export async function isAvailable(): Promise<boolean> {
  const now = Date.now();
  if (_available !== null && now - _availabilityCheckedAt < AVAILABILITY_TTL_MS) {
    return _available;
  }
  try {
    const client = getQdrantClient();
    await client.getCollections();
    _available = true;
  } catch {
    _available = false;
  }
  _availabilityCheckedAt = Date.now();
  return _available;
}

function resetAvailabilityCache(): void {
  _available = null;
  _availabilityCheckedAt = 0;
}

export interface VectorSearchCollectionStatus {
  name: string;
  points_count: number;
}

export interface VectorSearchStatus {
  available: boolean;
  url: string;
  host: string;
  port: number;
  embedding_model: string;
  vector_size: number;
  distance: "Cosine";
  error: string | null;
  collections: VectorSearchCollectionStatus[];
  embedder_loaded: boolean;
}

function parseQdrantEndpoint(url: string): { host: string; port: number } {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname || "localhost";
    const port =
      parsed.port !== ""
        ? Number(parsed.port)
        : parsed.protocol === "https:"
          ? 443
          : 6333;
    return { host, port: Number.isFinite(port) ? port : 6333 };
  } catch {
    return { host: "localhost", port: 6333 };
  }
}

/** Fresh Qdrant health check for admin UI — bypasses the availability TTL cache. */
export async function getStatus(): Promise<VectorSearchStatus> {
  resetAvailabilityCache();
  const { host, port } = parseQdrantEndpoint(QDRANT_URL);
  const base: Omit<VectorSearchStatus, "available" | "error" | "collections"> = {
    url: QDRANT_URL,
    host,
    port,
    embedding_model: EMBEDDING_MODEL,
    vector_size: VECTOR_SIZE,
    distance: "Cosine",
    embedder_loaded: _embedder !== null,
  };

  try {
    const client = getQdrantClient();
    const listed = await client.getCollections();
    const collections: VectorSearchCollectionStatus[] = [];

    for (const col of listed.collections ?? []) {
      try {
        const info = await client.getCollection(col.name);
        collections.push({
          name: col.name,
          points_count: info.points_count ?? 0,
        });
      } catch {
        collections.push({ name: col.name, points_count: 0 });
      }
    }

    _available = true;
    _availabilityCheckedAt = Date.now();

    return {
      ...base,
      available: true,
      error: null,
      collections,
    };
  } catch (err) {
    _available = false;
    _availabilityCheckedAt = Date.now();
    return {
      ...base,
      available: false,
      error: err instanceof Error ? err.message : String(err),
      collections: [],
    };
  }
}

function collectionName(dbName: string): string {
  return dbName;
}

async function ensureCollection(dbName: string): Promise<void> {
  const client = getQdrantClient();
  const name = collectionName(dbName);
  try {
    const info = await client.getCollection(name);
    const existingSize = (info.config?.params?.vectors as { size?: number } | undefined)?.size;
    if (existingSize !== undefined && existingSize !== VECTOR_SIZE) {
      log.info(`[vector-search] Collection "${name}" has vector size ${existingSize}, expected ${VECTOR_SIZE} — recreating`);
      await client.deleteCollection(name);
      throw new Error("recreate");
    }
  } catch {
    await client.createCollection(name, {
      vectors: { size: VECTOR_SIZE, distance: "Cosine" },
    });
    log.info(`[vector-search] Created collection "${name}" (size=${VECTOR_SIZE})`);
  }
}

async function recreateCollection(dbName: string): Promise<void> {
  const client = getQdrantClient();
  const name = collectionName(dbName);
  try { await client.deleteCollection(name); } catch {}
  await client.createCollection(name, {
    vectors: { size: VECTOR_SIZE, distance: "Cosine" },
  });
  log.info(`[vector-search] Recreated collection "${name}" (size=${VECTOR_SIZE})`);
}

function buildText(item: Record<string, unknown>, fields: string[]): string {
  return fields
    .map((f) => {
      const val = item[f];
      if (val === null || val === undefined) return "";
      if (typeof val === "object") return JSON.stringify(val);
      return String(val);
    })
    .filter(Boolean)
    .join(" ");
}

async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const embed = await getEmbedder();
  return embed(texts);
}

function toQdrantId(raw: unknown, fallback: number): number | string {
  if (raw === undefined || raw === null) return fallback;
  const str = String(raw);
  const asNum = Number(str);
  if (Number.isInteger(asNum) && asNum > 0 && String(asNum) === str) return asNum;
  const h = createHash("md5").update(str).digest("hex");
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}

function itemId(item: Record<string, unknown>, index: number): number | string {
  const raw = item.slug ?? item.id;
  return toQdrantId(raw, index + 1);
}

export async function indexItems(
  dbName: string,
  items: Record<string, unknown>[],
  fields: string[]
): Promise<void> {
  if (!(await isAvailable())) {
    log.info(`[vector-search] Qdrant not available — skipping index for "${dbName}"`);
    return;
  }

  setJobState(dbName, "index", {
    status: "running",
    fetched: 0,
    total: items.length,
    startedAt: new Date().toISOString(),
  });

  try {
    await recreateCollection(dbName);
    const client = getQdrantClient();
    const name = collectionName(dbName);
    let indexed = 0;

    for (let start = 0; start < items.length; start += BATCH_SIZE) {
      const batch = items.slice(start, start + BATCH_SIZE);
      const texts = batch.map((item) => buildText(item, fields));
      const embeddings = await generateEmbeddings(texts);

      const points = batch.map((item, i) => ({
        id: itemId(item, start + i),
        vector: embeddings[i],
        payload: {
          _idx: start + i,
          slug: String(item.slug ?? item.id ?? start + i),
          locale: typeof item.locale === "string" ? item.locale
            : typeof item.language === "string" ? item.language
            : typeof item.lang === "string" ? item.lang
            : null,
        },
      }));

      await client.upsert(name, { points });
      indexed += batch.length;
      setJobState(dbName, "index", {
        status: "running",
        fetched: indexed,
        total: items.length,
      });
      log.info(
        `[vector-search] Indexed batch ${Math.floor(start / BATCH_SIZE) + 1} (${batch.length} items) for "${dbName}"`
      );
    }

    setJobState(dbName, "index", {
      status: "done",
      fetched: items.length,
      total: items.length,
      finishedAt: new Date().toISOString(),
    });
    log.info(`[vector-search] Indexed ${items.length} items for "${dbName}"`);
    try {
      const { invalidateDatabaseSearchCache } = await import("./database-search");
      await invalidateDatabaseSearchCache(dbName);
    } catch (invErr) {
      log.warn({ err: invErr, dbName }, "[vector-search] Search cache invalidate failed");
    }
  } catch (err) {
    setJobState(dbName, "index", {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      finishedAt: new Date().toISOString(),
    });
    log.error({ err: err }, `[vector-search] Failed to index "${dbName}":`);
    resetAvailabilityCache();
  }
}

export async function upsertItem(
  dbName: string,
  item: Record<string, unknown>,
  fields: string[],
): Promise<void> {
  if (!(await isAvailable())) return;
  try {
    await ensureCollection(dbName);
    const client = getQdrantClient();
    const name = collectionName(dbName);
    const text = buildText(item, fields);
    const [vector] = await generateEmbeddings([text]);
    await client.upsert(name, {
      points: [
        {
          id: itemId(item, 0),
          vector,
          payload: {
            slug: String(item.slug ?? item.id ?? ""),
            status: typeof item.status === "string" ? item.status : null,
          },
        },
      ],
    });
  } catch (err) {
    log.warn({ err, dbName }, "[vector-search] upsertItem failed");
    resetAvailabilityCache();
  }
}

export interface SearchResult {
  slug: string;
  score: number;
  _idx?: number;
}

export async function search(
  dbName: string,
  query: string,
  limit = 20,
  localeFilter?: string
): Promise<SearchResult[]> {
  if (!(await isAvailable())) {
    return [];
  }

  try {
    const client = getQdrantClient();
    const name = collectionName(dbName);

    const [queryEmbedding] = await generateEmbeddings([query]);

    const filter =
      localeFilter
        ? {
            must: [
              {
                key: "locale",
                match: { value: localeFilter },
              },
            ],
          }
        : undefined;

    const results = await client.search(name, {
      vector: queryEmbedding,
      limit,
      filter,
      with_payload: true,
    });

    return results.map((r) => {
      const payload = r.payload as Record<string, unknown> | null | undefined;
      return {
        slug: String(payload?.slug ?? r.id),
        score: r.score,
        _idx: typeof payload?._idx === "number" ? payload._idx : undefined,
      };
    });
  } catch (err) {
    log.error({ err: err }, `[vector-search] Search failed for "${dbName}":`);
    resetAvailabilityCache();
    return [];
  }
}
