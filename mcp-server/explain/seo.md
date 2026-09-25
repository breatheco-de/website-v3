# SEO (meta, clusters, search engines)

Call this topic for page SEO meta, topic clusters, GSC/Bing reads, organic traffic, and live meta gates.

YAML merge / content types → topic `content_system`. Page funnel stage / money pages → topic `funnel`.

## Page intent (not seo.intent)

`seo.intent` was removed. Page funnel stage lives on `_common.yml` as `funnel.stage` (awareness / consideration / decision / post-enrollment). **Money pages** = `funnel.stage: decision`. Inventory: `list_entries` with `is_money_page` / `funnel_stage` / `funnel_product` — call **`explain_site` topic `funnel`**.

## Refresh tier (`seo.refresh_tier`)

Fact-staleness class for **substantive** content refreshes — **not** GSC traffic `decay` opportunities and **not** diagnostics cache `freshness`.

| Value | When to use |
|---|---|
| `fast` | Pricing, tool versions, “best X in 2026”, model/bench/salary comps |
| `medium` | Program / landing / cluster hubs |
| `evergreen` | Concept explainers (closures, OAuth, …) — only when the underlying fact moves |

**Rules**

- Per locale (no auto-copy on translate). Set when enabling SEO clustering / when topic nature is known; revisit when the page angle changes.
- Staff UI shows the control only when **Include in SEO clustering** is on; then a tier is required (no unset).
- Cannot clear (`null` / reset forbidden) — change only by picking another tier. Omit the field to leave unchanged.
- Mirrored on `seo-index.json` when the entry has an SEO signal; tier alone does not create an inventory row.
- Does not bump `updated_at`. Not a publish gate for pages outside inventory.
- **Pick help:** `get_entry_fields` with `fields: ["seo.refresh_tier"]` → `fill_intent`; this topic for the full tree.
- **List:** `list_entries` `refresh_tier: fast|medium|evergreen|unset` filters **seo-index only** (`unset` = inventory row missing a tier). Zero index matches → empty list (never the unfiltered catalog).

## Tools

- `get_entry_seo`, `list_entry_seo`, `update_fields` (meta.* / seo.*)
- `list_entries` with optional `refresh_tier` filter (inventory)
- `get_or_refresh_seo_research` — cache-first SEO research (budgets; no YAML `kw_*`)

| Action | When | Credits (approx) | TTL |
|---|---|---|---|
| `keyword_metrics` | Volume/difficulty for main_keyword | 5 | 7d |
| `serp` | Live SERP snapshot for a query | 2 | 7d |
| `keyword_ideas` | Expand a seed into demand ideas | 3 | 7d |
| `competitors` | Rival domains (domain or seeds) | 7 | 14d |
| `keyword_gaps` | Gaps vs rivals (needs `competitors[]`) | 12 | 14d |

Warn band → `confirm_seo_research_budget`; 100% → exhausted. Not a substitute for `get_organic_traffic` (measured GSC).
- `list_seo_clusters`, `list_seo_cluster_entries`, `get_seo_cluster`
- `get_organic_traffic` — GSC clicks/impressions (day cache / site BigQuery); not inspection, not planning volume
- `get_analytics_report` — GA4 behavioral reports (BigQuery export); requires `metrics_view` — see topic `analytics`
- `run_entry_diagnostics` with `categories: ["seo"]`

### Organic traffic (`get_organic_traffic`)

