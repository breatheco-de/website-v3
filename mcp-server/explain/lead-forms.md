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
- `options[]` overlays marketing labels / **title** / description / icon / cta / **badge** — **does not filter**.
- `label` = closed input / select / list text. Optional `title` = card heading on `component_renderer: cards` (falls back to `label`).
- `badge` on an option shows a chip on `component_renderer: cards` (ignored by select / simple-list / grouped-list).
- `layout: grid | showcase` on the field (cards only). Omit / `grid` = equal columns. `showcase` = first option full-width, remaining options in a row below (order = array order).

## `ecommerce_product_field`

Which submit field resolves ecommerce product identity for GA (`item_id`):

```yaml
conversion_name: student_application
ecommerce_product_field: program   # default; set explicitly on authored forms
```

- Default is `program` when omitted.
- Page `funnel.products` limits which picks get analytics `item_id` (funnel wins). Stage / money-page inventory → topic `funnel`.
- Does **not** change CRM/webhook `program` values.
- Topic `ecommerce` for product map / `item_id` alignment.
- `slugs` is ignored when `source` is set.
- EN and ES are separate files — no locale fan-out.

## Typical paths (example corpus — confirm on the target site)

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
3. `get_entry_fields` with `fields: [...]` (omit once to list names) / `get_entry_content` — this entry’s pointers (`programs: […]`), computed `purchasable`, and current form YAML.
4. Confirm the subset with the user: vendible catalog (`query: purchasable=true`) vs slug subset vs `related_field`.
5. Catalog forms on an ecommerce type **must** set `source.query`. Typical: `purchasable=true`. Exception: form **on a non-purchasable program page** → that program only (`source.related_field` or `query: "slug=<this>"`), not the vendible catalog. Purchasable program pages that already inherit one product: leave related_field/inherit.
6. Writes missing `query` and/or `value_path`/`label_path` return `actionRequired`. Re-call `update_fields` / `add_section` with the merged source complete. Real tools only — no `validate_content`. Do **not** guess paths.
7. `get_entry_fields` with `fields: ["purchasable"]` (or related paths) / `get_entry_content` show computed `purchasable` (`writable: false`). Do **not** write `single.purchasable`. Edit `_ecommerce.yml` or use `get_product_funnel` (journey read). Page funnel stage/products → topic `funnel`.

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
- `conversion_name` is **required** (catalog name or explicit `null` / Off) — the account gate does not waive it. Choosing the site signup/login event *is* the conversion. If `conversion_name` equals the auth event (canonical or alias), GTM fires once from the auth action — not again on lead submit. The signup push uses the same lead dataLayer body as any other form conversion (identity, consents, `submission_id`, ecommerce `item_id` when resolved, and other non-empty `fields.*` such as `utm_medium`). Login stays email-only.
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

## Continuous `form_overrides` + `{{ visitor.* }}`

First matching override overlays the form root for **UI and submit** (not submit-only). Plain objects (`messages`, `success`, `webhook`) deep-merge.

```yaml
form_overrides:
  - conditions:
      - entry_field_slug: registered_attendee_ids
        match_method: contains   # equals (default) | contains
        value: "{{ visitor.id }}"
      - entry_field_slug: event_started
        value: "true"
    messages:
      ready:
        subtitle: You have already signed up…
        submit_label: Join
        submit_disabled: true   # optional — disables submit in this phase
    success:
      url: "https://…/join?token={{ visitor.token }}"
  - conditions:
      - entry_field_slug: event_started
        value: "false"
    webhook:
      url: "https://…/checkin"
      method: POST
      headers:
        Authorization: "Token {{ visitor.token }}"
    success:
      url: "#workshop-rsvp-success"
      reload_entry_fields: true
```

