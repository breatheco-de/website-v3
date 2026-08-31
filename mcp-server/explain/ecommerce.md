# Ecommerce (products, funnels, product scope)

Call this topic before changing purchasable products, conversion funnels, or ecommerce section fields.

## Mental model

| Concept | Meaning | Where |
|---------|---------|--------|
| **Product** | Purchasable CMS entry | `programs/{slug}/_ecommerce.yml` with `purchasable: true`. Computed `single.purchasable` — do not author it on `_common.yml`. |
| **Actively selling** | Store/vitrine pause | `_ecommerce.yml` `actively_selling` (default true). Not the lead-form filter — see topic `lead-forms`. |
| **Funnel** | Ordered conversion path | Effective = locked product page + authored `funnel.steps` + **auto** pages |
| **Traffic sources** | Top-of-funnel inbound content types | `funnel.traffic_sources` — documentation only (type + role), not URL steps |
| **Product scope** | Which product(s) a section is about | Section data binds (below) — not URL guessing |
| **Plans / SKUs** | Billing packages | **Not in CMS** — content-owned prices or external POS |

Purchase completes off-site. This site never fires `purchase`.

## Funnel tools (not section fields)

- `get_product_funnel` / `update_product_funnel`
- Authored steps property path: **`funnel.steps`** in `programs/{slug}/_ecommerce.yml`
- Traffic sources property path: **`funnel.traffic_sources`** (`[{ content_type, role }]`, one row per content type)
- Do **not** use `update_fields` looking for `funnel` on a hero
- Steps with `source: auto` come from pages with `ecommerce_products: all` — not writable via PUT
- `traffic_sources` are **not** auto-detected and do **not** affect locked/auto resolution or runtime tracking

Effective UI order: (0) `funnel.traffic_sources` (top of funnel) (1) locked product entry (2) authored `funnel.steps` (3) auto `all` pages.

## Product scope — exact property paths per component

| Component | Property path | Notes |
|-----------|---------------|--------|
| `hero` (variant `course`) on program page | inherit entry slug | No field required; optional `ecommerce_products` |
| `hero` (variant `course`) elsewhere | `ecommerce_products` | `string[]` or `"all"` |
| `enrollment_selector` | `programs[].id` | Default scope from program cards |
| `enrollment_selector` (shared hub) | `ecommerce_products: all` | Auto funnel step for every product |
| `pricing_plans` on program page | inherit, or `ecommerce_products` | Plans/prices are content-owned under `plans[]` |
| CTA intent | bound CTA path + `.tracking` | e.g. `signup_card.cta_button.tracking`, `programs[].summary.cta.tracking` |

Field-editor type `ecommerce-products` binds `ecommerce_products`. Field-editor `cta-tracking` binds CTA objects.

## Conversion forms — `ecommerce_product_field`

On lead/form-settings objects, `ecommerce_product_field` (default `program`) names which submit field supplies product identity for analytics.

- Funnel (`funnel.products` on `_common.yml`) scopes allowed products when set.
- Resolve stamps `item_id` + `program_id` on conversion dataLayer pushes; CRM `program` is unchanged.
- Store journey analytics product KPIs match on `item_id` in BigQuery.

See topic `lead-forms` and `docs/gtm-analytics-setup.md`.

Allowed `ecommerce_products` values: list of product content slugs, or `"all"`.

## Validation

Save fails if an ecommerce-participating section has no resolvable scope. Error messages cite paths like `sections[2].data.ecommerce_products` or `programs[].id`. MCP maps these to `action_required: fix_ecommerce_product_scope` with `next_actions`.

## Key files

- `shared/resolveProductScope.ts`
- `server/routes/ecommerce.ts`
- `server/ecommerce/ecommerce-index.ts`
- `docs/component-behaviors.md`
- `mcp-server/tools/ecommerce.ts`
