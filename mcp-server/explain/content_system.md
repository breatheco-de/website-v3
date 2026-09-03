# Content System

All marketing content lives under the site folder from `sites.yml` (`content_folder`, e.g. `site_4geeks-com/`). Pages are YAML files grouped by content type directory. Live tables below are loaded from that folder.

## Directory layout

```
{content_folder}/
  content-types.yml       # single source of truth for all content types
  settings.yml            # site-wide settings (locales, optimization.tagmanager web_container_id + sGTM proxy,
                          # optimization.ip_normalization egress proxy at fixed /ipn/{id}/*, etc.)
                          # Cloudflare / entry-preview capture credentials are NOT stored here —
                          # env only: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN,
                          # ENTRY_PREVIEW_CAPTURE_SECRET (else SESSION_SECRET). Staff status UI:
                          # Debug Bubble → Settings → SEO/GEO → OG Image (display/test only; no writes).
                          # Legacy entry_preview keys in YAML are ignored; delete before content push.
                          # Web GTM ID is injected into the HTML shell from web_container_id (see server/gtm-web-inject.ts)
                          # IP Normalization: allowlisted destinations in settings.yml; shared secret is
                          # host env IPN_SECRET only (staff: Tracking → IP Normalization — display + Generate & copy).
                          # Empty IPN_SECRET while enabled → fail closed. Configure Constant + Request Headers
                          # in the GTM *server* container (not Stape admin).
                          # Recent /ipn calls: local .ipn-calls-state.txt (max 500), not content-repo / GitHub.
                          # Non-effect: does not call any CRM by name; side_effect of admin PUT: writes settings.yml.
  schema-org.yml          # Organization / Website (+ legacy catalogs) JSON-LD templates.
                          # Staff structured edit: Settings → SEO/GEO → Schema org; Brand tab still owns
                          # same_as / default_social_image / logos (dual write path — Brand fields not moved).
                          # Non-effect of OG capture env: does not edit schema-org.yml or Brand.
  image-registry.json     # centralized image metadata
  theme.json              # color theme tokens
  component-registry/     # versioned component schemas and examples
                          # Optional: omit when sites.yml sets inherit_components_from
                          # to another site's folder (parent-only; child must not have this dir).
                          # Platform-shared types (e.g. hero, awards_marquee, text_block, article)
                          # live under shared/component-registry/ in the app repo.
  menus/                  # menu definitions (navbar, footer, etc.)
  <type-directory>/       # one folder per content type (e.g. pages/, programs/)
    <slug>/
      _common.yml         # locale-independent fields (merged into every locale)
      en.yml              # English locale content (LIVE / published)
      es.yml              # Spanish locale content (LIVE / published)
      draft.en.yml        # unpublished draft (or any {variant}.{locale}.yml)
      versioning.yml      # optional: A/B / draft variant configuration
```

**Layout rule:** entries are always `{type-dir}/{slug}/{locale}.yml` (folder per slug). Flat files like `pages/about.en.yml` are **not** indexed. Site Manager scaffold and `create_entry` write folders only.

**sites.yml `inherit_components_from`:** optional parent `content_folder` for that site's component-registry (schema / field-editors / examples). One hop; parent must own a registry. Non-effect: does not copy registry files into the child; `create_entry` still writes YAML under the **current** site's content folder.

## Draft vs live vs variant

- **Draft entry:** folder has **no** live `{locale}.yml`. Content lives in `{variant}.{locale}.yml` (often `draft.en.yml`) + `versioning.yml` at 0%. ContentIndex skips it → public 404, not in sitemap. Create/duplicate (non-shared-layout) start this way. Publish with `publish_draft` (all remaining draft locales at once).
- **Live / published:** at least one `{locale}.yml` exists. Routable and sitemap-eligible (unless `robots: noindex`).
- **Variant (of a live page):** `{variant}.{locale}.yml` beside a live `{locale}.yml`, registered in `versioning.yml`. Traffic allocation allowed. `promote_variant` replaces live for one locale; `delete_variant` discards one locale's variant file (per-locale; blocked when allocation > 0% — staff must remove traffic first). Deleting the last draft on an unpublished entry removes the whole folder. Soft guidance: confirm with the user before promote/publish/delete.
- **All content types:** **Create/duplicate seeds exactly one locale** — multi-locale create is rejected (`create_entry`, `/api/content/create`, Create Content UI). Add translations via `translate_entry` → `draft.{locale}.yml` → promote/publish. Shared-layout types still go live immediately on first create; classic types may use draft-first create.

