# Shared-layout entries

Use this topic before creating or restructuring entries for types with `single_template: true` and/or `database.slug`.

## Mental model

- **Shell** (hero, article wrapper, CTA, FAQ, breadcrumb, …) lives in `{directory}/template.{locale}.yml` (plus `_common.template.yml` defaults). Legacy `single.{locale}.yml` / `_common.single.yml` still load if present. New writes create `template.*` only. It applies to **all attached** entries of that type in that locale.
- **Entry fields** live in `{directory}/{slug}/_common.yml` + `{locale}.yml` — `title`, `description`, `content`, `category`, `meta`, etc. Attached entries normally use `sections: []`.
- **`db_backed` ≠ `single_template`.** Static blog is YAML + `single_template`. Specialist agents create a new attached post through an accepted idea, then field edits (no variant). `create_entry` still exists as a staff/live path: it writes immediately and is **not** on specialist connectors. DB-backed types are not creatable that way (`create_via: null`); a missing database row cannot be created by an edits proposal.
- **`layout_owner` per entry:** attached entries report `shared_template` (drafts hold fields only); detached entries report `entry` (drafts hold the whole page); slug `template` reports `is_shared_template: true`. Decision table: conventions §7g (`bootstrap_agent`).
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

## Playbook (new attached post)

Specialist roles do **not** use `create_entry` for a new attached post. The slug is required; the folder need not exist.

1. `propose_change` `kind: "idea"` with `related_entries: [{ contentType, slug, locale }]`.
2. A different role accepts with that same `accepted_entry` and `next_step`. No YAML.
3. `propose_change` edits: `implements_proposal_id`, `review_situations: ["new_public_content"]`, field `updates[]` only — **no** `variant`. Required live fields must be in the ops.
4. A different role `update_proposal` `action: "apply"`. New URL-param values also need `confirm_new_values: true`. Apply writes `{slug}/_common.yml` and one `{locale}.yml` (`sections: []`) and does not read or write `template.{locale}.yml`.

`create_entry` remains the staff/live shortcut (one locale, `sections: []`, URL params on the locale object, `confirm_new_values` for a new peer value). It writes live immediately.

## Playbook (change the shared layout via proposal)

Use when every attached entry of a type should get a new layout (for example a new CTA section on every blog post).

1. `get_entry_content` `slug: "template"` per locale — read today's shared layout (`is_shared_template: true`).
2. `propose_change` edits: one entry per template locale (`slug: "template"`), each with one full `{ field_path: "sections", value: [...] }` (or `sections[i].x` tweaks), and `all_or_nothing: true`. Skipping a live template locale warns `template_locales_incomplete`; a new template locale without full `sections` refuses `sections_required` (`details.new_locale`).
3. Reviewers read `affected_entries { count, sample }` and the `template_blast_radius` checklist: open 2–3 sample entries, check every new `{{ entry.* }}` placeholder is filled by their fields.
4. `update_proposal` `action: "apply"` with `dry_run: true` first — `template_placeholders_unfilled` lists placeholders some entries cannot fill (non-blocking). Apply needs `confirm_affected_entries` equal to the count.

Non-effects: detached entries never change (they own their layout — edit them separately or reattach). Entry field files are not touched. A type without a shared layout has no template; edit each entry.

## Playbook (create — staff / live)

1. `list_sites` — if multi-site, pick a domain and pass `site` on every later call.
2. `get_content_type_info` with `contentType` + `site` — read `field_mapping`, `editor` / `editor_required_modes`, URL params, observed values, `create_via`.
3. Staff `create_entry` with **exactly one** locale; put required fields on the locale object; `sections: []` (or omit) for shared-layout; put **URL pattern params on the locale object** (never `_common.yml`).
4. If a URL-param/select value is **not** in observed peers **for that locale** → stop; get approval from the **principal**, then re-call with `confirm_new_values: true`.
5. Fill SEO via `update_fields` or multi-entry `update_entry_attributes` if needed; verify with `get_entry_content` / `get_entry_seo`.
6. Add another locale with `translate_entry` (optional `url_slug`; fields while attached → draft → promote). Do **not** detach for field translation.
7. `run_entry_diagnostics` when ready.

## Custom shell

Only when this entry must diverge from `template.{locale}.yml`: `set_entry_attachment` (`action: "detach"`, `confirm: true`). Bakes all existing live locales. Local section overlays without ownership change: section tools + `layout_target: "entry"`.

**Reattach:** `action: "reattach"` + `confirm: true` is blocked until every **live** locale satisfies fields with `editor.required: true|attached` (including JSON schema for `call_to_action` / `faq_entries`). Failure: `reattach_missing_required_fields` + locale-qualified `missing_fields`. Fill via `update_fields`, then retry. Non-effect: does not copy CTA/FAQ from detached sections into Fields.

## Anti-patterns

- Treating a new attached post as something specialist roles create with `create_entry` or a draft. Use the accepted-idea field-edits path. `create_entry` is the staff/live shortcut and writes immediately.
- Authoring breadcrumb/hero/article shells on the entry locale file (while attached).
- Detaching only to add a translation — use `translate_entry` with fields instead.
- Calling `list_entry_seo` without `slugs` expecting a full dump (unfiltered returns a **minimal sample** only).
- Inventing new URL-param values without principal approval.
- Putting **URL pattern params on `_common.yml`** or reusing the other locale's slug (e.g. `ai-tools` on an `es` post when peers use `herramientas-ia`).
- Calling `create_variant` on an **attached** article slug for title/`content`/salary-style field updates — that remaps to the shared shell (`action_required: confirm_template_variant`). Use `propose_change` or `update_fields` on the entry instead. Shared-shell A/B only after human/orchestrator approval + `confirm_template_variant: true`. Do **not** pair an article slug with a shell variant in later reads/proposes (`entry_not_found`); edit with slug `template` / `layout_target: type_template`.

## Related tools

- `get_content_type_info`, `create_entry`, `update_content_type` (enable shared layout), `list_entry_seo`, `get_entry_seo`, `get_entry_content`, `update_fields`, `translate_entry`, `set_entry_attachment`, `create_variant`, `list_sites`
- Topic `content_system` for merge / drafts / translate + attachment loop
