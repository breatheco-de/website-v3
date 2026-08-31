# Local private databases (YAML item CRUD)

Private databases may be **local** (`source.type: local` → YAML under `db/{name}/`) or **remote** (API fetch). MCP item CRUD only supports **local**.

## Tools

| Tool | Cap | Notes |
|---|---|---|
| `list_databases` | `databases_manage` **or** `content_edit_text` | Prefer `local_only: true` for CRUD targets |
| `list_database_items` | same | Each row has global `index` |
| `get_database_item` | same | By global index |
| `add_database_item` | same | FAQ defaults + dedupe |
| `add_database_items` | same | Bulk add (max 40), best-effort, per-row `results[]` |
| `update_database_item` | same | Prefer `expect_question` |
| `update_database_items` | same | Bulk update (max 40), best-effort; prefer `expect_question` per row |
| `delete_database_item` | same | Requires `confirm: true` |
| `reindex_database` | **`databases_manage` only** | After writes when `vector_search.enabled` |

Call `explain_site` topic `local_databases` before bulk FAQ database edits.

## Global index (critical)

PATCH/DELETE use the position in the **full unfiltered** item array (all locales mixed).

- `list_database_items` with `locale=en` still returns each row’s **global** `index`.
- Never use “position on this filtered page” as the mutate index.
- **Recommended:** pass `expect_question` on update/delete (and each bulk update row) when the item has a `question` field so a shifted index fails closed. It is **optional** — if omitted, the tool trusts `index` alone. Mismatch → that row fails (`expect_mismatch`); re-list and retry.

## Bulk add / update (max 40)

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

**Does:** write YAML; `clearCache`; `markFileAsModified` (content sync dirty).

**Does not:** push content GitHub; edit page sections / `hardcoded_entries` / `dynamic_entries`; auto-reindex (unless `reindex: true` and caller has `databases_manage`).

When vector search is enabled, mutate responses `next_actions` → `reindex_database` until reindexed.

## Delete safety

Without `confirm: true` → `action_required: confirm_delete` plus usage summary from `GET /api/databases/:name/usage` when available. Hard delete only.

## Related

- Staff UI: Private Databases + FAQ section editor.
- HTTP: `/api/databases/:name/items` (local only for writes).
- Semantic search: `explain_site` topic `semantic_search`.

## When to call this topic

Before adding/updating/deleting local DB rows (especially FAQ), or when an agent needs the global-index / sync / reindex / bulk mental model.