- **One mode per call:** `site` | `paths` | `clusters` | `opportunities` | `queries` | `leaderboard`. Requires `metrics_view` or `seo_edit`.
- **Date window (`start` / `end`):** For `site` | `paths` | `clusters` | `queries` | `leaderboard` — both YYYY-MM-DD or neither; omit → last 28 complete GSC days; clamp `end` to latest complete day; max span **90**. Longer → hard fail (use OpenRush `get_search_performance` or another specialized Search Console / SEO API). Entirely after latest complete day → hard fail (retry with an earlier `end`). Missing day-cache files inside a valid window → soft `incomplete` (do not treat zeros as definitive without checking flags). Response returns `window`, `days_in_window`, `incomplete`.
- **`opportunities` + dates:** Hard fail if `start` or `end` is set — omit dates; use `decay_window` (7|28) instead.
- **site:** Whole-site KPI from BigQuery site totals (cached ~1h). `market` ignored (`market_ignored_for_mode`). Same calendar window can disagree with paths/clusters/leaderboard (day cache) — not a bug (`organic_site_vs_paths_source` when custom dates).
- **paths:** 1–50 public paths or absolute URLs after dedupe (not slugs). Soft partial: `traffic: null` + `missing_paths`; empty array fails. Resolve live URLs via `get_entry_seo.urls` then retry.
- **clusters:** 1–25 hub ids / pillar paths. Per-hub traffic + `selection_totals` over **unique paths** (`selection_not_site` — not site-wide). Unknown hubs → `unknown_hubs` + `partial_batch`.
- **opportunities:** Flattened Diagnostics cards into `items[]` with `kind` (`page2` | `low_ctr` | `link_gaps` | `decay` | `cannibalization` | `missing_serp`), paginated (`opportunities_limit` / `opportunities_offset`). Read-only (`pullLatest: false`); no day backfill / SERP refresh.
- **queries:** GSC-style query-text search. Required `query_contains` (min 2 chars). Optional `match` (`contains` default | `equals` | `starts_with`), `start`/`end` (same window rules as above), `market`, `limit`/`offset`, `pages_per_query` (default 5, max 15). BigQuery first; day-cache fallback (`organic_from_day_cache` — may miss keep-filtered long-tail). Rows grouped by query with nested landing `pages[]`. `selection_totals` = **all matches in window** (not just the page). Empty match → soft ok + `queries_no_matches`. `include_series` ignored (`series_ignored_for_mode`).
- **leaderboard:** Top day-cache paths (highest first; no bottom/`order` in v1). `sort_by` `clicks` (default) | `impressions`; optional `path_prefix` (normalize via path key, then exact-or-descendant — e.g. `/en/blog`); `limit` default 25 max 50 + `offset`/`next_offset`/`total`. Soft-resolve `content_type`/`slug`/`locale` when known. `selection_totals` = filtered universe (not the page). Prefer over batching `paths` for “top pages by traffic.” Warning `leaderboard_day_cache_universe` — not full CMS inventory / not zero-traffic finder. Valid prefix with no matches → soft ok + `path_prefix_no_matches`; unnormalizable prefix → hard fail. `include_series` ignored.
- **Series:** `include_series` default false. Allowed for `site`, or paths/clusters when batch ≤ 5; else `series_skipped_batch_too_large`. Ignored for `queries` / `leaderboard`.
- **Unconfigured:** Soft ok with `configured: false` + `organic_not_configured` (not a fake zero without the flag).
- **Non-effects:** Not URL Inspection (`include_search_engines`); not `keyword_metrics` / `kw_monthly_volume`.
- **market:** Honored for `paths` / `clusters` / `queries` / `leaderboard`. Ignored for `site` / `opportunities`.
### SEO clustering (per-entry + hub inventory)

