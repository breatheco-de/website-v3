# Product (sidecar, audience, journey)

Call this topic before changing purchasable products, product **audience**, section product scope, or reading a **product conversion journey**.

Page funnel **stage / money-page inventory** → topic `funnel`. SEO → topic `seo`. Lead-form catalogs → topic `lead-forms`.

Legacy explain topic name `ecommerce` still resolves here for one changelog window.

## Mental model

| Concept | Meaning | Where |
|---------|---------|--------|
| **Type allow** | Type may have sellable entries | `content-types.yml` → `products.allow_sellable_entries` (manage dashboard card) |
| **Product** | Purchasable CMS entry | `programs/{slug}/_product.yml` with `purchasable: true`. Computed `single.purchasable` — do not author on `_common.yml`. |
| **Removed** | Soft-removed from index | `_product.yml` `purchasable: false` (audience kept). **Not** the same as paused. |
| **Audience** | Offer (Producto) + many personas; avatar nested under each persona | Same entry `_product.yml` → `offer`, `personas[]`. Locale-agnostic. Editable while removed. |
| **Actively selling** | Store/vitrine pause | `_product.yml` `actively_selling` (default true). Needs `product_manage`. Not the lead-form filter. |
| **Journey membership** | Which pages belong to a product’s funnel | Each page’s `_common.yml` → `funnel.stage` + `funnel.products` as `{ product, persona? }[]` or `"all"`. |
| **Product scope** | Which product(s) a section is about | Section `ecommerce_products` / `programs[].id` — GA field names kept. |
| **Plans / SKUs** | Billing packages | **Not in CMS** — external POS |

## Tools

| Tool | Use |
|------|-----|
| `list_products` | Inventory first (selling flag, audience status, persona ids). Removed hidden unless `include_removed: true`. Paused included by default. |
| `get_product` | Full sidecar for one slug (offer + personas/avatar), including soft-removed (warns not sellable). |
| `create_or_update_product` | Create/patch sidecar (`confirm: true`). Audience/metadata → `content_edit_structure`. `purchasable` / `actively_selling` → `product_manage`. |
| `get_product_funnel` / `get_product_funnel_analytics` | Journey pages / metrics (GA4 BigQuery). Site-wide GA → `get_analytics_report` (topic `analytics`). |

Vague “what is this site about?” → `list_products` then `get_product` on relevant slugs (also summarized on `explain_site` topic `overview`).

## Research before inventing audience

On consequential **previews**, `create_or_update_product` may attach **`discovery_path`** (think + tools). Skip is allowed — it does not block `confirm: true`.

1. Prefer `list_products` → peer `get_product` before inventing offer/personas  
2. If who-it’s-for / differentiators are unknown → **ask the user** in chat  
3. Compare personas/avatars to peers — do not clone fear/objection text  
4. Thin create (`purchasable: true` only) is allowed; set audience next  
5. Funnel bindings are a later step (`update_fields` / Funnel tab)

## Audience

- Minimal: `offer.one_liner`, `offer.who_its_for`, ≥1 persona with `id`, `role`, avatar `fears` (≥1), `internal_dialogue`, `objections` (≥1).
- Persona **ids are immutable while funnel pages bind** them (including the product’s own page if it binds that persona). Creating a persona on the product does **not** bind any page. Rename (remove old id + add new) is allowed when unbound. Duplicate ids on the same product are rejected. Display `label` is always editable.
- Cannot remove a persona (or demote below minimal) while pages still bind that persona/product in funnel. **No cascade rename** of page `_common.yml` bindings.
- Purchasable without audience is OK; **specific funnel bindings** require minimal audience. `"all"` hubs never carry personas.
- Soft-removed (`purchasable: false`): still editable for audience; not in default `list_products`.
- Codes: `persona_in_use`, `duplicate_persona_id`, `last_persona`, `audience_in_use`, `product_id_collision`, `type_not_allow_sellable`.

## Tracking short keys (`short_key`)

GA4 keeps 100 chars per event value, so events carry codes, not slugs / persona ids (topic `lead-forms` for what forms send).

| Fact | Detail |
|---|---|
| Where | `_product.yml` → `short_key` (product), `personas[].short_key`, `retired_short_keys[] { key, type, id, name, retired_at }` |
| Format | `^[a-z0-9]{2,6}$`; `all` / `none` reserved (event sentinels) |
| Uniqueness | Per site only: product keys among products; persona keys across **all** the site's personas. Retired keys count. No cross-site check — staff align sites by hand (same key on two sites = merged in shared GA4 reports). |
| Fill | Every `create_or_update_product` write (and Store save) fills that product's missing keys with a suggestion → `warnings[].code: short_keys_assigned`. Site-wide: migration `009_assign_tracking_short_keys` (staff run) or Diagnostics fixer `assign-tracking-short-keys`. |
| Lock | A saved key is locked: changing it → `action_required: confirm_short_key_rename` unless `rename_short_key: true`; the old key moves to `retired_short_keys` (never reusable; old reports keep it). Removing a persona retires its key. Soft-remove keeps keys reserved. |
| Errors | `short_key_locked`, `short_key_conflict`, `invalid_short_key` (`property_path` `_product.yml short_key` / `personas[].short_key`) |
| Switch | Product/persona fields stay off a site's events until every active product + persona has a key; then latched on for good (`pipeline_state.tracking_keys_ready_at`) and the site's HTML cache is cleared. A key missing later → full id is sent + Diagnostics `MISSING_TRACKING_SHORT_KEY`. |
| Side effects | Key changes clear cached HTML for the product page and every page whose funnel binds the product. Page copy unchanged. |

`get_product` returns `tracking_keys.taken_product` / `taken_persona` (other products' + retired keys) to pick a free key.

## Funnel bindings

```yaml
funnel:
  stage: consideration
  products:
    - product: full-stack
      persona: career-changer
```

- Legacy `products: [slug]` coerces to `{ product }` on read; writes dump object form.
- Same product twice with different personas is allowed.
- When audience exists: landings **must** include a valid `persona`. **Program self-page** may omit persona.
- Codes: `missing_product_audience`, `missing_funnel_persona`, `unknown_persona`.
- Funnel writes warn `tracking_values_too_long` (non-blocking) when the page's product / persona codes exceed 100 chars; GA4 cuts at a whole code (`tracking_truncated: true`), ledger + CRM keep full ids.
- Reviewing proposed funnel bindings in proposals → topic **`funnel-classification-proposals`** (persona → product → stage).

## Journey tools

- `get_product_funnel` / `get_product_funnel_analytics` (read)
- Membership writes: `update_fields` (`funnel.stage` / `funnel.products`, structure cap) or multi-slug `update_entry_attributes` — or Funnel tab / PUT. Not on `_product.yml`.

## GA / dataLayer names (unchanged)

`trackEcommerce`, section `ecommerce_products`, `/api/ecommerce/events`, `ecommerce-settings.yml` stay ecommerce-named.

## Key files

- `shared/productAudience.ts`, `shared/funnel.ts`, `shared/tracking-keys.ts`, `shared/tracking-context.ts`
- `server/product/tracking-key-index.ts`, `tracking-keys-assign.ts`, `tracking-readiness.ts`
- `server/product/` (index, manager, product-io, funnel gates, products-type-config)
- `mcp-server/tools/product.ts`
- Store → product detail → Audience panel / Selling toggle; SEO modal → Product tab; type manage → Sellable products card
