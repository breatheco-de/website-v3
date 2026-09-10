# Product (sidecar, audience, journey)

Call this topic before changing purchasable products, product **audience**, section product scope, or reading a **product conversion journey**.

Page funnel **stage / money-page inventory** → topic `funnel`. SEO → topic `seo`. Lead-form catalogs → topic `lead-forms`.

Legacy explain topic name `ecommerce` still resolves here for one changelog window.

## Mental model

| Concept | Meaning | Where |
|---------|---------|--------|
| **Product** | Purchasable CMS entry | `programs/{slug}/_product.yml` with `purchasable: true` (legacy dual-read: `_ecommerce.yml`). Computed `single.purchasable` — do not author on `_common.yml`. |
| **Audience** | Offer (Producto) + many personas; avatar nested under each persona | Same entry `_product.yml` → `offer`, `personas[]`. Locale-agnostic. |
| **Actively selling** | Store/vitrine pause | `_product.yml` `actively_selling` (default true). Not the lead-form filter. |
| **Journey membership** | Which pages belong to a product’s funnel | Each page’s `_common.yml` → `funnel.stage` + `funnel.products` as `{ product, persona? }[]` or `"all"`. |
| **Product scope** | Which product(s) a section is about | Section `ecommerce_products` / `programs[].id` — GA field names kept. |
| **Plans / SKUs** | Billing packages | **Not in CMS** — external POS |

## Audience

- Minimal: `offer.one_liner`, `offer.who_its_for`, ≥1 persona with `id`, `role`, avatar `fears` (≥1), `internal_dialogue`, `objections` (≥1).
- Persona **ids are immutable** after create; display `label` is editable.
- Cannot remove a persona (or demote below minimal) while pages still bind that persona/product in funnel (except program self-page bindings).
- Purchasable without audience is OK; **specific funnel bindings** require minimal audience. `"all"` hubs never carry personas.
- Tools: `get_product_audience`, `update_product_audience` (preview then `confirm: true`).

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

- `get_product_funnel` / `get_product_funnel_analytics`
- Membership edited per page (Funnel tab / funnel PUT) — not on `_product.yml`

## GA / dataLayer names (unchanged)

`trackEcommerce`, section `ecommerce_products`, `/api/ecommerce/events`, `ecommerce-settings.yml` stay ecommerce-named.

## Key files

- `shared/productAudience.ts`, `shared/funnel.ts`
- `server/product/` (index, manager, audience IO, funnel gates)
- `mcp-server/tools/product.ts`
- Store → product detail → Audience panel