## Merge behavior

When a page is loaded the system performs a deep merge: `_common.yml` fields are the base and the locale file overrides them. Arrays are replaced wholesale (not appended). This means locale-specific fields override shared ones for the same key.

## Safe loading — CRITICAL

**Never use raw `yaml.load()` on content files.** Always use `contentIndex.safeYamlLoad()` or higher-level `ContentIndex` methods. The safe loader handles template expressions like `{{ single.title }}` that contain characters (e.g. `:`) that break standard YAML parsing.

On the MCP server side, use the `safeLoad()` helper from `mcp-server/lib/content.ts`.

## Content types

Types are declared in `content-types.yml`. Each entry specifies:

- `directory` — subfolder inside `{content_folder}/`
- `url_pattern` — per-locale URL templates with `:slug` placeholder
- `field_mapping` — content-type **schema** keys. Non-underscore keys are available as `{{ entry.* }}` (preferred; legacy `{{ single.* }}` still resolves on delivery; saves reject new `single.*`) and in the Fields tab (content-type fields, not SEO). Values are auto-fill sources: identity (same YAML/DB name); `{ source, default }` with required default (may be `null`); DB remap (column → schema key); `function:` computed. Mapping remaps are for **DB-attached types** and calculated fields — static YAML uses identity (schema key = YAML parent key). System identity is auto-exposed as `entry.slug` / `entry.locale` / `entry.image` / `entry.updated_at` (and legacy `single.*` equivalents) and underscore aliases (`_slug`, `_locale`, `_image`, `_updated_at`). `_hreflangs` is routing-only (not a template var). `_updated_at` is DB-mappable; on static types it is inject-only from content-hash-gated sync-state (`getFileLastmod` / SHA change). **`published_at`** is reserved **editorial** go-live (authored in `_common.yml`, always ensured in mapping): stamped once on go-live (shared-layout/blog create; draft-first on `publish_draft` / first promote); omit on draft create (missing OK, never `""`); duplicates strip source date then re-stamp if live; static Fields edits write `_common.yml` (not locale root / FO); cannot clear to empty; not tied to YAML `status`; distinct from `_updated_at`. Do not declare regular keys `slug` or `image`. **Fields writes:** static types → **top-level root keys** on the active layer file (`{locale}.yml` or `{variant}.{locale}.yml`); DB-backed types → YAML `field_overrides` bag. API path stays `.../field-overrides` (historical name). MCP `update_entry_field` (and `update_fields` with `reset:true`) return `storage: "root_key" | "field_overrides"` plus concrete path in `side_effects`. Optional `variant` must exist (no live fallback); all-draft with no variant auto-resolves to `draft.{locale}.yml`. Live SEO/required gate skips draft/variant layers.
- `database.slug` — if present, the type is DB-backed; MCP `create_entry` cannot create those rows (use the DB/admin path). Do **not** confuse with `single_template: true` (e.g. static `blog`), which is YAML + shared `template.{locale}.yml` (legacy `single.*` still loads) and **is** creatable via `create_entry`.
- `strategy` (optional until a field is required) — type-level `{ purpose, constraints? }` for staff/agents (why this content type exists). **Context only** for field `fill_intent`; never replaces per-field briefs; not Insights `insights_intent`. Any `editor.required` true|attached requires a valid strategy (`purpose` non-empty). Clear while required fields remain → `code: missing_strategy`. Read: `get_content_type_info.strategy` / `strategy_valid` / `strategy_note`. Write strategy: MCP `update_content_type` with `strategy` only (separate call from `field_action`). Write fields: same tool with `field_action` add|update|remove + `field_key` — preview (`confirm` omitted) then `confirm: true`; one field per call; cap `content_types_manage`. Static add defaults identity mapping; DB add requires `field_mapping`; remove blocked while key is in `indexes`/`unique_fields`. Non-effects: does not edit entry values or run `ensure_content_type_schema_org`. Staff: Content Type manage → Fields / Strategy.
- `layout.menu` — which navbar/footer menus to render
- `schema_org_requirements` (optional) — list of `{ schema_type }` companions every entry must have as a leading `schema_org` section (e.g. location → `LocalBusiness`, authors → `Person`). Validated by `schema-org-companions`; hard-gated on publish/promote / full locale replace (not on live micro structural saves). Coverage via `get_content_type_info`; attach missing with `ensure_content_type_schema_org` (seeds LocalBusiness from catalog / miami-usa|madrid-spain). Inspect resolved JSON-LD with `get_entry_seo` (not `get_entry_content`). Hero `course` variant separately requires a Course companion (`behaviors.schema_org.requires`).

