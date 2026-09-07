# Private databases (local YAML + api/remote cache reads)

Private databases may be **local** (`source.type: local` → YAML under `db/{name}/`), **api**, or **remote**.

- **Reads** (`list_database_items`, `get_database_item`): all source types (CMS cache).
- **Writes** (add/update/delete): **local only**.

## Tools

| Tool | Cap | Notes |
|---|---|---|
| `list_databases` | `databases_manage` **or** `content_edit_text` | Prefer `local_only: true` for CRUD targets |
| `list_database_items` | same | All sources; **summary** rows + global `index`; optional `refresh` |
| `get_database_item` | same | All sources; **full** row by global index; optional `refresh` |
| `add_database_item` | same | Local only; FAQ defaults + dedupe |
| `add_database_items` | same | Local only; bulk add (max 40), best-effort |
| `update_database_item` | same | Local only; prefer `expect_question` |
| `update_database_items` | same | Local only; bulk update (max 40) |
| `delete_database_item` | same | Local only; requires `confirm: true` |
| `reindex_database` | **`databases_manage` only** | After writes when `vector_search.enabled` |

Call `explain_site` topic `local_databases` before bulk FAQ database edits or when reading api/remote banks.

## Reads (all sources)

- `list_database_items` returns **summary** rows (`summary: true`): short identity/meta; omits heavy keys (`content`, `readme`, `manifest`, …) and strings longer than 240 chars. Same shape for every `limit`.
- `get_database_item` returns the **full** cached row.
- Response includes `source_type`, `local`, and `item_file` (path only when local; else `null`).
- Non-local warnings: `read_only_cache`, `index_not_writable` — `index` is for get only, not mutate.

### Optional `refresh: true`

Force rebuild via `POST /api/databases/:name/refresh` before reading.

- **Expensive** for api/remote (hits external API). Prefer default TTL cache.
- On **list**, if `page > 1`, refresh is **ignored** (`refresh_ignored_pagination`) — refresh on page 1 only.
- If refresh fails but items still load → return data + `refresh_failed` (may be stale). Hard-fail only if refresh fails **and** items cannot be read.

## Global index (critical for local mutate)

PATCH/DELETE use the position in the **full unfiltered** item array (all locales mixed).

- `list_database_items` with `locale=en` still returns each row’s **global** `index`.
- Never use “position on this filtered page” as the mutate index.
- **Recommended:** pass `expect_question` on update/delete (and each bulk update row) when the item has a `question` field so a shifted index fails closed. It is **optional** — if omitted, the tool trusts `index` alone. Mismatch → that row fails (`expect_mismatch`); re-list and retry.

## Non-local customize (overrides, not item PATCH)

MCP cannot edit upstream api/remote rows. When a content type has `database.slug` matching the bank:

1. `get_entry_fields` — provenance (original / db_override / ct_override)
2. `update_entry_field` — `level: database` (listings + pages) or `level: content_type` (page only)

Mutate tools on non-local DBs **fail** with `next_actions` pointing at those tools when a linked CT + row `slug` are available. If no linked CT, overrides are not available for that bank.

## Bulk add / update (max 40, local only)

Both tools are **best-effort**: rows that pass prepare are written; other rows’ validation failures do not block successes.

- Response always includes `results[]` (one per `input_index`), `wrote_count`, `failed_count`.
- **Retry only failed/aborted `input_index` rows** — not the full original batch.
- Length `< 1` or `> 40` → immediate fail (no writes).
- At most **one** reindex after the batch if any row wrote and `reindex: true`.

### `add_database_items`

- FAQ: per-item defaults; **first wins** on duplicate `(locale, normalized question)` vs existing DB or earlier rows in the batch.
- One HTTP `POST { items }` for all prepared rows.

### `update_database_items`

- Args: `updates: { index, item, expect_question? }[]`.
- Working-copy simulation in **`input_index` order** — FAQ renames/swaps in one batch can succeed.
- Same global `index` twice → first wins; later `duplicate_index`.
- Two+ rows that would land on the same FAQ key → **both fail** (`duplicate`), not first-wins.
- Sequential PATCH (API has no bulk PATCH). PATCH does **not** shift indices.
- Mid-batch HTTP failure → stop; remaining prepared rows get `aborted`. Reindex once if `wrote_count > 0`.

**Does not:** bulk delete; push content sync; change single-item tool contracts.

## FAQ database (`frequently_asked_questions`)

File: `db/frequently_asked_questions/faqs.yml` (`results_path: faqs`).

There is **no** legacy `faqs/{locale}.yml` bank — page sections and AI tools use this DB only.

Required on add: `question`, `answer`, `locale`.

Defaults if omitted: `last_updated` (today), `priority: 2`, `locations: ["all"]`.

Rejects duplicate `(locale, normalized question)`. Does **not** auto-create sibling locales.

Warns if `related_features.length > 2`.

### FAQ sections (listing)

`type: faq` is a listing component (`behaviors.listing` → `dynamic_entries`). Author filters under `dynamic_entries.permanent_filters` (e.g. topics / locations). On location pages use `value: "{{ entry.slug }}"` for the `locations` filter. **Do not** author section-level `related_features` (save rejects). FAQPage JSON-LD uses the same post-`resolveDynamicEntries` `items` as the accordion (plus `item_overrides.hideOnLocations`).

## Side effects and non-effects

**Does (writes):** write YAML; `clearCache`; `markFileAsModified` (content sync dirty).

**Does not:** push content GitHub; edit page sections / `hardcoded_entries` / `dynamic_entries`; auto-reindex (unless `reindex: true` and caller has `databases_manage`); edit upstream api/remote source rows.

When vector search is enabled, mutate responses `next_actions` → `reindex_database` until reindexed.

## Delete safety

Without `confirm: true` → `action_required: confirm_delete` plus usage summary from `GET /api/databases/:name/usage` when available. Hard delete only.

## Related

- Staff UI: Private Databases + FAQ section editor (+ field overrides on DB-backed content types).
- HTTP: `/api/databases/:name/items` (writes local only); `POST .../refresh` force cache rebuild.
- Semantic search: `explain_site` topic `semantic_search`.

## When to call this topic

Before adding/updating/deleting local DB rows (especially FAQ), listing api/remote banks, or when an agent needs the global-index / summary-vs-full / refresh / override mental model.
