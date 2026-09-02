# Lead forms: catalog source + purchasable

Lead-form (and nested `form:`) choice fields load options from `fields.*.source`. This is the dropdown contract — not `mergeLeadFormOptions` (label overlay only) and not `valid_lead_form_option` (removed).

## Source object (exactly one kind)

```yaml
# Vendible catalog (typical on home, upcoming-dates, blog, offer landings, sticky)
source:
  content_type: program
  query: "purchasable=true"
  value_path: bc_slug
  label_path: title

# Subset of that catalog
source:
  content_type: program
  query: "slug=ai-fluency,ai-flex"
  value_path: bc_slug
  label_path: title

# This entry’s related-field pointers (landings / program pages that already inherit products)
source:
  related_field: programs
  value_path: slug
  label_path: title

# Private database catalog
source:
  database: some_db
  query: "status=open"
  value_path: slug
  label_path: title
```

- Exactly one of `content_type` | `database` | `related_field`.
- `value_path` and `label_path` are **required** whenever `source` is set. They are dot-paths on each catalog or related item — not the form field name, not `editor.<field>.value`, and not `routes[].conditions.value`.
- Do not write `relation`, `value`, `label`, `name`, or string shorthand.
- Runtime does not guess mapping. Omit paths → MCP `actionRequired` (`source_value_label_path_required`). Confirm both paths with the user after `get_content_type_info` / `get_entry_content`.
- `options[]` overlays marketing labels — **does not filter**.

## `ecommerce_product_field`

Which submit field resolves ecommerce product identity for GA (`item_id`):

```yaml
conversion_name: student_application
ecommerce_product_field: program   # default; set explicitly on authored forms
```

- Default is `program` when omitted.
- Page `funnel.products` limits which picks get analytics `item_id` (funnel wins).
- Does **not** change CRM/webhook `program` values.
- Topic `ecommerce` for product map / `item_id` alignment.
- `slugs` is ignored when `source` is set.
- EN and ES are separate files — no locale fan-out.

## Typical paths (4geeks corpus — confirm with the user)

| Source kind | Typical `value_path` | Typical `label_path` | Submitted value |
|---|---|---|---|
| Catalog `content_type: program` | `bc_slug` | `title` | option.value (`bc_slug`) |
| `related_field: programs` | `slug` | `title` | pointer slug; submit may remap to `bc_slug` when present |

## `purchasable` vs `actively_selling`

| Key | Where | Meaning |
|---|---|---|
| `purchasable` | Computed `single.purchasable` + listing rows | Entry is in the ecommerce product index (`_ecommerce.yml` with `purchasable: true`). **Not authored** on `_common.yml`. |
| `actively_selling` | `_ecommerce.yml` | Store/vitrine pause. Default `true` if omitted. **Not** the lead-form filter. |

Ecommerce **on** for a content type = that type has **at least one** product in `server/ecommerce/ecommerce-index.ts` (`productMap`).

## Playbook

1. `explain_site` topic `lead-forms` (this file).
2. `get_content_type_info` → `ecommerce.enabled` + `system_fields: ["purchasable"]` + `field_mapping` / `relation_fields`.
3. `get_entry_fields` / `get_entry_content` — this entry’s pointers (`programs: […]`), computed `purchasable`, and current form YAML.
4. Confirm the subset with the user: vendible catalog (`query: purchasable=true`) vs slug subset vs `related_field`.
5. Catalog forms on an ecommerce type **must** set `source.query`. Typical: `purchasable=true`. Exception: form **on a non-purchasable program page** → that program only (`source.related_field` or `query: "slug=<this>"`), not the vendible catalog. Purchasable program pages that already inherit one product: leave related_field/inherit.
6. Writes missing `query` and/or `value_path`/`label_path` return `actionRequired`. Re-call `update_fields` / `add_section` with the merged source complete. Real tools only — no `validate_content`. Do **not** guess paths.
7. `get_entry_fields` / `get_entry_content` show computed `purchasable` (`writable: false`). Do **not** write `single.purchasable`. Edit `_ecommerce.yml` or `get_product_funnel` / `update_product_funnel`.

## Non-effects

- `/api/query-options` is the staff/runtime catalog HTTP API (CMS pickers + LeadForm). There is **no** MCP catalog-preview tool.
- `mergeLeadFormOptions` does not choose which programs appear.
- `actively_selling: false` does not remove a product from a `purchasable=true` form query in this cut.
- Navbar is not an offer catalog.
- Do not hardcode `content_type === "program"`.

## Require Signup (`is_signup`)

Site contract lives in `settings.yml` → `auth.signup.field_map` (Consumer Auth UI at `/private/security/auth`).

Each row: `{ key, from: "form.*" | "session.*", required? }`. `required` is only valid for `form.*` sources.

When `is_signup: true`:

- Site `field_map` must be non-empty (else section save / MCP / forms validator fail).
- Every `form.<name>` in the map must be present on the form; required map rows need `fields.<name>.required: true`.
- Hidden plan default for free signup:

```yaml
fields:
  plan:
    visible: false
    required: true
    default: "{{ global.default_free_signup_plan | 4geeks-basic-subscription }}"
```

Live submit builds the body from the map only (no legacy payload merge). `conversion_info` is always appended in code — not editable in the map.

No magic aliases: `payload.course` ← `form.program` only if that mapping row exists.

## Paths

- Parse: `shared/parseFormFieldSource.ts`
- Catalog API: `server/query-options.ts`
- Index: `server/ecommerce/ecommerce-index.ts`
- Runtime: `client/src/components/lead_form/variants/LeadFormDefault.tsx`
- Signup field map: `shared/authSignupFieldMap.ts`
- Staff UI: `client/src/components/editing/FormFieldsCard.tsx` / `client/src/components/settings/AuthTab.tsx`
