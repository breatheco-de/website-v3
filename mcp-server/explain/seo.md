# SEO (meta, clusters, search engines)

Call this topic for page SEO meta, topic clusters, GSC/Bing reads, and live meta gates.

YAML merge / content types → topic `content_system`. Page funnel stage / money pages → topic `funnel`.

## Page intent (not seo.intent)

`seo.intent` was removed. Page funnel stage lives on `_common.yml` as `funnel.stage` (awareness / consideration / decision / post-enrollment). **Money pages** = `funnel.stage: decision`. Inventory: `list_entries` with `is_money_page` / `funnel_stage` / `funnel_product` — call **`explain_site` topic `funnel`**.

## Tools

- `get_entry_seo`, `list_entry_seo`, `update_fields` (meta.* / seo.*)
- `list_seo_clusters`, `list_seo_cluster_entries`, `get_seo_cluster`
- `run_entry_diagnostics` with `categories: ["seo"]`

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
- **Reads (membership):** `get_entry_seo.include_in_clustering`; `get_entry_fields` injects the virtual row (`writable` only when type monitored).
- **Inventory (MCP sync):** `list_seo_clusters`, `list_seo_cluster_entries` (buckets: unclustered / partiallySet / brokenRefs / emptyHubs / clustered), `get_seo_cluster`. Rows include `sibling_locales` — loop locales yourself (no write fan-out). Trust inventory/`seo-index` immediately after `update_fields`; diagnostics cache may lag.
- **Bidirectional in-body links:** validator `seo-cluster-links` (SEO category). Hub must `<a href>` (or url field / markdown link) to members; members must link back to the hub. HTML `<a href>` in blog `content` is detected during diagnostics. Non-anchor UI does not count. Codes: `HUB_MISSING_MEMBER_LINKS`, `MEMBER_MISSING_HUB_LINK`. **Diagnostics warnings only** — `run_entry_diagnostics` (SEO category); **does not block** `publish_draft` / `promote_variant`. Live micro-saves do not run this check either.
- **Diagnostics:** MCP `run_entry_diagnostics` with `categories: ["seo"]` **narrows which validators run** (unlike staff Diagnostics scope chips, which only filter the issue list). Exactly **one** slug → sync `completed` (mode sync) with `issues[]` in the same call (no poll); 2+/unscoped → async + `get_diagnostics_job`. `content_view` may read cached/`needs_confirm`; starting a job/sync recompute needs a metrics-mutating cap. **MCP responses return a paginated `issues[]` work queue (default 50)** with `issues_offset` / `issues_limit` / `issues_next_offset` — not a full site `issuesBySlug` dump; staff Diagnostics / validation-cache still have the full set.
- **Issue workflow (`update_issue`):** MCP agents must pass `report` on **claim** (why taking the issue; min 20 chars; optional when re-claiming to refresh your TTL) and **complete** (what changed and how; min 20 chars). Staff UI one-click claim/complete has no report. Stored on validation-cache overlay + `validation_issue_*` admin events (`payload.report`). Does not push YAML or run diagnostics.
- **Derived link-index:** `{contentRoot}/link-index.json` stores outbound paths patched during `seo-cluster-links` runs — cache only, not authored SOT.

### Search engines reads (`include_search_engines`)

- **Opt-in on `get_entry_seo`:** `include_search_engines: true` (default false). Attaches `search_engines.{google,bing}` — **not** the same as `index` (seo-index topic-cluster inventory).
- **Google:** read-only from GSC URL Inspection cache (`.cache/{site}/gsc-url-inspection.json` / GCS sync). Fields: `status`, `stale` (older than 7 days), `checkedAt`, `lastCrawlAt`, `canonical_mismatch`, `resolved`, full `record`. Does **not** call Google APIs or enqueue inspect (staff SEO/GEO → Search Console does that).
- **Bing (phase 1):** always `configured: false`, `status: not_configured` + warning `bing_not_configured`. Phase 2 will use Bing Webmaster `GetUrlInfo` (thinner than GSC).
- **Variants:** omit `search_engines`; warning `search_engines_skipped_variant` (live URLs only). Variant reads may still show leftover `seo:` but writes are blocked except draft-when-unpublished; `index: null`.
- **Warnings:** `bing_not_configured`, `search_engines_stale` when Google cache is stale.
- **Non-effects:** no live API, no inspect queue, no YAML/GitHub, no diagnostics job.

### Live SEO meta gates

- **Live locale writes / publish / promote** require resolved non-empty `meta.page_title` and `meta.description` (no leftover `{{ }}`). Draft-only writes are exempt. Gate: `server/live-entry-seo-gate.ts` + `shared/validateRequiredMeta.ts`.
- **Circular trap (meta vs body):** When a micro-save **touches** required SEO meta or editor.required paths (or on publish / full replace), the gate validates those fields on the post-write merged document. If both `meta.description` and body `description` are empty strings, fixing only one side still fails the other gate. Remedy: set all missing paths in **one** multi-field write — MCP `update_fields` (or `edit-sections` with multiple `update_field` ops). Multi-entry `update_meta_fields` is meta-only and cannot set body `description`. Failures return `code: live_required_fields` + `missing_fields` and MCP `action_required: fix_live_required_fields`. Structural micro-saves with empty `touchedPaths` skip this sweep (gaps → Diagnostics).

Field-level `editor.required`, reattach gates, schema_org companions, and empty-locale rules → topic `content_system`.
