# Shared-layout entries

Use this topic before creating or restructuring entries for types with `single_template: true` and/or `database.slug`.

## Mental model

- **Shell** (hero, article wrapper, CTA, FAQ, breadcrumb, …) lives in `{directory}/template.{locale}.yml` (plus `_common.template.yml` defaults). Legacy `single.{locale}.yml` / `_common.single.yml` still load if present. New writes create `template.*` only. It applies to **all attached** entries of that type in that locale.
- **Entry fields** live in `{directory}/{slug}/_common.yml` + `{locale}.yml` — `title`, `description`, `content`, `category`, `meta`, etc. Attached entries normally use `sections: []`.
- **`db_backed` ≠ `single_template`.** Static blog is YAML + `single_template` and **is** creatable via MCP `create_entry`. DB-backed types are not (`create_via: null` from `get_content_type_info`).
- **Missing slug → 404**, not an empty shared shell. Public delivery requires `{slug}/{locale}.yml` (static) or a DB row; soft-match redirects only rewrite when that slug already exists (e.g. wrong `:category`).

Example (blog): body is **`content`** on the locale file (Markdown, including fenced mermaid charts via geekchart — same pipeline as `article.content`); `{{ entry.content }}` is bound inside `blog/template.es.yml`. Do **not** paste a page shell (hero/breadcrumb/article) into the entry. Blog CTA copy/conversion/tags come from entry field `call_to_action` (bound in `template.*.yml`); before setting `conversion_name` or `tags`, call `explain_site` topic `component-behaviors`. See `explain_site` topic `sections` → Article body format.

## Playbook (enable shared layout)

When a type does **not** yet use shared layout and you need to turn it on:

1. `get_content_type_info` — confirm `single_template` is false and the type is not DB-only without a shell.
2. `update_content_type` with `single_template: true` and:
   - `template_mode: "keep_existing"` if a usable `template.{locale}.yml` (or legacy `single.*`) already has non-empty sections, **or**
   - `template_mode: "from_entry"` + **`template_entry_source_slug`** (mandatory). Pass **`template_entry_source_locale`** only when that entry folder has more than one live locale file.
3. Source entry sections must be fully `{{ entry.* }}`-shaped (exact binds). Legacy `{{ single.* }}` is rewritten to `{{ entry.* }}` when copied into `template.*.yml`.
4. If a usable template already exists and you use `from_entry`, first call without `confirm` → `action_required: confirm_template_replace` with preview; re-call with `confirm: true`.
5. Success returns `side_effects.paths` for written `template.*.yml` / `_common.template.yml` and dissolves section bindings for the type.

## Playbook (create)

1. `list_sites` — if multi-site, pick a domain and pass `site` on every later call.
2. `get_content_type_info` with `contentType` + `site` — read `field_mapping`, `editor` / `editor_required_modes`, URL params, observed values, `create_via`.
3. `create_entry` with **exactly one** locale (all content types); put required fields on the locale object; `sections: []` (or omit) for shared-layout; put **URL pattern params on the locale object** (never `_common.yml` — they are language-specific when slugs differ).
4. If a URL-param/select value is **not** in observed peers **for that locale** → stop; get approval from the **principal** (human or orchestrator/reviewer), then re-call with `confirm_new_values: true`.
5. Fill SEO via `update_fields` or multi-entry `update_meta_fields` if needed; verify with `get_entry_content` / `get_entry_seo`.
6. Add another locale with `translate_entry` (optional `url_slug`; fields while attached → draft → promote). Do **not** detach for field translation.
7. `run_entry_diagnostics` when ready.

## Custom shell

Only when this entry must diverge from `template.{locale}.yml`: `set_entry_attachment` (`action: "detach"`, `confirm: true`). Bakes all existing live locales. Local section overlays without ownership change: section tools + `layout_target: "entry"`.

**Reattach:** `action: "reattach"` + `confirm: true` is blocked until every **live** locale satisfies fields with `editor.required: true|attached` (including JSON schema for `call_to_action` / `faq_entries`). Failure: `reattach_missing_required_fields` + locale-qualified `missing_fields`. Fill via `update_fields`, then retry. Non-effect: does not copy CTA/FAQ from detached sections into Fields.

## Anti-patterns

- Treating `single_template` types as DB-backed and skipping `create_entry`.
- Authoring breadcrumb/hero/article shells on the entry locale file (while attached).
- Detaching only to add a translation — use `translate_entry` with fields instead.
- Calling `list_entry_seo` without `slugs` expecting a full dump (unfiltered returns a **minimal sample** only).
- Inventing new URL-param values without principal approval.
- Putting **URL pattern params on `_common.yml`** or reusing the other locale's slug (e.g. `ai-tools` on an `es` post when peers use `herramientas-ia`).

## Related tools

- `get_content_type_info`, `create_entry`, `update_content_type` (enable shared layout), `list_entry_seo`, `get_entry_seo`, `get_entry_content`, `update_fields`, `translate_entry`, `set_entry_attachment`, `list_sites`
- Topic `content_system` for merge / drafts / translate + attachment loop
