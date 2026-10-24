# Semantic search (Qdrant)

Private databases can search by meaning, not only exact keywords. That requires a running Qdrant vector store plus a local embedding model.

## Stack

| Piece | Detail |
|---|---|
| Vector DB | Qdrant (`QDRANT_URL`, default `http://localhost:6333`) |
| Embeddings | Local `Xenova/all-MiniLM-L6-v2` (384-d, Cosine) — **not** OpenRouter |
| Search helper | `server/database-search.ts` — shared by dashboard, FAQ `dynamic_entries.search`, future callers |
| Vector runtime | `server/vector-search.ts` (`syncIndex`, `search`, `vectorItemKey`) |
| Index job | Sidequest `vector_index_sync` on queue `vector_index` (concurrency 1) — `server/jobs/definitions/vector-index-sync.ts` |
| Enqueue | `server/vector-index-queue.ts` (`enqueueVectorIndexSync`; web + worker only) |
| Job state | `server/db-job-state.ts` → `{contentRoot}/.db-job-state.json` (shared by web and worker; merge on write) |

## Indexing (incremental, in the worker)

- **Collection name:** `<contentFolder>__<dbName>` (e.g. `site_4geeks-com__testimonials`). Legacy bare-name collections (`<dbName>`) keep serving searches until the site-scoped one is `ready`, then the job deletes them.
- **Row key:** `slug`, else `id`, else `c:` + sha1(locale + embedded text). Point id derives from the key. Two identical rows (same locale + text) share one point.
- **Diff:** payload `text_hash` = sha1(model + fields + text). Only new/changed rows are embedded (batches of 32); rows no longer present are deleted. A model or `fields` change re-embeds everything in place. No delete-and-recreate except on vector-size mismatch or admin rebuild.
- **Re-check:** after a pass the job compares the database copy's `fetched_at`; if it changed mid-run it runs again (max 3 passes).
- **Failures:** the job throws; Sidequest retries 5 attempts with exponential backoff (~2, 4, 8, 16 min). Final failure → index state `error`. Web re-queues when it sees Qdrant recover.
- **Worker down:** jobs wait in the queue; status shows `waiting_worker`. The web process never embeds a whole database.
- **Rebuild from scratch:** admin UI only (`POST /api/admin/qdrant/rebuild/:name`); sets `ready:false` → keyword matching until done. Not exposed via MCP.

## Triggers (all enqueue only)

| Trigger | Where |
|---|---|
| Fresh fetch of a vector-enabled database (TTL refresh, edits, content pull) | `DatabaseManager.fetchItems` |
| `vector_search` enabled or `fields` changed (UI or `create_or_update_database`) | `DatabaseManager.update` |
| Re-index button / `reindex_database` | `POST /api/databases/:name/reindex` |
| Startup / Qdrant recovered: collection missing, not ready, or point count ≠ last total | `server/vector-index-reconcile.ts` (retries every 60 s until Qdrant answers) |
| Search finds no ready collection or a missing one | `searchDatabaseItems` |

Turning vector search off keeps the collection (Qdrant page labels it "Not in use"). Deleting a database deletes its collections.

## Shared helper + cache

`searchDatabaseItems(dbName, q, { locale, limit })`:

- **Normalize query:** trim, lower-case, collapse whitespace before cache key.
- **Ceiling:** always search/cache at limit **100**; callers slice.
- **Lookup:** L1 memory → L2 GCS (`{contentFolder}/db-search-cache/{dbName}/{hash}.json`) → live vector/keyword → write-through L1+GCS when `semantic: true`.
- **Do not cache** keyword fallback (`semantic: false`).
- **Invalidate:** a sync that changed rows clears the GCS prefix and stamps index `changedAt`; each process drops L1 entries (and ignores GCS entries) written before `changedAt`. Unchanged syncs clear nothing. TTL ~7 days.
- **Collection choice:** ready site-scoped collection → else legacy collection → else keyword fallback (`semantic_index_empty`) plus an enqueue. A partially built collection is never searched.
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

Staff enable fields under Private Databases → Settings → Field Mappings (this queues the first sync). Re-index via `POST /api/databases/:name/reindex` or the Qdrant settings UI.

## Staff / ops

| What | Where |
|---|---|
| Health UI | `/private/settings/ai/qdrant` |
| Status API | `GET /api/admin/qdrant/status` (admin auth) — host, port, error, collections, per-DB index jobs |
| Dashboard | `http://localhost:6333/dashboard` (local default) |
| FAQ Props | Sparkles popover → `dynamic_entries.search` |
| Item CRUD (MCP) | `explain_site` topic `local_databases` — reindex after bank writes |
| Definition patches | `create_or_update_database` patches that enable/change `vector_search` auto-queue the sync (warning `vector_index_auto_queued`); no `reindex_database` needed |

**VPS:** pm2 runs the Qdrant binary next to web / MCP / Sidequest (`ecosystem.config.cjs`), storage `.cache/qdrant-storage` (persistent across deploys). No Docker.

Local only — Docker example:

```bash
docker run -d --name qdrant -p 6333:6333 -p 6334:6334 qdrant/qdrant:v1.13.4
```

Locally the index job also needs the worker: `npm run sidequest`.

## When to call this topic

Call `explain_site` with `semantic_search` before changing vector indexing, database search fallbacks/cache, FAQ section search, Qdrant wiring, or the AI Settings Qdrant page. After local DB item CRUD, see `local_databases` and call `reindex_database` when needed (definition patches auto-queue).
