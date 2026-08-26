# Component behavioral patterns

Structured `behaviors` on each component `schema.yml` declare how a section participates in platform patterns. Executable wiring stays in runtime code; this catalog is for staff and agents.

## Behavior ids

| Id | Meaning | Runtime | Non-effects |
|----|---------|---------|-------------|
| `ecommerce` | GA4-style ecommerce dataLayer funnel / catalog events | Client `trackEcommerce` in `client/src/lib/tracking.ts` | Does not charge; no on-site `purchase`; CMS does not manage billing plan catalogs |
| `schema_org` | Contributes JSON-LD during SSR; may declare `requires` companions (`companion_type` + `schema_type`, optional `when_variant`) | `server/schema-components` | Does not push GTM events by itself; OG/meta is separate. Site `schema-org.yml` holds Organization/Website templates only. |
| `listing` | Mapping fields + queries → card lists | `dynamic_entries` pipeline | Not a product SKU; not a lead form. `list_cards` tags `user_filters`: arrays always explode into chips; CSV only when the field editor has `split_comma_values` (injected at resolve). Match is case-insensitive contains. Filter fields are preserved when `item_template` omits them. Does **not** expose a CT tag catalog / facets API. |
| `conversion` | Lead form conversion + webhook defaults | `form-settings` + `trackFormSubmission` | Not ecommerce funnel; CTA-only heroes are not conversions |

Nested `form-settings` paths (e.g. `course:signup_card.form`) are **optional in presence**: if the form object is absent, save does not require `conversion_name` (CTA → modal / link). When the form object exists, `conversion_name` (or `null`) is required — same as root `lead_form`. CTA clicks use `cta.tracking`, not lead `conversion_name`.

## Wipe on page/section duplicate

When a **page** or **section** is duplicated, the server clears conversion/ecommerce **identity** fields so staff must re-set them before save/publish. There is no per-component `reset_on_duplicate` list — wipe is **derived** from field-editors:

| Signal | Cleared |
|--------|---------|
| Any key named `conversion_name` under the section (including `routes[].conversion_name`) | Deleted (missing, not `""`) |
| `ecommerce_products` (root or `ecommerce-products` field-editor path) | Whole field deleted |
| Bound `cta-tracking` paths | `tracking` property deleted (CTA object kept so save fails until set) |

**Not wiped in v1:** `programs[].id` on `enrollment_selector`, automations/webhook/tags, ordinary copy/layout props.

Duplicate always succeeds; later save/publish/promote fails until conversion_name / CTA tracking / product scope are valid again. Response includes `clearedFields` for staff toasts and tooling.

**Missing ≠ off.** Wipe **deletes** keys. After wipe you must choose again:

| Field | Explicit off | Valid on |
|-------|--------------|----------|
| `conversion_name` | YAML `null` | non-empty known name (or route name) |
| CTA `tracking` | `none` | `add_to_cart` / `click_begin_checkout` / … |
| `ecommerce_products` (ecommerce behavior, not inherit) | YAML `null` | string[] / `"all"` (or `programs[].id` / inherit) |

Empty string or a deleted key is invalid. Staff Conversion/Ecommerce tabs show banners when identity keys are missing. Publish and promote run the same identity validators as save.

**For agents adding components:** binding `form-settings`, `cta-tracking`, or `ecommerce-products` implies those values are wiped on duplicate. Do not invent a parallel schema key. Default for ordinary props: keep on duplicate.

## CTA tracking (`cta.tracking`)

Bound via field-editor type `cta-tracking` (parallel to `form-settings`). Required values: `none` | `add_to_cart` | `click_begin_checkout`.

| Value | When |
|-------|------|
| `none` | Apply, login, unrelated links |
| `add_to_cart` | Enter purchase configurator (`/payment-component`) |
| `click_begin_checkout` | Click toward `/checkout` |

Example paths: `signup_card.cta_button.tracking`, `programs[].summary.cta.tracking`.

Save/MCP validation: missing tracking on bound paths fails; non-`none` requires a purchasable product in the ecommerce index.

The staff Ecommerce tab is bound-path visibility (`cta-tracking` / `ecommerce-products` for the active variant), not type-level `behaviors.ecommerce`. Non-effect: save still does not require `tracking` on unbound hero variants; identity / `getComponentInfo().behaviors` unchanged.

## Product scope (exact paths)

| Component | Property path |
|-----------|---------------|
| `hero` course on program page | inherit entry slug; optional `ecommerce_products` |
| `hero` course elsewhere | `ecommerce_products` (`string[]` \| `"all"`) |
| `enrollment_selector` | `programs[].id`; optional `ecommerce_products: all` for shared hubs |
| `pricing_plans` | inherit or `ecommerce_products`; prices in content-owned `plans[]` |

See `shared/resolveProductScope.ts`. Agents: `explain_site` topic `ecommerce`.

## Funnel

Effective journey: top-of-funnel `funnel.traffic_sources` (content type + role, documentation only) → locked product page → authored `funnel.steps` in `_ecommerce.yml` → auto pages with `ecommerce_products: all`.

MCP: `get_product_funnel` / `update_product_funnel`. Property paths: `funnel.steps` (URL steps), `funnel.traffic_sources` (inbound types — not URL steps, not auto-detected).

Events: `view_item` (hero course) → `add_to_cart` (payment-component CTA) → `view_item_list` / `select_item` (enrollment) → `click_begin_checkout` (checkout CTA on this site) → `begin_checkout` / `purchase` (off-site learn POS only).

## Ecommerce payload (UI vs central)

- **Call sites** supply context the central layer cannot know: enrollment `selected_plan_option` (`plans[].id`), `cohort_date`, `addon_id`, `amount`/`period_label`, and `item_list_name`.
- **Central** `trackEcommerce` resolves purchasable product identity (`item_id` / `item_name` / `item_category`) from `_ecommerce.yml` and no-ops when the product is missing or not purchasable.
- `selected_plan_option` is the enrollment selector option slug — not the learn.4geeks billing `plan` field.
- `cta-tracking` field-editors (hero course CTA, enrollment summary CTAs) set ecommerce **intent** (`none` | `add_to_cart` | `click_begin_checkout`). `cta_banner` does not bind `cta-tracking` and does not fire ecommerce events.
- Display price strings are not GA4 `value` / revenue.
