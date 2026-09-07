# Funnel (stage, products, money pages)

Call this topic for page funnel stage, product membership, money-page inventory, and how that differs from a product conversion journey.

SEO meta / clusters / GSC → topic `seo`. Purchasable products, section product scope, per-SKU journey tools → topic `ecommerce`.

## Source of truth

Page-level on `{contentType}/{slug}/_common.yml`:

```yaml
funnel:
  stage: decision          # awareness | consideration | decision | post-enrollment
  products:                # string[] of product content slugs, or "all"
    - ai-fluency
```

- **Not** under `meta` / `seo:`.
- **`seo.intent` was removed** — use `funnel.stage`.
- Staff: SEO modal **Funnel** tab; content-type manage **Funnel** list perspective.
- Surgical APIs: `GET/PUT /api/content-types/:type/funnel/:slug`.

## Stages

| stage | Label | Role |
|-------|--------|------|
| `awareness` | TOFU | Widest / most general |
| `consideration` | MOFU | Target buyer persona / evaluate |
| `decision` | BOFU | Ready to buy |
| `post-enrollment` | After purchase | Onboarding / upsell |

## Money pages

**Money page** = `funnel.stage === "decision"`. No separate YAML `money_page` field.

### Site inventory (`list_entries`)

- **No `contentType`:** `mode: type_stats` — per-type counts and guidance to narrow (funnel filters alone do not dump all catalogs).
- **With `contentType`:** paginated one-row-per-slug entries for that type (static and catalog-sourced alike). Pass `locale` for a strict language filter; use `detail: true` for extra non-body scalars.

Optional AND funnel filters (**entry mode**):

- `is_money_page: true` → only tagged `decision` (strict catalog)
- `is_money_page: false` → missing stage or not `decision`
- `funnel_stage` → exact stage match on overlay `_common.yml` (works for catalog-sourced types that have a per-slug overlay)
- `funnel_product` → page **effective** products include that SKU (`products: all`, list match, or **program page always includes itself**)
- Conflicting `is_money_page` + `funnel_stage` → **fail**
- When any funnel filter is set, rows include `funnel`, `is_money_page`, `stage_missing`
- `funnel_product` alone may match pages with no stage; those rows have `stage_missing: true`

### Inventory vs product journey

| View | Tool | Behavior |
|------|------|----------|
| Site / SEO inventory | `list_entries` + `contentType` + money/stage filters | Overlay `_common.yml` tags only — untagged program pages are not money pages |
| Per-SKU journey | `get_product_funnel` / `get_product_funnel_analytics` | Always **pins the product’s own page** as the decision step even if `_common.yml` has no stage |

Do not treat those two answers as the same list. Tag programs as `decision` so inventory and journey align. Journey tools and product scope details → topic `ecommerce`.

## Related

- Edit membership per page (Funnel tab / funnel write APIs) — not `update_product_funnel` (retired).
- `funnel.products` also scopes analytics `item_id` on forms when set — see topic `lead-forms` / `ecommerce`.