## Active content types

<!-- @dynamic:content_types -->
<!-- /dynamic -->

## Database-backed / shared-layout types

Types with a `database.slug` key (or static types with `single_template: true`) use shared layout:

- Structure lives in each `template.{locale}.yml` (kept structurally in sync by the structured UI; legacy `single.*` still loads).
- `_common.template.yml` (legacy `_common.single.yml`) is layout defaults only — never sections.
- Empty `sections: []` stubs are invalid; new/missing locale templates should be mirrored from a sibling.
- Content props stay locale-local. Topology + `showOn*` / generic layout sync across siblings in the structured UI.
- Changing `type` / `version` / `variant` does **not** auto-replicate — update sibling locales manually.
- **Entry create:** exactly one live `{locale}.yml` (EN or ES — no primary special case). Gate: `createContentEntry` / MCP `create_entry`.
- **MCP does not auto-fan-out.** After a structural edit to one locale template, follow structured `next_actions` (exact tool name + `args_hint` + blast-radius `reason`) to update sibling `template.*.yml` files yourself. Soft prose warnings alone are not enough. Prefer `layout_target: "type_template"` (alias `"type_single"`) | `"entry"` (or answer `confirm_layout_target`) so writes hit the shared template vs entry overlay intentionally. Mutating tool responses always include `warnings` and `next_actions` arrays via `ok()` / `actionRequired()`.

## Template variables

Content files may reference template expressions that are resolved at **delivery** time (API / SSR / menus / section render). Prefer the safe YAML loader so expressions survive parsing.

| Namespace | Source | Example |
|-----------|--------|---------|
| `{{ entry.<field> }}` | Type schema / DB row / static root keys / `field_overrides` (DB); plus auto `slug`/`locale`/`image`/`updated_at` (and `_slug`/`_locale`/`_image`/`_updated_at`). **Preferred.** Legacy `{{ single.<field> }}` still resolves on delivery; **saves reject** new `single.*` tokens. | `{{ entry.title }}`, `{{ entry._slug }}`, `{{ entry.updated_at }}` |
| `{{ meta.<key> }}` | Page SEO block (`meta:`), after `entry.*` inside meta is resolved | `{{ meta.page_title }}` |
| `{{ param.<key> }}` | URL path params + querystring (path wins on conflict) | `{{ param.category }}`, `{{ param.utm }}` |
| `{{ brand.* }}` | Protected site identity in `variables.yml` (Brand Settings) | `{{ brand.logo }}`, `{{ brand.title }}` |
| `{{ global.* }}` / `reserved.*` | Other site variables in `variables.yml` | `{{ global.campus_phone }}` |

**Hiring rate:** use `{{ global.global_job_placement_rate | 84 }}%` for the sitewide claim on programs, pages, locations, landings, and SEO meta. Region overrides in `variables.yml` (default/usa-canada `84`, europe `75`, latam `81`). Do not hardcode `84%` / `75%` / `81%` for that claim. Leave Outcomes year charts, press cohort stats, and cohort-specific FAQ as literals. SEO modal must keep the raw token on save (preview is resolved separately).

Staff maintain globals (and browse brand/reserved read-only) at **`/private/variables`**. Usage indexing tracks dotted tokens (`global.*`, `brand.*`, `entry.*`, …). Brand/legal edits stay in Settings → Brand / Legal. Menu YAML is not in the usage index yet.