- **Write layer:** Cluster `seo:` may be written only on live `{locale}.yml`, or on `draft.{locale}.yml` when the entry has **no** live locales yet. A/B experiment variants are forbidden (`seo_variant_forbidden`). Draft-while-live is forbidden (`seo_draft_while_live_forbidden`). Do not set SEO on a variant then promote — promote over live **keeps live `seo:`** (`seo_not_promoted_from_variant`). First `publish_draft` / go-live with no live file still brings draft SEO onto live.
- **Index sync:** Live SEO writes and first publish/promote patch `{contentRoot}/seo-index.json` in-request. Unpublish/delete remove the entry key. Diagnostics runs that include `seo-cluster` / `seo-cluster-links` sync-ensure the index before validators (no Sidequest wait). No locale fan-out — loop locales yourself.
- **Type gate:** `seo_monitoring.enabled` on the content type in `content-types.yml` (staff Content Type manage). Omitted = off. MCP cannot toggle the type flag.
- **Per-entry toggle (MCP):** virtual `seo.include_in_clustering` (boolean, never YAML). Prefer this over raw null. Requires type monitoring on.
  - `false` → expands to `seo.pillar_path: null` + `seo.is_pillar: false` (same as staff “Include in SEO clustering” off).
  - `true` → requires membership after merge: non-empty `seo.pillar_path` **or** `seo.is_pillar: true` (`main_keyword` optional).
  - Conflict: `false` + non-null `seo.pillar_path` in the same `update_fields` → reject.
- **Raw opt-out:** `seo.pillar_path: null` still works; MCP warns `seo_cluster_monitoring_disabled`. Empty/missing path = cluster gap, not opt-out.
- **Cluster gap codes (`ORPHAN_PAGE` / `PARTIALLY_SET_CLUSTER`):** Platform catalog adds `help`, dense `suggestion`, and `next_actions` on diagnostics / `validation_issues`. Optional site markdown `{contentRoot}/validation-issue-context/seo-cluster/{CODE}.md` appears as advisory `staff_context` when non-empty. While those issues are open, `update_fields` requires `confirm_cluster_resolution: true` to set `seo.is_pillar: true` or opt out; joining a hub with non-null `seo.pillar_path` does not need confirm.
- **Keyword research (`SEO_KEYWORD_RESEARCH_INCOMPLETE`):** Prefer SEO research. MCP `get_or_refresh_seo_research` (`action: keyword_metrics`) upserts the keyword cache and does **not** write YAML. When research is configured, `update_fields` of `seo.kw_monthly_volume` / `seo.kw_difficulty` is rejected (`seo_research_use_openrush`). When off, those YAML writes require `seo_research_source: staff_provided|external:<name>` (`seo_research_source_required` otherwise). Do not invent metrics; release blocked if no reliable source. Staff UI may still set YAML by hand. Also supports `serp`, `keyword_ideas`, `competitors`, `keyword_gaps` with TTL caches and session/daily credit budgets (`confirm_seo_research_budget` in the warn band).
- **Reads (membership):** `get_entry_seo.include_in_clustering`; `get_entry_fields` with `fields: ["seo.include_in_clustering"]` returns the virtual row (`writable` only when type monitored; not auto-added with other seo.*).
- **Inventory (MCP sync):** `list_seo_clusters`, `list_seo_cluster_entries` (buckets: unclustered / partiallySet / brokenRefs / emptyHubs / clustered), `get_seo_cluster`. Rows include `sibling_locales` — loop locales yourself (no write fan-out). Trust inventory/`seo-index` immediately after `update_fields`; diagnostics cache may lag.
- **Bidirectional in-body links:** validator `seo-cluster-links` (SEO category). Hub must `<a href>` (or url field / markdown link) to members; members must link back to the hub. HTML `<a href>` in blog `content` is detected during diagnostics. Non-anchor UI does not count. Codes: `HUB_MISSING_MEMBER_LINKS`, `MEMBER_MISSING_HUB_LINK`. **Diagnostics warnings only** — `run_entry_diagnostics` (SEO category); **does not block** `publish_draft` / `promote_variant`. Live micro-saves do not run this check either.
- **Diagnostics:** MCP `run_entry_diagnostics` with `categories: ["seo"]` **narrows which validators run** (unlike staff Diagnostics scope chips, which only filter the issue list). Any recompute (including exactly **one** slug) is **async**: returns `job_id` → poll `get_diagnostics_job` (do not wait on the start call). `content_view` may read cached/`needs_confirm`; starting a job needs a metrics-mutating cap. **MCP responses return a paginated `open_issues[]` open work queue (default 50)** with `open_issues_offset` / `open_issues_limit` / `open_issues_next_offset` — soft-completed and other-author claims are excluded unless `issue_status` is `completed`, `claimed`, or `all`. Not a full site `issuesBySlug` dump; staff Diagnostics / validation-cache still have the full set. Bulk/unscoped `open_issues[]` is not authoritative for live failures — prefer one-slug scoped jobs + poll before claim/edit.
- **Issue workflow (`update_issue`):** MCP agents must pass `report` on **claim** (why taking the issue; min 20 chars; optional when re-claiming to refresh your TTL) and **complete** (what changed and how; min 20 chars). Staff UI one-click claim/complete has no report. Stored on validation-cache overlay + `validation_issue_*` admin events (`payload.report`). Does not push YAML or run diagnostics.
- **Derived link-index:** `{contentRoot}/link-index.json` stores outbound paths patched during `seo-cluster-links` runs — cache only, not authored SOT.