- **`form_field_slug`:** compare against a submitted form field (e.g. `program`).
- **`entry_field_slug`:** bare entry field path looked up on `singleEntry` at match time (e.g. `event_started`). Do **not** use `{{ entry.* }}` here — section `resolveDeep` would replace the template before LeadForm runs. Listing `item_property_slug` is unrelated.
- **`match_method: contains`:** substring on strings; membership on arrays of scalars/ids. Not deep object search.
- **Condition `value`:** `resolveDeep` — literals or `{{ visitor.* }}` (logged-in auth profile + `visitor.token`). Logged out → unresolved → contains fails → normal form.
- **Order matters:** put already-registered overrides before generic live/upcoming.
- **Webhook default is strict** (await upstream; 502 → no success UI). `webhook.fail_silently: true` = fire-and-forget.
- **`webhook.headers`:** outbound headers; use `Authorization: "Token {{ visitor.token }}"` instead of removed `use_visitor_token`.
- **`success.reload_entry_fields`:** invalidate entry page query after success so overrides re-resolve.
- **Resolver:** `shared/resolveLeadFormOverride.ts`. Example: `stacked_with_routes.yml`. Detail: `explain_site` sections → Lead form form_overrides.

## Hidden field defaults → lead body + GTM

Declared `fields.*` values (including keys that are not UI slots) ship on **both** the webhook/lead body and the GTM `dataLayer` push.

```yaml
fields:
  event_id:
    visible: false
    default: "{{ entry.id }}"
  event_slug:
    visible: false
    default: "{{ entry.slug }}"
conversion_name: event_order
```

- Wire serialization keeps the **hardcoded BC field set** (`buildLeadPayload`) and **known GTM keys** (`trackFormSubmission`), then merges any other scalars through. `program` → `course`; `consent_whatsapp` → `consent`; `conversion_name` is lookup-only (not on the outbound body).
- Extra keys are **not** rendered yet (UI slots stay hardcoded). Use `visible: false` + `default` for Learn-style `event_*` payload keys. `{{ entry.* }}` is resolved by section `resolveDeep` before the form mounts — submit copies those values onto the lead body and dataLayer. Resolved defaults may be **string, number, or boolean** (e.g. numeric `entry.id` → `event_id`); empty strings are skipped.
- Do **not** put `fields` on `form_overrides` for phase differences — change `conversion_name` / webhook / success instead.

## Campaign context + ledger fields (added by code, not YAML)

Every submit (`POST /api/leads/webhook-delivery`) is enriched server-side before `buildLeadPayload`:

| Key | When | Meaning |
|---|---|---|
| `submission_id` | always | Per-submit id (client UUID, server fallback). Not the authored `event_id`. Also on the GTM conversion push. |
| `is_test` | always (boolean) | Staff session (`X-Debug-Token`) or email matching `ads-config.yml` → `test_email_patterns` (legacy `settings.yml` → `ads.test_email_patterns` until migration 004 runs). Still delivered; excluded from Ads reports. |
| `test_reason` | only when `is_test` | `staff_session` \| `email_pattern` |
| `is_staff` | always (boolean) | `true` only for `test_reason: staff_session` (server-verified staff session). Email-pattern test leads are `is_test: true`, `is_staff: false`. Every GTM dataLayer push also carries `is_staff` (browser staff token), so GTM can skip conversion tags or set GA4 `traffic_type: internal`. |
| `is_repeat` | always (boolean) | Same browser + same `conversion_name` within 24h. Still delivered; counted as a submission, not a lead. |
| `repeat_of_submission_id` | only when `is_repeat` | First submission in the window. |
| `gclid` `fbclid` `msclkid` `ttclid` `li_fat_id` … | when present | Per-platform click ids (`ppc_tracking_id` kept for back-compat). |
| `utm_id` `fbp` `fbc` | when present | Meta campaign id (URL template), Meta browser / click ids. |
| `first_utm_*` | when present | Write-once first campaign set in this browser. |
| `landing_url` / `conversion_url` | always | First page in this browser / page where the form was sent. |
| `first_paid_landing_*` / `last_paid_landing_*` | when a paid visit was seen (≤30 days) | URL + ISO time. |
| `ad_platform` | paid/unclear visits | `meta` \| `google` \| … |
| `experiment_id` / `variant` | visitor saw a page test this visit | Same names as GTM conversion pushes. First test seen this visit (form body `page_experiment_id`, else cookie `4g_visit_exp`: 30 min, cross-tab), accepted only when it matches the visitor's assignment in `4g_versioning_v2`; otherwise both are omitted (body values with these names are dropped). `variant` is a variant slug or `default` (live page during the test). Leads before 2026-10-27 used `page_experiment_id` / `page_variant`. Id format `contentType:slug:locale@YYYY-MM-DD` (run start; no `@date` on tests started before run dates). Leads before the A/B tracking fix used a buggy split (Default's share went to the first variant). |
| `consent_state` | always | `granted` \| `denied` \| `unset` (tracking banner). |
| `channel` `first_channel` `channel_landing_path` `referrer_host` | sent by current pages (session `entry_channel`) | Ledger-only: saved on `lead_submissions` (plus `last_organic_channel`, `country`, `traffic_status`), **stripped before the CRM**. Rules → topic `ads` (Lead channel). |