Resolve order at page delivery: **entry (incl. legacy single) → meta → param**. Site vars (`brand`/`global`) stay for React `SectionRenderer` (edit mode can preserve `{{ }}`); pass `skipSiteVars: false` only for non-React consumers (menus, schema.org, SEO, entry preview). Editors keep unresolved templates on write paths.

**Mental model:** `{{ entry.* }}` is the **current entry’s field bag** (`field_mapping`) — not the shared shell filename. Shared-layout shells live in `template.{locale}.yml` (legacy `single.*` still loads; filename ≠ namespace). SEO Meta tab = SEO head only (`meta.*`). Mapping remaps are for DB columns and `function:` fields. New schema fields need a default; if no entry has the key yet, warn “new field”.

- **`sections_owned` types** (no shared layout): bind `{{ entry.* }}` in that entry’s own `sections` / `meta`.
- **Attached shared-layout** (`body_model: locale_fields_plus_shared_single`): bind in `template.{locale}.yml`; entry locale YAML is data-only (sections ignored).
- **Listing `item_template`:** `{{ entry.* }}` means **each list row**, not the page entry.

### SEO clustering (per-entry + hub inventory)

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
- **Variants:** omit `search_engines`; warning `search_engines_skipped_variant` (live URLs only). Variants still return editable `meta`/`seo`/`schema_org` with `index: null`.
- **Warnings:** `bing_not_configured`, `search_engines_stale` when Google cache is stale.
- **Non-effects:** no live API, no inspect queue, no YAML/GitHub, no diagnostics job.

### Live SEO + Required for publish

- **Live locale writes / publish / promote** require resolved non-empty `meta.page_title` and `meta.description` (no leftover `{{ }}`). Draft-only writes are exempt. Gate: `server/live-entry-seo-gate.ts` + `shared/validateRequiredMeta.ts`.
- **`editor.<field>.required: true`** (Fields UI asterisk / YAML): drafts may omit the value; `publish_draft` / `promote_variant` and live saves fail if empty or cleared. Distinct from field_mapping `?` (key may be absent). JSON `editor.type: json` fields must also satisfy `editor.<field>.schema` (and `call_to_action` conversion/tag semantics). **Also requires** `editor.<field>.fill_intent: { goal, purpose, constraints? }` — `goal` is an open string (`get_content_type_info.fill_intent_goal_presets` are suggestions only; custom goals OK); `purpose` is the fill brief and the staff item-editor hint. Field Settings no longer edits a separate `description` (Apply clears it; legacy keys may remain until then). Config PUT rejects required-without-fill_intent (`code: missing_fill_intent`). **Also requires** type-level `strategy.purpose` (`code: missing_strategy` if absent). Validator: `required-fields`. Codes: `REQUIRED_FIELD_EMPTY`, `REQUIRED_FIELD_MISSING_FILL_INTENT` (type-level). Soft warning `FILL_INTENT_GOAL_NOT_PRESET` for non-preset goals. Diagnostics **suggestion** prefers `fill_intent` → nested schema property `description` → legacy top-level `description`. Do not treat “non-empty” as license for filler. Schema `minItems` (e.g. blog `faq_entries: 5`) enforces counts when configured. Re-check / fresh run refreshes suggestion text on cached issues.
- **`editor.<field>.required: attached`**: same satisfaction rules **only** when the entry is on a shared-layout type and **not** `detached: true`. Detached entries skip these fields (Fields UI: “Optional while detached”). On non–shared-layout types, `attached` behaves like `true`. Diagnostics code: `REQUIRED_ATTACHED_FIELD_EMPTY`. `get_content_type_info.editor_required_modes` exposes `false | true | attached` per field.
- **Reattach gate:** `set_entry_attachment` / `POST .../reattach` fails with `code: reattach_missing_required_fields` if **any live** locale is missing/invalid attached-required fields (`missing_fields` like `es.call_to_action.conversion_name`). Draft/variant files ignored. Does not seed CTA/FAQ/content from detached sections.
- **Fields diagnostics (batch, does not write or block HTTP save):**
  - `editor-field-types` — `editor.type` / json schema / relation shape vs live `entryFields`. Codes: `EDITOR_TYPE_UNKNOWN`, `EDITOR_JSON_SCHEMA_MISSING`, `EDITOR_RELATION_SOURCE_MISSING`, `EDITOR_TYPE_MISSING`, `EDITOR_ORPHAN_HINT`, `FIELD_TYPE_MISMATCH`, `FIELD_JSON_INVALID`, `FIELD_JSON_STORED_AS_STRING`, `FIELD_RELATION_INVALID`. Skips empty values and `{{ }}`. Numeric string `"42"` is a valid number. Image/pdf = string shape only (`images` owns broken assets). Select is a string; with `editor.multiple: true` also accepts `string[]`.
  - `unknown-keys` — extra YAML/Fields keys not in `field_mapping` or structural allowlist (`meta`, `sections`, …). Code: `UNKNOWN_FIELD_KEY` (warning).
  - `relation-targets` — relation pointer slugs exist in `editor.source` (cross-entry; **not** on single-page save). Code: `FIELD_RELATION_TARGET_MISSING`.
  - Split: emptiness → `required-fields`; mapping source path → `field-mappings`; asset 404 → `images`.
  - CLI: `npx tsx scripts/validation/cli.ts -v editor-field-types,unknown-keys,relation-targets`.
  - Non-effects: does not publish, does not auto-fix, does not replace `get_content_type_info` / reading `editor.<field>.schema` before `update_fields`.
