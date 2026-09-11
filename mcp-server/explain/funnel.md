# Funnel (stage, products, money pages)

Call this topic for page funnel stage, product membership, money-page inventory, and how that differs from a product conversion journey.

SEO meta / clusters / GSC → topic `seo`. Purchasable products, audience, section product scope, per-SKU journey tools → topic `product` (alias `ecommerce`).

## Source of truth

Page-level on `{contentType}/{slug}/_common.yml`:

```yaml
funnel:
  stage: decision          # awareness | consideration | decision | post-enrollment
  products:                # { product, persona? }[] or "all"
    - product: ai-fluency
      persona: career-changer
```

Legacy `products: [ai-fluency]` still reads (coerced to `{ product }`). Writes dump object bindings.

- **Not** under `meta` / `seo:`.
- **`seo.intent` was removed** — use `funnel.stage`.
- Staff: SEO modal **Funnel** tab; content-type manage **Funnel** list perspective (bulk Leave / Set / Clear).
- Surgical APIs: `GET/PUT /api/content-types/:type/funnel/:slug` (path-touched merge: omitted keys leave current; `null` clears).
- **MCP writes:**
  - Single page: `update_fields` with `funnel.stage` / `funnel.products` (or `reset:true`). Requires `content_edit_structure`. Gate fail → nothing else in that call is applied. `locale`/`variant` ignored for funnel (warning).
  - Many pages: `update_entry_attributes` (safe attrs: `meta.*` + `funnel.*` only — not sections). Per-slug rollback if funnel fails. **BREAKING:** `update_meta_fields` removed — reconnect MCP.
- When a product has minimal audience, landings must include a valid `persona`. Program self-page may omit persona. `"all"` never carries personas.
- Codes: `missing_product_audience`, `missing_funnel_persona`, `unknown_persona`.

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

Do not treat those two answers as the same list. Tag programs as `decision` so inventory and journey align. Journey tools and audience → topic `product`.

## Related

- Edit membership via Funnel tab / `update_fields` / `update_entry_attributes` — not `update_product` / not retired `update_product_funnel`.
- `funnel.products` also scopes analytics `item_id` on forms when set — see topic `lead-forms` / `product`.