- Source precedence: HttpOnly `4g_ads` cookie (only after tracking consent) → in-memory session in the request body (same-visit leads before consent).
- The server ledger (`lead_submissions` in pipeline SQLite) stores **no** name / email / phone; 25-month retention. CRM owns personal data.
- Non-effects: YAML `fields.*` defaults with the same key win only when enrichment has no value (enrichment keys override raw body keys).
- UTM checks: the latest `utm_*` per non-test ledger row (with an `ad_platform`) feed the Ads UTM checks as observed evidence (topic `ads` → UTM convention and checks). Values are never rewritten on the lead or in the CRM.
- Internal UTMs (`utm_source` = this host or its parent domain, e.g. `4geeks.com` on `4geeks.com`) are now ignored by the visitor session: they no longer replace stored campaign tags or click ids. Other org sites still count as ordinary referrals.
- Lead counts by channel, source / medium, page, experiment or product: `get_leads_breakdown` (topic `ads` → Leads breakdown).
- Same-site links with `utm_*` in content YAML raise `INTERNAL_LINK_HAS_UTM` (validator `internal-link-utm`, warning): they restart the GA4 session and overwrite the visitor's real source, so paid visits and leads can be credited to the wrong source. Links to other domains (including the org's other sites) are not flagged.

## Product / persona on leads and events

Every event and lead carries the page funnel's products / personas (topic `product` → Tracking short keys).

