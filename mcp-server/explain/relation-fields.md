# Relation fields + authors hubs

## Forms may bind via `source.related_field`

Lead-form (and other form-settings) choice fields can set:

```yaml
fields:
  program:                    # payload / CRM key (unchanged)
    source:
      related_field: programs # CT editor field name on this entry
      value_path: slug
      label_path: title
```

- Reads `single.<field>` / the entry relation value (pointers on `_common.yml` for static types).
- Do **not** hardcode `default` / `visible` / `slugs` for that list — cardinality comes from option count.
- Mutually exclusive with `source.content_type` / `source.database` (catalog via `/api/query-options`). See topic `lead-forms`.
- `source.related_field` + `slugs` together → publish error.
- Publish fails on empty / unknown pointers when a form binds that field; empty catalog does not.
- `value_path` / `label_path` required. Typical on this corpus: `slug` / `title`. Not `editor.programs.value`. Confirm with the user.

**Agent playbook**

1. `explain_site` topic `relation-fields`
2. `get_content_type_info` → `relation_fields` + `system_hints`
3. `get_entry_fields` → current value + `system_hints`
4. `update_fields` path `<field>` = string[] pointers on `_common` (from hint.source catalog)
5. Form YAML: `source.related_field: <field>` plus `value_path` / `label_path` (not hardcoded default/slugs)
6. Publish — gate until pointers valid/non-empty when forms bind that field

**Non-effects:** Agents do not write `single.*` (derived). Filling the CT relation field is enough for all forms that share that `source.related_field`. There is no MCP catalog-preview tool.

---

## What `editor.type: relation` stores

- **Pointers only** — a slug string or `string[]` when `multiple: true`.
- Never write Person / related-entry JSON into the field. Create/edit Person data on the **source** content type (e.g. `authors`).
- Empty `[]` fails `required: true`.
- First array element = **primary** (byline / LD order).

```yaml
# blog _common.yml
authors:
  - ada-lovelace
  - bob
```

## Source namespace

`source` is a **content-type key** or **private DB slug**. Those namespaces must never collide (`findSourceNameCollisions` / `assertSourceNameAvailable`). Example rename: DB `lesson` → `lesson_tuples`.

Picker options come from `/api/query-options?source=…` (omit locale → entries present in **any** locale, deduped by value).

## Listing vs page

| Surface | Shape |
|--------|--------|
| Listing / list_cards | Keep slug pointers; display via **deslugify** (`shared/relation-field.ts`) |
| Page / SSR `{{ entry.authors }}` | Hydrated object[] via `server/resolve-relations.ts` (locale + fallback) |

## Blog + authors (4geeks)

- Content type `authors` (seeded on `site_4geeks-com` only): public hubs; protected default `4geeks-academy`.
- Blog `authors` relation is required, multi, stored on `_common.yml`, indexed.
- Article template must map explicitly:

```yaml
- type: article
  content: "{{ entry.content }}"
  authors: "{{ entry.authors }}"
```

Missing map → byline/LD may fall back to Organization; do not rely on silent React autoread.

## JSON-LD

Hydrated authors → `Person[]` with `url` / `@id` = author page. Broken / unresolved → **Organization** (not a fake Person).

## `delete_entries`

- Preview without `confirm: true` (dependents, `needs_reassignment`, blocked protected slugs).
- On confirm: best-effort `results[]`; cascade removes deleted author slugs from `blog.authors`.
- If a post would become `[]`: require **reassignment** (picker / `reassignments` map); default = `4geeks-academy`.
- Deleted author URLs **404** (no soft redirect).

## Authors Person fields (fill guidance)

| Field | Schema.org | How to fill |
|-------|------------|-------------|
| `name` | `Person.name` | Required public byline name |
| `job_title` | `Person.jobTitle` | Short role/credential |
| `bio` | `Person.description` | ~50–100 words; factual; not meta.description |
| `same_as` | `Person.sameAs` | Absolute profile URLs (https), one per tag |
| `works_for` | `Person.worksFor` | Org name string → `{@type:Organization,name}` |
| `knows_about` | `Person.knowsAbout` | Short topic tags (Text), not sentences |
| `_image` | `Person.image` | Real portrait via Media Gallery |
| `published_at` | (editorial) | Go-live; not a Person property |

Never write Person JSON into blog `authors` — pointers only.

## Author hub JSON-LD

- CT `authors.schema_org_requirements: [{ schema_type: Person }]`.
- Shared template `authors/template.{locale}.yml` leads with `schema_org` `Person` mapped from `{{ entry.* }}` fields; SSR fills `url`/`@id` from the hub page URL when missing.
- Hub bio is `text_block` (not `article`) — **non-effect:** no Article LD from the bio.
- BlogPosting.author Person[] still comes from relation hydration on blog articles — not from this hub `schema_org` section.
