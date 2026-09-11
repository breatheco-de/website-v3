# Product (sidecar, audience, journey)

Call this topic before changing purchasable products, product **audience**, section product scope, or reading a **product conversion journey**.

Page funnel **stage / money-page inventory** → topic `funnel`. SEO → topic `seo`. Lead-form catalogs → topic `lead-forms`.

Legacy explain topic name `ecommerce` still resolves here for one changelog window.

## Mental model

| Concept | Meaning | Where |
|---------|---------|--------|
| **Product** | Purchasable CMS entry | `programs/{slug}/_product.yml` with `purchasable: true` (legacy dual-read: `_ecommerce.yml`). Computed `single.purchasable` — do not author on `_common.yml`. |
| **Audience** | Offer (Producto) + many personas; avatar nested under each persona | Same entry `_product.yml` → `offer`, `personas[]`. Locale-agnostic. |
| **Actively selling** | Store/vitrine pause | `_product.yml` `actively_selling` (default true). **Human-only** (Store toggle). Not the lead-form filter. |
| **Journey membership** | Which pages belong to a product’s funnel | Each page’s `_common.yml` → `funnel.stage` + `funnel.products` as `{ product, persona? }[]` or `"all"`. |
| **Product scope** | Which product(s) a section is about | Section `ecommerce_products` / `programs[].id` — GA field names kept. |
| **Plans / SKUs** | Billing packages | **Not in CMS** — external POS |

## Tools

| Tool | Use |
|------|-----|
| `list_products` | Inventory first (selling flag, audience status, persona ids). Paused included by default. |
| `get_product` | Full sidecar for one slug (offer + personas/avatar). |
| `update_product` | Patch offer/personas/name/description (`confirm: true`). **Not** sellable/store visibility. |
| `get_product_funnel` / `get_product_funnel_analytics` | Journey pages / metrics |

**Human-only:** making sellable (`purchasable`) or showing/hiding in the store (`actively_selling`). Agents use `propose_change` notes asking staff to act in Store / YAML. MCP refuses those fields on `update_product`.

Vague “what is this site about?” → `list_products` then `get_product` on relevant slugs (also summarized on `explain_site` topic `overview`).

## Audience

- Minimal: `offer.one_liner`, `offer.who_its_for`, ≥1 persona with `id`, `role`, avatar `fears` (≥1), `internal_dialogue`, `objections` (≥1).
- Persona **ids are immutable while funnel pages bind** them (including the product’s own page if it binds that persona). Creating a persona on the product does **not** bind any page. Rename (remove old id + add new) is allowed when unbound. Duplicate ids on the same product are rejected. Display `label` is always editable.
- Cannot remove a persona (or demote below minimal) while pages still bind that persona/product in funnel. **No cascade rename** of page `_common.yml` bindings.
- Purchasable without audience is OK; **specific funnel bindings** require minimal audience. `"all"` hubs never carry personas.
- `update_product`: preview then `confirm: true`. Cap: `content_edit_structure`.
- Codes: `persona_in_use`, `duplicate_persona_id`, `last_persona`, `audience_in_use`.

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

## Journey tools

- `get_product_funnel` / `get_product_funnel_analytics` (read)
- Membership writes: `update_fields` (`funnel.stage` / `funnel.products`, structure cap) or multi-slug `update_entry_attributes` — or Funnel tab / PUT. Not on `_product.yml`.

## GA / dataLayer names (unchanged)

`trackEcommerce`, section `ecommerce_products`, `/api/ecommerce/events`, `ecommerce-settings.yml` stay ecommerce-named.

## Key files

- `shared/productAudience.ts`, `shared/funnel.ts`
- `server/product/` (index, manager, product-io, funnel gates)
- `mcp-server/tools/product.ts`
- Store → product detail → Audience panel / Selling toggle