| Destination | Values |
|---|---|
| dataLayer / GA4 (`product`, `persona`, `product_persona`, `funnel_stage`, `content_key`, `tracking_truncated`) | **Short codes** (`aie`, `cc`, `aie:cc`), comma-joined, cut at a whole code to 100 chars (keeps the funnel's first codes), then **sorted** so the same audience is always the same string. Only once the site's tracking switch is on. |
| Lead body → CRM webhook + ledger (`product`, `persona`, `product_persona`) | **Full ids** (`ai-engineering`, `the-career-changer`), sorted, never cut, always sent. Ledger stores `product` / `persona` (since launch) and `product_persona` (since pipeline migration 42); older rows null. |

- Reading values back: split with `parseTrackingList` / `decodeTrackingCodes` / `decodeTrackingPairs` (`shared/tracking-context.ts`); never group by the raw string. GA4 data sent before sorting (2026-10-25) can hold the same set in two orders. Persona full ids can repeat across products: use `product_persona` pairs for the product; a shared id without a pair has no product (never guessed).

- Default: the page funnel (`effectiveBindings`; program page includes itself). `funnel.products: all` → `all`; content page without funnel → `none`.
- CTA YAML passes that id triple with `{{ entry.funnel_products_encoded_ids }}` (URI-encoded JSON; program, landing, and page). `{{ funnel.products }}` is the stored list, not that string. Form hidden `product`/`persona` overrides do not change either token.
- Override per form with hidden fields (no schema change — `fields` accepts extra keys; also inside `form_overrides[].fields`):

```yaml
fields:
  product: { visible: false, default: ai-flex }        # full id (preferred) or short code
  persona: { visible: false, default: the-explorer }   # optional
```

- Product override without persona → only the personas the page funnel binds to those products (`"all"` page → none; no funnel → `none`).
- Invalid overrides are **sent as written** (never corrected). Diagnostics (`forms` validator) warns: `FORM_UNKNOWN_TRACKING_PRODUCT`, `FORM_UNKNOWN_TRACKING_PERSONA`, `FORM_TRACKING_PERSONA_PRODUCT_MISMATCH`, `FORM_TRACKING_OVERRIDE_USES_CODE` (codes work; full id preferred).
- Non-effects: `item_id` / `program_id` (ecommerce product resolution) and CRM `program` / `course` are unchanged.

## Consent checkboxes (mandatory rule)

Every lead form must show at least one checkbox visitors must tick. Effective consent = form `consent` + conversion event `consent` defaults (form wins per key) + site Default (`settings.yml` → `consent.fallback`).

| Shown on the form | Mandatory |
|---|---|
| `general` (and/or `marketing`) | General and Marketing are each mandatory whenever shown; both shown → both mandatory (validator warning `FORM_TWO_REQUIRED_CONSENTS`) |
| neither, custom consent `consent.<field>: true` (with copy) | first custom consent (Settings order) |
| none of the above | the site Default appears and is mandatory |
| none + site has no Default | nothing → `FORM_NO_REQUIRED_CONSENT` (error) + publish blocked |

- SMS, Email and WhatsApp are **always optional** and never count. `marketing: true` hides the separate Email / WhatsApp checkboxes (their CRM values follow the Marketing checkbox).
- `sms_usa_only: true`: SMS shows only for US visitors by two-letter `country_code` — the location the visitor picked, else the detected session location; a location with unknown country (`XX`, e.g. `remote`) falls through to the visitor's geo `country_code`.
- Publish gate (`publish_draft`, `promote_variant`, staff publish, live `replace_all_sections`): refuses `consent_no_mandatory_checkbox` with `consent_forms[].property_path` and `fix_field_path` (`sections.N.<form>.consent.general`); `form_overrides` that switch `conversion_name` are checked as their own variant. Draft saves never block. A site with no Default adds warning `site_no_default_consent` to every publish; validator raises `SITE_NO_DEFAULT_CONSENT` (error).
- Non-effects: values sent to the CRM are unchanged (`consent_general` is sent as-is; General does **not** set marketing consent). Enforcement is browser-only (the server accepts leads without consent). Agents cannot change the site Default (staff Settings).
- Rule: `resolveConsentRequirement` in `shared/consent-settings.ts`; per-form check `shared/formConsentCheck.ts`; gate `server/consent-gate.ts`; validator `scripts/validation/validators/forms.ts`.

## Paths

- Ledger / enrichment: `server/ads/lead-ledger.ts`, `server/ads/ad-context.ts`, client `client/src/lib/leadAdContext.ts`
- Parse: `shared/parseFormFieldSource.ts`
- Catalog API: `server/query-options.ts`
- Index: `server/ecommerce/ecommerce-index.ts`
- Runtime: `client/src/components/lead_form/variants/LeadFormDefault.tsx`
- Form overrides: `shared/resolveLeadFormOverride.ts` / `client/src/lib/variable-manager.ts` (`visitor` bag)
- Signup field map: `shared/authSignupFieldMap.ts`
- Auth conversion events: `shared/authConversionEvents.ts`
- Staff UI: `client/src/components/editing/FormFieldsCard.tsx` / `RequireSignupCard.tsx` / `client/src/components/settings/AuthTab.tsx` / Conversions page
