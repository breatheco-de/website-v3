# Ecommerce (products, product scope, per-SKU journey)

Call this topic before changing purchasable products, section product scope, or reading a **product conversion journey**.

Page funnel **stage / money-page inventory** → topic `funnel`. SEO meta / clusters → topic `seo`. Lead-form catalogs → topic `lead-forms`.

## Mental model

| Concept | Meaning | Where |
|---------|---------|--------|
| **Product** | Purchasable CMS entry | `programs/{slug}/_ecommerce.yml` with `purchasable: true`. Computed `single.purchasable` — do not author it on `_common.yml`. |
| **Actively selling** | Store/vitrine pause | `_ecommerce.yml` `actively_selling` (default true). Not the lead-form filter — see topic `lead-forms`. |
| **Journey membership** | Which pages belong to a product’s funnel | Each page’s `_common.yml` → `funnel.stage` + `funnel.products` (or `"all"`). See topic `funnel`. |
| **Product scope** | Which product(s) a section is about | Section data binds (below) — not URL guessing |
| **Plans / SKUs** | Billing packages | **Not in CMS** — content-owned prices or external POS |

Purchase completes off-site. This site never fires `purchase`.

## Journey tools (per product SKU)

- `get_product_funnel` — locked product page + pages whose `funnel.products` includes this SKU (or `all`), grouped by `funnel.stage`
- `get_product_funnel_analytics` — page performance for that journey (GA4 BigQuery)
- **`update_product_funnel` is retired** — edit membership on each page (Funnel tab / funnel write APIs), not `_ecommerce.yml` funnel.steps
- Do **not** use `update_fields` looking for `funnel` on a hero

The product page is always the **locked decision step** in the journey response, even when `_common.yml` has no `funnel.stage`. Site-wide money-page lists (`list_entries` + `is_money_page`) use **catalog tags only** — see topic `funnel` (inventory vs journey).

## Product scope — exact property paths per component

| Component | Property path | Notes |
|-----------|---------------|--------|
| `hero` (variant `course`) on program page | inherit entry slug | No field required; optional `ecommerce_products` |
| `hero` (variant `course`) elsewhere | `ecommerce_products` | `string[]` or `"all"` |
| `enrollment_selector` | `programs[].id` | Default scope from program cards |
| `enrollment_selector` (shared hub) | `ecommerce_products: all` | Appears in journeys when pages use `all` |
| `pricing_plans` on program page | inherit, or `ecommerce_products` | Plans/prices are content-owned under `plans[]` |
| CTA intent | bound CTA path + `.tracking` | e.g. `signup_card.cta_button.tracking`, `programs[].summary.cta.tracking` |

Field-editor type `ecommerce-products` binds `ecommerce_products`. Field-editor `cta-tracking` binds CTA objects.

## Conversion forms — `ecommerce_product_field`

On lead/form-settings objects, `ecommerce_product_field` (default `program`) names which submit field supplies product identity for analytics.

- Page `funnel.products` on `_common.yml` scopes allowed products when set (funnel wins).
- Resolve stamps `item_id` + `program_id` on conversion dataLayer pushes; CRM `program` is unchanged.
- Store journey analytics product KPIs match on `item_id` in BigQuery.

See topic `lead-forms` and `docs/gtm-analytics-setup.md`.

Allowed `ecommerce_products` values: list of product content slugs, or `"all"`.

## Validation

Save fails if an ecommerce-participating section has no resolvable scope. Error messages cite paths like `sections[2].data.ecommerce_products` or `programs[].id`. MCP maps these to `action_required: fix_ecommerce_product_scope` with `next_actions`.

## Key files

- `shared/resolveProductScope.ts`
- `shared/funnel.ts`
- `server/routes/ecommerce.ts`
- `server/ecommerce/funnel-journey.ts`
- `server/ecommerce/ecommerce-index.ts`
- `docs/component-behaviors.md`
- `mcp-server/tools/ecommerce.ts`
