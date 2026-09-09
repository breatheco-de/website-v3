# Semantic search (Qdrant)

Private databases can search by meaning, not only exact keywords. That requires a running Qdrant vector store plus a local embedding model.

## Stack

| Piece | Detail |
|---|---|
| Vector DB | Qdrant (`QDRANT_URL`, default `http://localhost:6333`) |
| Embeddings | Local `Xenova/all-MiniLM-L6-v2` (384-d, Cosine) — **not** OpenRouter |
| Search helper | `server/database-search.ts` — shared by dashboard, FAQ `dynamic_entries.search`, future callers |
| Vector runtime | `server/vector-search.ts` |
| Job state | `server/db-job-state.ts` → `{contentRoot}/.db-job-state.json` |

Collection name = database name. Indexing recreates the collection and upserts points in batches of 32.

## Shared helper + cache

`searchDatabaseItems(dbName, q, { locale, limit })`:

- **Normalize query:** trim, lower-case, collapse whitespace before cache key.
- **Ceiling:** always search/cache at limit **100**; callers slice.
- **Lookup:** L1 memory → L2 GCS (`{contentFolder}/db-search-cache/{dbName}/{hash}.json`) → live vector/keyword → write-through L1+GCS when `semantic: true`.
- **Do not cache** keyword fallback (`semantic: false`).
- **Invalidate:** successful reindex clears L1 + GCS prefix; TTL ~7 days.
- **Dev without GCS:** memory-only.

FAQ sections store `dynamic_entries.search`. Resolve path: search ∩ permanent_filters → filter-only backfill to section limit → hardcoded first. Sync `resolveFaqItems` (JSON-LD) reads L1 only; cold → keyword.

## Search HTTP

`GET /api/databases/:name/search?q=…`

- Healthy semantic path: `{ items, count, semantic: true, scores }`
- Fallback: `{ semantic: false, fallback_reason, fallback_message }`
  - `vector_store_unavailable` — Qdrant unreachable
  - `semantic_index_empty` — enabled but no usable index

Job status includes `search_cache.memoryEntries` (polled). GCS object count: `GET /api/databases/:name/search-cache-stats?includeGcs=1` (on demand only).

Non-effects: embeddings do not use `OPENROUTER_API_KEY`; keyword fallback still works when Qdrant is down; FAQ Topics/Locations are **not** Qdrant payload filters (intersect after search).

## Config

Per-database YAML/config:

```yaml
vector_search:
  enabled: true
  fields: [title, description]  # fields concatenated into the embedded text
```

Staff enable fields under Private Databases → Settings → Field Mappings. Re-index via `POST /api/databases/:name/reindex` or the Qdrant settings UI.

## Staff / ops

| What | Where |
|---|---|
| Health UI | `/private/settings/ai/qdrant` |
| Status API | `GET /api/admin/qdrant/status` (admin auth) — host, port, error, collections, per-DB index jobs |
| Dashboard | `http://localhost:6333/dashboard` (local default) |
| FAQ Props | Sparkles popover → `dynamic_entries.search` |
| Item CRUD (MCP) | `explain_site` topic `local_databases` — reindex after bank writes |
| Definition patches | `create_or_update_database` patches that enable/change `vector_search` also need `reindex_database` (same as after item writes) |

Local Docker example:

```bash
docker run -d --name qdrant -p 6333:6333 -p 6334:6334 qdrant/qdrant:v1.13.4
```

## When to call this topic

Call `explain_site` with `semantic_search` before changing vector indexing, database search fallbacks/cache, FAQ section search, Qdrant wiring, or the AI Settings Qdrant page. After local DB item CRUD **or** `create_or_update_database` patches that enable/change `vector_search`, see `local_databases` and call `reindex_database` when needed.
