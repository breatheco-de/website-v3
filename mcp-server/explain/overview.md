# Site Architecture Overview

This is a content-driven marketing platform built with React (Vite/TypeScript) on the frontend and Express on the backend. All public-facing pages are authored in YAML files stored in that site's content folder from `sites.yml` (`content_folder`, e.g. `site_4geeks-com/`) and rendered dynamically by a `SectionRenderer` component. Pass `site` (domain) on `explain_site` so live catalogs below resolve from the right folder.

## Core concepts

- **Content types** — defined in `{content_folder}/content-types.yml`. Each type has a directory, URL pattern, and optional field mappings. **DB-backed** means `database.slug` is set (YAML create tools skip those). **Shared-layout** means `single_template: true` and/or DB — shell lives in `template.{locale}.yml` (legacy `single.{locale}.yml` still loads). Example: `blog` is static YAML + `single_template` (not DB-backed).
- **Sections** — every page is a list of section objects. Each section has a `type` that maps to a React component registered in `SectionRenderer`. Sections are authored in YAML and never in code.
- **i18n** — pages exist in one or more locales. Each locale has its own YAML file (`en.yml`, `es.yml`). Shared fields live in `_common.yml` and are deep-merged at read time.
- **Image registry** — all images are referenced by ID from `{content_folder}/image-registry.json`. Raw paths are never hardcoded in components.
- **Routing** — URL patterns are defined per content type in `content-types.yml`. English pages use `/en/` and Spanish pages use `/es/` prefixes.
- **MCP mutating tools** — success payloads always include `warnings` + `next_actions` (see `mcp-server/lib/respond.ts`). Shared-layout sibling locale sync is agent-driven via `next_actions`, not server fan-out; section bindings propagate on live single-section edits. YAML/component/explain **reads** require `content_view`; the caller’s `tools/list` is filtered to their grants in production.

## Active content types

<!-- @dynamic:content_types -->
<!-- /dynamic -->

## Active locales

<!-- @dynamic:active_locales -->
<!-- /dynamic -->

## Available topics

| Topic | When to use |
|---|---|
| `overview` | This file — start here for a general map of the codebase |
| `content_system` | How YAML content files are structured, merged, and loaded safely |
| `routing` | URL patterns, locale prefixes, `?cache=false` HTML cache bypass |
| `images` | How images are registered, referenced, and rendered |
| `sections` | Section components, registry, in-page CTA hashes (`#section_id` modal/scroll, `inline#`, `#top`/`#bottom`) |
| `semantic_search` | Qdrant, local embeddings, database `vector_search`, keyword fallback |
| `local_databases` | Local YAML private DBs; MCP item CRUD; global index; FAQ database (`frequently_asked_questions`) |
| `component-behaviors` | behaviors ids, CTA `tracking`, conversion_events catalog, CRM tags allowlist |
| `seo` | meta gates, locale `seo:`, clustering inventory, GSC/Bing, SEO diagnostics |
| `funnel` | `funnel.stage` / products, money pages (`decision`), `list_entries` filters, inventory vs journey |
| `ecommerce` | products, product scope property paths, `get_product_funnel` journey (stage inventory → `funnel`) |
| `shared-layout` | `single_template` / DB shared shell; create_entry playbook; blog as example |
| `relation-fields` | Relation editor, authors hubs, listing vs hydrate, delete reassign |
| `lead-forms` | Catalog `source` (`content_type` / `database` / `related_field`), required `value_path`/`label_path`, required `query` on ecommerce catalogs, `purchasable` vs `actively_selling` |
| `redirects` | CMS 301/302: two stores, first-match, `test_redirect` (`read_redirects`) + `update_redirect` (`edit_redirects`) |
| `proposals` | Entry change proposals + issue handoff notes: 3 tools, four-eyes apply |

**Before making any structural change to this codebase, call `explain_site` with the relevant topic.**