- **Circular trap (meta vs body):** When a micro-save **touches** required SEO meta or editor.required paths (or on publish / full replace), the gate validates those fields on the post-write merged document. If both `meta.description` and body `description` are empty strings, fixing only one side still fails the other gate. Remedy: set all missing paths in **one** multi-field write — MCP `update_fields` (or `edit-sections` with multiple `update_field` ops). Multi-entry `update_meta_fields` is meta-only and cannot set body `description`. Failures return `code: live_required_fields` + `missing_fields` and MCP `action_required: fix_live_required_fields`. Structural micro-saves with empty `touchedPaths` skip this sweep (gaps → Diagnostics).
- **schema_org companions:** CT `schema_org_requirements` (e.g. location → LocalBusiness, authors → Person) and hero `course` → Course must be present on merged sections. **Hard-fail** on publish/promote, `replace_all_sections`, and full live locale YAML writers (`intent: publish`). Live micro-saves (structural add/reorder, scoped `update_field`) do **not** hard-fail companions — gaps show via validator `schema-org-companions` / Diagnostics. Attach: `ensure_content_type_schema_org` / `POST .../schema-org-ensure`. Preview: `get_entry_seo.schema_org`. Non-effect: does not change JSON-LD emission or `schema-org.yml` site templates.
- **Empty detached locale (`EMPTY_LOCALE`):** A live locale is empty only when the entry is **detached** (`detached: true` in `_common.yml`) **and** merged data has no sections (`missing` / `length === 0`) **and** no non-empty string `content`. Classic blogs with body in `content` are not empty. Attached shared-layout `sections: []` on the entry is normal (structure from `template.{locale}.yml`) and is **never** empty via this rule. Empty detached locales are hidden from listings / sitemap / hreflang; direct URL returns **HTTP 404** with a custom “not available in this language” body + links to public alternates (`noindex`). Helper: `shared/isEmptyLocaleContent.ts` + `server/empty-locale.ts`. Publish/promote/live writes are blocked. Manage UI surfaces all via `emptyLocales` + Errors. MCP `run_entry_diagnostics` / content-quality still scan live empty files so agents see `EMPTY_LOCALE`.
- **Non-effects:** clearing required fields on a draft is OK; listing `pickListingFields` does not invent fallbacks for missing title/description; emptiness is not a language classifier (no fuzzy “English shell” detection); mirrored sections stay **per-section** hide/`_label` only — an entire locale is not taken offline because some section was mirrored; the gate does **not** auto-copy `description` ↔ `meta.description`.

### Shared-layout translations (fields → draft → promote)

Agent loop for adding a locale on shared-layout types (e.g. blog, authors) **while attached**:

1. **`translate_entry`** in `attached_fields` mode — supply field_mapping keys (`title`/`content`/`bio`, …) + optional `meta`; optional top-level **`url_slug`** for this locale's public URL segment (do not pass `content.slug` or `content.url`). `sections` omit or `[]`. New target locale → always **`draft.{locale}.yml`** at 0%. Existing non-empty live → **merge** fields/meta only; **fails if `url_slug` would change** the live URL (use `update_fields` slug + `create_redirect` when needed). **`promote_variant` / `publish_draft`** validate full URL uniqueness (merged YAML; locale wins on `:category` etc.). Draft may omit `editor.required` (warned). Shell still comes from `template.{locale}.yml`.
2. Edit draft (`get_entry_content` with `variant: draft`) → `run_entry_diagnostics` with `slugs: [slug]` and `freshness: "hard"` (exactly one slug returns `completed` / mode sync with `issues[]` in the same call — do not poll) → **`promote_variant`** (one locale on a live entry) or **`publish_draft`** (all-draft entry). Confirm with the user before promote/publish.
3. After go-live success, follow the **required** `next_actions` entry: `run_entry_diagnostics` again (`hard` + one slug) for a sync refresh of the live validation cache (server does not auto-queue diagnostics on publish/promote).

**Custom shell (rare):** `set_entry_attachment` with `action: "detach"` and `confirm: true` bakes **all existing live** `{locale}.yml` files from `template.{locale}.yml` and sets `detached: true`. Does **not** invent missing siblings. Then `translate_entry` uses `detached_sections` mode (non-empty `sections` for new/full shell; fields-only merge preserves existing sections). Reattach with `action: "reattach"` + `confirm: true` (lossy: strips structure, deletes entry versioning/variants — preview when confirm omitted). Ordinary local section tweaks use section tools with `layout_target: "entry"` — **not** detach.

**Non-effects:** `translate_entry` does not AI-translate; it does not create live public stubs for new locales; detach does not create missing locale files; migrate script `scripts/migrate-empty-detached-locales.ts` moves leftover empty live stubs to draft; `publish_draft` / `promote_variant` do **not** auto-start diagnostics — agents must follow `next_actions` (`run_entry_diagnostics` with one slug → sync `completed`).

### Entry preview (`preview.props`)

OG / list thumbnail captures map component props to source keys using the **same namespaces**:

- Schema / mapped field key → `entry` bag (`title`, …; legacy `single` bag still resolves)
- `meta.<key>` → entry SEO meta (loaded like the SEO UI; `{{ entry.* }}` / legacy `{{ single.* }}` inside meta is expanded before apply)
- `brand.<key>` → `variables.yml` brand vars (resolved live at capture). Logo IDs (`brand.logo`, `brand.logo_dark`) are resolved to Media Gallery URLs for the screenshot.

Blocked (circular): `_image`, `image`, `og_image`, `meta.og_image`. Prefixes `brand.*` / `meta.*` are reserved (not dotted paths into the entry).

**Capture runtime:** Cloudflare Browser Run on the server (`regenerate_entry_previews` MCP / admin enqueue). Requires `locales[]` (mandatory). Variants/drafts are skipped. On success: WebP under `images/entry-previews/` (gitignored) and live `{locale}.yml` `meta.og_image` with `?t=` cache-bust — **unless** a distinct gallery/editorial `meta.og_image` / `_image` is already set. Credentials: host env only (`CLOUDFLARE_*`, optional `ENTRY_PREVIEW_CAPTURE_SECRET`, else `SESSION_SECRET` for signing). Staff SEO/GEO → OG Image is display/test only. Non-effects: no MCP tool writes those secrets; does not touch `settings.yml` for Cloudflare.

**Non-effects:** changing brand does **not** dirty / auto-recapture — brand is omitted from `propsHash`. Missing or unusable mapped sources fail **that** entry’s capture only; the queue continues. Capture does not `commitAndPush` by itself (AutoCommitQueue when enabled). Component gallery thumbs stay on client `modern-screenshot`.

## Background event pipeline (saves + MCP writes)

Content saves and MCP YAML writes emit rows into per-site SQLite (`data/<site>/app.db` → `events` table). The event `id` (rowid) is the **generation** counter. A dedicated Sidequest.js process (`npm run sidequest` locally; `website-sidequest.service` in prod) shares `data/sidequest.sqlite` with the web process and runs:

- `index_refresh` — full ContentIndex snapshot, applied to the web process within seconds
- `on_save_validation` — entry-local validators, merged into the validation cache
- `sync_state_flush` — batched `.sync-state.json` write
- `binding_propagation` — async bound-section sibling YAML writes behind a lease

Express **enqueues only** (never `Sidequest.start()`). Worker liveness for pipeline status is `data/sidequest.pid` (process alive check) — not HTTP, so heavy inline jobs do not look like a down engine.

**Staff:** Background pipeline dashboard at `/private/background-pipeline` (`GET /api/admin/pipeline/status`, event log via `GET /api/admin/events`). Debug Bubble queue icon links there. Saves return immediately; site-wide usage maps lag briefly until index snapshot apply. Engine Stopped: use pipeline **Diagnostics & logs**, **Check again**, or **Restart Sidequest** (webmaster; prod uses flag file + `website-sidequest-restart.path` — docs/vps.md). Critical/warning system alerts: `sidequest_engine_down`, `sidequest_engine_stuck` (stale heartbeat). Read-only triage: `GET /api/admin/sidequest/diagnostics`, logs: `GET /api/admin/sidequest/logs`.

**Agents (MCP):** MCP writes call the same `emitContentFileWritten` helper. `side_effects` may include `event_id`. Entry YAML on disk is fresh immediately; usage maps / SEO index update after `index_snapshot_ready` (typically &lt;5s). Template saves do **not** fan out `updated_at` to attached entries. Bound-section saves queue sibling propagation — do not expect inline `bound_updates`. Dashboard at `/private/background-pipeline` is read-only for staff; agents keep using events APIs — no behavior change. **Non-effect:** saving content still succeeds if the worker is down (jobs queue until the Sidequest process is up again). **warnings:** engine down or stuck (heartbeat stale while PID alive). **next_actions:** staff → `/private/background-pipeline` or `GET /api/admin/sidequest/diagnostics`; restart → webmaster + systemd path unit on prod. **non_effects:** diagnostics/recheck do not restart or mutate the job queue.

**Event log fields (agents):** Each row has `resource`, `payload`, `attribution[]` (`{ author?, actor? }` — usually one entry; coalesced snapshots union all parent writes), `triggered_by_event_id` (single-parent chains), and `triggered_by_event_ids[]` on `index_snapshot_ready` (all write ids covered; computed at emit, always agrees with `payload.generation`). Downstream events inherit attribution from their parent write(s). Issue workflow events (`validation_issue_*`) have attribution only — no parent link. Parent ids may reference pruned/cleared rows; treat as historical references, not joins. Safe UI fields: `payload.entryKey`, `payload.summary`, `payload.files[]`, `payload.updatedFiles[]`, `payload.errors[]`, issue `code`/`severity`/`validator`. **Non-effects:** `index_snapshot_ready` only means a snapshot file was written — live ContentIndex updates when the applier runs. `validation_results_ready` with `skipped: true` does not change the Diagnostics cache and does not affect pipeline stall status (audit-only; stall uses dispatch backlog in `server/events/types.ts` → `OUTBOX_DISPATCHABLE_EVENT_TYPES`). Validation job dedupe is unchanged — provenance is stamped at emit from the latest matching write. MCP writes must send `x-mcp-author` + `x-mcp-client`. `binding_propagation_started` does not imply siblings are updated until `binding_propagation_done`. `job_failed` is reserved; not emitted yet.

**Binding lease 409:** `{ code: "binding_lease_active", groupId, holder, retryAfterMs }` — only the bound **section** is locked; wait `retryAfterMs` and retry once. Other sections on the same page remain editable.

**Pipeline SQLite migrations (staff):** Deploy runs a dry-run migration check on DB copies before flip (`ensure:pipeline-db --dry-run` in `scripts/deploy.sh`). Live schema apply happens once at server restart. Monitor deploy via GitHub Actions → **Deploy to VPS** job log — not this dashboard. Post-deploy engine stopped: check Actions log for dry-run failure or Settings → Server for failed restart.