### Search engines reads (`include_search_engines`)

- **Opt-in on `get_entry_seo`:** `include_search_engines: true` (default false). Attaches `search_engines.{google,bing}` — **not** the same as `index` (seo-index topic-cluster inventory).
- **Google:** read-only from GSC URL Inspection cache (`.cache/{site}/gsc-url-inspection.json` / GCS sync). Fields: `status`, `stale` (older than 7 days), `checkedAt`, `lastCrawlAt`, `canonical_mismatch`, `resolved`, full `record`. Does **not** call Google APIs or enqueue inspect (staff SEO/GEO → Search Console does that).
- **Bing (phase 1):** always `configured: false`, `status: not_configured` + warning `bing_not_configured`. Phase 2 will use Bing Webmaster `GetUrlInfo` (thinner than GSC).
- **Variants:** omit `search_engines`; warning `search_engines_skipped_variant` (live URLs only). Variant reads may still show leftover `seo:` but writes are blocked except draft-when-unpublished; `index: null`.
- **Warnings:** `bing_not_configured`, `search_engines_stale` when Google cache is stale.
- **Non-effects:** no live API, no inspect queue, no YAML/GitHub, no diagnostics job.

### Page-level vs locale SEO fields

`meta.robots`, `meta.priority` and `meta.change_frequency` are page-level (`_common.yml`, every locale). `meta.page_title`, `meta.description`, other `meta.*` and `seo.*` are per locale. A proposal that sets `meta.robots` changes indexing for every locale (warning `common_fields_all_languages`). See `explain_site` topic `content_system` → Field scope.

## Live SEO meta gates

- **Live locale writes / publish / promote** require resolved non-empty `meta.page_title` and `meta.description` (no leftover `{{ }}`). Draft-only writes are exempt. Gate: `server/live-entry-seo-gate.ts` + `shared/validateRequiredMeta.ts`.
- **Diagnostics `meta` validator** resolves site vars (`global.*` / `brand.*`) the same way as that live gate (`resolveAllTemplateVars` with `skipSiteVars: false`) before required-title/description checks — resolved templates are not false `MISSING_*` / `META_USES_GLOBAL_VAR`.
- **Circular trap (meta vs body):** When a micro-save **touches** required SEO meta or editor.required paths (or on publish / full replace), the gate validates those fields on the post-write merged document. If both `meta.description` and body `description` are empty strings, fixing only one side still fails the other gate. Remedy: set all missing paths in **one** multi-field write — MCP `update_fields` (or `edit-sections` with multiple `update_field` ops). Multi-entry `update_entry_attributes` is safe attrs only (`meta.*` / `funnel.*`) and cannot set body `description`. Failures return `code: live_required_fields` + `missing_fields` and MCP `action_required: fix_live_required_fields`. Structural micro-saves with empty `touchedPaths` skip this sweep (gaps → Diagnostics).

Field-level `editor.required`, reattach gates, schema_org companions, and empty-locale rules → topic `content_system`.
