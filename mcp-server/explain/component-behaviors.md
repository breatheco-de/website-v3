# Component behavioral patterns

See [docs/component-behaviors.md](../../docs/component-behaviors.md) for the full catalog.

Agents: when adding tracking, SSR schema contributors, `dynamic_entries`, or `form-settings`, declare matching `behaviors` on that component's `schema.yml`.

## Listing (`list_cards` tag filters)

- `user_filters` with `component_renderer: tags`: chips = distinct tokens from that property on resolved items.
- Arrays always explode; CSV only if CT/DB field editor `split_comma_values: true` (server injects onto the filter; source of truth is Editor Type → “Treat comma-separated strings as multiple values”).
- Match: case-insensitive contains (any token).
- `item_template` need not map the filter field — `resolveDynamicEntries` copies missing `user_filters` properties from the raw entry.
- Paths: `shared/editor-field-values.ts`, `server/dynamic-entries.ts`, `client/.../ListCardsDefault.tsx`.
- Non-effect: no reusable CT tag catalog / facets API for public listings.

## Wipe on duplicate (derived)

Page/section duplicate clears identity fields — no `reset_on_duplicate` schema key:

- Any `conversion_name` under the section (incl. routes)
- Whole `ecommerce_products`
- CTA `tracking` on `cta-tracking` binds (delete key → save fails until set)

Not wiped: `programs[].id`, automations/tags/webhook, copy/layout.

Adding `form-settings` / `cta-tracking` / `ecommerce-products` **implies** wipe-on-duplicate. Ordinary props stay. Staff/API responses may include `clearedFields`.

**Identity gates (missing ≠ off):** wipe deletes keys. Save/publish/promote fail until re-decided. Opt-out: `conversion_name: null`, `ecommerce_products: null`, CTA `tracking: none`. Valid on: known conversion name; product slug list / `"all"` / `programs[].id` / program inherit; non-`none` CTA + purchasable product. **Exception:** nested `form-settings` object entirely absent (CTA-only) → no conversion_name required; lead tracking belongs on the submitting form (e.g. modal).

## CTA tracking (exact paths)

CTA intent uses required `tracking` on CTA objects at **`cta-tracking` field-editor paths** — not URL sniffing.

Examples:

- `hero` course: `signup_card.cta_button.tracking` (bind `course:signup_card.cta_button`)
- `enrollment_selector`: `programs[].summary.cta.tracking`, `programs[].plans[].summary.cta.tracking`

Values: `none` | `add_to_cart` | `begin_checkout`.

## Ecommerce product scope + funnels

For product scope (`ecommerce_products`, `programs[].id`, inherit), conversion funnels, and “no CMS plans”, call **`explain_site` topic `ecommerce`** — it lists exact property paths per component.

## Lead conversion names (closed list)

`conversion_name` on lead forms / embedded `form:` / blog `call_to_action.conversion_name` **must** match a name from `{content_folder}/settings.yml` → `tracking.conversion_events` (folder from `sites.yml`; pass `site` on this tool). Validators reject unknown names.

**Agents:**

1. Call this topic and read the **Intent** blocks (`when_to_use` / `when_not_to_use`) below.
2. Match the **current section’s visitor CTA proposition** (submit label, form card title, success url/message, visible fields, page offer) — not SEO alone.
3. Duplicate wipe is intentional: **never** restore `conversion_name` from the source page, a sibling locale, or a pre-wipe value.
4. If intent is ambiguous → ask a human. Never invent event names.

<!-- @dynamic:conversion_events -->
<!-- /dynamic -->

Default tags on each event are CRM-oriented defaults applied when the form omits `tags`. Prefer omitting entry/`form.tags` when those defaults already fit.

## CRM tags allowlist (do not invent)

Form / blog `call_to_action.tags` is an optional CRM tag string (comma-separated). Values must come from `tracking.leads_expected_tags` (CRM-agnostic; maintained in Leads → Expected CRM tags).

**Agents:**

1. Call this topic before writing tags.
2. Only use tags from the list below (or omit `tags`).
3. If unsure which tag, or the list is empty / tag missing → **ask a human and stop**. **Never invent** tags.

<!-- @dynamic:crm_tags -->
<!-- /dynamic -->

## Post-submit success

- `success.message` — inline thank-you (stay on page)
- `success.url` — **optional**; when set, **redirects** the user after a successful submit

## Blog `call_to_action`

Shared-layout blog CTA (`cta_banner` on `blog/single.{locale}.yml`) binds copy + conversion/tags/success from the entry field `call_to_action`. Same conversion + CRM tag rules as above. Non-effects: does not change form field layout or the shared shell structure — only entry field values.