**Pipeline SQLite migrations (agents):** `warnings`: deploy dry-run validates migrations on DB copies; live apply at boot on `data/<site>/app.db`; dry-run failure blocks deploy flip. `non_effects`: no YAML/content GitHub/Postgres changes; pipeline SQLite not backed up to GCS; no in-app deploy status API. `next_actions`: deploy/migration failure → staff checks GitHub Actions Deploy to VPS log or VPS `.deploy-state/<sha>.log`; engine issues → `/private/background-pipeline`.

## Delete events + link index (agents)

**`content_entry_deleted`** — emitted when an entry folder or locale YAML is removed (UI delete, MCP `delete_entries`, versioning last-draft removal). **Does not** emit `content_file_written` when the file no longer exists on disk.

- **side_effects:** `index_refresh`; `entry_delete_cleanup` (validation cache `clearEntryKey` per removed `entryKey`, link-index `remove` ops); coalesced link-index flush; GCS upload of `{contentRoot}/link-index.json` in production (`{site}/sync/link-index.json`).
- **non_effects:** Does not strip hrefs from other entries' YAML; does not enqueue `on_save_validation` for the deleted entry.

**`delete_entries` preview** (without `confirm:true`): includes `preview.link_preview_by_slug[slug].referrers[]`, `suggestions[]` (redirect / update sources), and top-level `referrers[]` / `suggestions[]` in MCP responses. Informational only — delete is not blocked.

**Link index (`link-index.json`):**

- Local path: `{contentRoot}/link-index.json` (derived; **not** content GitHub).
- Production persistence: GCS `{site}/sync/link-index.json` (see `shared/gcsKeys.ts` → `SYNC_FILENAMES.linkIndex`); hydrated on boot with validation cache.
- Keys: `type/slug/locale` (same as entry diagnostics key, no variant).
- Values: sorted unique **outbound** public paths per entry; invert in memory for referrers / delete preview / Runtime 404 CMS links column.
- **updated_by:** `on_save_validation` / `content-quality` (`queueLinkIndexSet`, including `[]` when all links removed); `binding_propagation_done` applier (sibling YAML); `entry_delete_cleanup` / bulk sync `deletedPaths` (`queueLinkIndexRemove`); full rebuild via site validator `site-link-index` (diagnostics).
- Coalesced pending ops (`.cache/link-index-pending.json`) + debounced flush (~800ms); rebuild clears buffer and wins over in-flight ops.
- DB-backed types: mapped string fields (e.g. `body`, `description`) scanned on save (scoped row) and on full `site-link-index` rebuild — background only, not on public request path.
- **warnings:** Menus, React-hardcoded hrefs, and external referrers are **not** indexed in v1.
- **next_actions:** Stale or empty referrers → `run_entry_diagnostics` with `validators: ["site-link-index"]`.

Staff: delete confirm modal and Runtime 404 **CMS links** column show derived referrer counts with index age disclaimer; run Site Diagnostics for full link graph refresh.


## Agent sessions and reports

- Call `bootstrap_agent` once near the start of an MCP content run (Claude.ai, Grok, or any connector). First call: omit params → playbook + conversation conventions (`skill.content` from `mcp-server/agent-conventions.md`) + 6-day changelog. Later calls: `include_skill_content: false` and/or `known_skill_version` matching `skill.version` (changelog + playbook still returned).
- Then `agent_session` (`start`) → pass `agent_session_id` on every content mutate (header `x-mcp-agent-session` via loopback).
- Every high-impact content mutate requires `report` (min 80 characters): what changed and why for this write.
- **Staff-readable values:** when you set copy or structured text (titles, subtitles, CTA, success messages, blurbs), list the **plain new values** inline (`Title: …; Subtitle: …`). Do not paste JSON/YAML dumps or only name tools/field paths.
- **Human-facing replies:** follow conventions from `bootstrap_agent` `skill.content` (e.g. markdown links to modified pages + `?force_variant=` for drafts).
- `update_issue` claim (first): `report` = why you are claiming + plan (min 80). Own TTL refresh may omit. Complete: `report` = what you changed and how, including plain values for copy you set (min 80).
- Prefer one `summarize` at the end; staff also see an auto banner from write/issue events on Background Pipeline.
- Omit `agent_session_id` → warning `agent_session_unscoped` (staff **Unscoped**). Bulk sync never gets a session id.
