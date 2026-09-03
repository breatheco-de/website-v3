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

## Require Signup / account gate (`is_signup`)

Site contract lives in `settings.yml` → `auth.signup.field_map` (Consumer Auth UI at `/private/security/auth`).

Each row is one of:

- `{ key, from: "form.*" | "session.*", required? }` — `required` only for `form.*`
- `{ key, constant: "…" }` — non-empty fixed literal on every signup
- `{ key, global: "global.*" }` — resolved at submit from site Variables (missing → `""`)

**GTM auth events** (not the lead conversion webhook): `tracking.signup_event_name` / `tracking.login_event_name` (defaults `sign_up` / `login`). Renames keep prior names in `signup_event_aliases` / `login_event_aliases` — all matchers resolve aliases; runtime fires the **canonical** name. Configure at `/private/store/conversions` (Signup and Login card).

When `is_signup: true`:

- If `allow_signup` is not `false`: site `field_map` must be non-empty; every `form.<name>` in the map must exist; required map rows need `fields.<name>.required: true`. Constant/global rows do not require form fields.
- If `allow_signup: false`: login-only (no account create / no field_map requirement for enable).
- `conversion_name` is **required** (catalog name or explicit `null` / Off) — the account gate does not waive it. Choosing the site signup/login event *is* the conversion. If `conversion_name` equals the auth event (canonical or alias), GTM fires once from the auth action — not again on lead submit.
- Account gate is **form-level** (not per-route).
- MCP edit-sections identity failures surface `action_required: fix_signup_field_map` + `next_actions`.
- Does **not** write form YAML; field_map lives only in `settings.yml` → `auth`.
Hidden plan default for free signup:

```yaml
fields:
  plan:
    visible: false
    required: true
    default: "{{ global.default_free_signup_plan | 4geeks-basic-subscription }}"
```

Live submit builds the body from the map only (no legacy payload merge). `conversion_info` is always appended in code — not editable in the map.

No magic aliases: `payload.course` ← `form.program` only if that mapping row exists.

## Free plan grant (silent — subscribe ≠ subscription)

`POST /v1/auth/subscribe/` creates the user and attaches the plan to the UserInvite only. It does **not** create a Subscription or consumables.

When `is_signup` resolves a non-empty plan (form `fields.plan` and/or `field_map` plan row), after signup (or for an already-logged-in visitor) the runtime silently calls `POST /api/auth/grant-free-plan`, which proxies Breathecode:

1. `PUT /v2/payments/checking` (PREVIEW bag)
2. `POST /v2/payments/pay` (free invoice → `build_free_subscription`)

**UI unchanged:** same form → same redirect to LearnPack with `?token=`. Grant runs between token save and lead/redirect. Blocking only if grant fails (so LearnPack is not opened without consumables). Idempotent upstream errors (trial already took / already subscribed) count as success.

Non-effects: does not change lead webhook payload; does not add checkout UI; without a plan slug there is no grant.

Shared helper: `shared/grantFreeSubscription.ts`. Server route: `server/routes/auth.ts` → `/api/auth/grant-free-plan`.

## Paths

- Parse: `shared/parseFormFieldSource.ts`
- Catalog API: `server/query-options.ts`
- Index: `server/ecommerce/ecommerce-index.ts`
- Runtime: `client/src/components/lead_form/variants/LeadFormDefault.tsx`
- Signup field map: `shared/authSignupFieldMap.ts`
- Free plan grant: `shared/grantFreeSubscription.ts`
- Auth conversion events: `shared/authConversionEvents.ts`
- Staff UI: `client/src/components/editing/FormFieldsCard.tsx` / `RequireSignupCard.tsx` / `client/src/components/settings/AuthTab.tsx` / Conversions page
