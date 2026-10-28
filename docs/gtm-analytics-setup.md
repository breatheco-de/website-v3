# GTM & Analytics Setup Guide

This document describes how to configure Google Tag Manager (GTM) and GA4 to work with the tracking layer in this project. It covers how `visitor_id` (formerly `user_id`) flows through the dataLayer, how GTM tags should be configured to read it, and what QA steps to follow when verifying tag behaviour.

---

## Overview

The site uses a client-side `dataLayer` (via GTM) to send tracking events and user context to GA4. The tracking module lives at `client/src/lib/tracking.ts`.

## How `visitor_id` reaches GTM

### Session-level push (once on load)

After the session worker fires `SESSION_READY`, `setVisitorContext()` in `client/src/lib/tracking.ts` pushes a single dataLayer object that contains visitor context including `visitor_id`:

```js
// Fired once per page load via setVisitorContext()
window.dataLayer.push({
  visitor_id: "uuid-v4-...",
  visitor_location_city: "...",
  visitor_location_country: "...",
  visitor_language: "en",
  utm_source: "...",
  // ... other session fields
});
```

### Per-event push (every event) — important note

> **`visitor_id` is now included on every individual dataLayer push, not only on the session-level push.**

Both `track()` and `trackConversion()` read the visitor ID directly from the `4g_visitor_id` (or fallback `4g_user_id`) cookie and attach it to each event object:

```js
// Example: conversion event push
window.dataLayer.push({
  event: "student_application",
  visitor_id: "uuid-v4-...",   // ← present on every event
  email: "jane.doe@example.com",
  email_hash: "...",           // legacy DLV; SHA-256 truncated
  program: "...",
});

// Example: general tracking event push
window.dataLayer.push({
  event: "page_view",
  visitor_id: "uuid-v4-...",   // ← present on every event
  // ...
});
```

This means GTM tags do **not** need to rely on the session-level dataLayer variable scope to access `visitor_id`. It is always available as a direct property of the event object.

---

## Data Layer Variables

Configure the following Data Layer Variables (DLVs) in GTM:

| GTM Variable Name   | Data Layer Key              | Description                          |
|---------------------|-----------------------------|--------------------------------------|
| DLV - visitor_id    | `visitor_id`                | Stable user identity (UUID)          |
| DLV - utm_source    | `utm_source`                | UTM source parameter                 |
| DLV - utm_medium    | `utm_medium`                | UTM medium parameter                 |
| DLV - utm_campaign  | `utm_campaign`              | UTM campaign parameter               |
| DLV - utm_content   | `utm_content`               | UTM content parameter                |
| DLV - utm_term      | `utm_term`                  | UTM term parameter                   |

Name the primary variable `DLV - visitor_id`.

---

## GTM Configuration

### Reading `visitor_id` in tags

When configuring GA4, Meta Pixel, or any server-side tag:

- **Prefer the event-level field**: because `visitor_id` is present on every dataLayer push as a direct property, the Data Layer Variable above will always resolve to the current value without depending on GTM's session scope or variable persistence.
- Do **not** rely solely on the session-level push to populate the variable — if a tag fires before `SESSION_READY` completes (e.g., via a custom trigger), the session-level push may not have occurred yet. The event-level field guarantees it is present.

### GA4 Tag — recommended event parameter mapping

In your GA4 Configuration tag or individual event tags, add a custom parameter:

| Parameter Name | Value |
|---|---|
| `visitor_id` | `{{DLV - visitor_id}}` |

This stitches every GA4 event to the same visitor identifier used in A/B variant assignments and server-side logs.

---

## Conversion Events

The following conversion events are tracked and should be configured as GA4 conversion events in GTM:

| Event Name                 | Trigger                                      |
|----------------------------|----------------------------------------------|
| `student_application`      | Student applies to a program                 |
| `request_more_info`        | User submits a "more info" form              |
| `financing_guide_download` | User downloads the financing guide           |
| `partner_application`      | Partner submits an application               |
| `job_application`          | User applies for a job                       |
| `newsletter_signup`        | User signs up for the newsletter             |
| `contact_us`               | User submits a contact form                  |
| `outcomes_report`          | User downloads the outcomes report           |
| `sign_up`                  | Account create on account-gated form (site `tracking.signup_event_name`; aliases after rename) |
| `login`                    | In-form login on account-gated form (site `tracking.login_event_name`) |

Auth events are configured on Conversions → Signup and Login (`signup_event_name` / `login_event_name`). They push to the dataLayer only (not the lead conversion webhook). When a form’s `conversion_name` is the signup/login event, do not expect a second form-submission push of the same name.

### Count as lead (`counts_as_lead`)

Each `tracking.conversion_events[]` entry has a required `counts_as_lead` boolean (staff must choose on create/save). Product journey **lead conversion** KPIs only count events with `counts_as_lead: true`, plus the current canonical signup event (always on). Login is never counted as a lead.

This is independent of GTM / Google Ads / Meta conversion mapping: the form still fires to the dataLayer either way; ads platforms only count the event if you map that event name there. It is also independent of Leads diagnostics allowlists (`leads_expected_conversion_names`).

### Purchases KPI

GA4 `purchase` is fired off-site (checkout), not on marketing page URLs. Product journey analytics expose a product-scoped **Purchases** total (matched by `item_id` / `program_id` / `program`) separate from lead conversions and ecommerce intent. Page rows do not show purchases (path-scoped purchase would almost always be zero).

All conversion events include `visitor_id` in the dataLayer push.

### Product identity on conversions (`item_id`)

Lead forms may set `ecommerce_product_field` (default `program`) — the submit field used to resolve ecommerce product identity. Resolution uses page `funnel.products` (same rules as ecommerce tracking) and the product map (`_ecommerce.yml`).

When resolve succeeds, the conversion dataLayer push **dual-writes**:

- `program` — unchanged CRM / webhook value from the form
- `item_id` — ecommerce `product_id` (same as `trackEcommerce`)
- `program_id` — content slug

GTM must register `item_id` (and ideally `program_id`) as GA4 event parameters on conversion tags so BigQuery exports include them. If the user pick is outside the page funnel, CRM still receives `program` but analytics `item_id` is omitted.

Site-wide **leads by traffic source** (`get_analytics_report` → `traffic_source_conversions`) uses Count as lead event names, session last-click attribution by default (falls back to `collected_traffic_source` / `traffic_source` when needed), and optional `item_id` to slice product leads. Empty `item_id` on lead events is excluded from that slice (reported as a warning) — this change does not add a content validator for forms.

## General Tracking Events

| Event Name            | Description                        |
|-----------------------|------------------------------------|
| `page_view`           | Fired on each page navigation      |
| `experiment_exposure` | Page test version this visitor saw (see Page tests below) |
| `cta_click`           | User clicks a call-to-action       |
| `video_play`          | Reserved. Not sent. YouTube plays are `gtm.video` from Tag Manager; files use the events below. |
| `video_start`         | A file or other embed started for real. Not the muted card. Not YouTube. |
| `video_progress`      | File playback crossed 10, 25, 50, or 75 percent. `video_percent` says which. |
| `video_complete`      | File playback reached the end, once, even if it loops. |
| `scroll_depth`        | User scrolls to a depth threshold  |

### Video playback

YouTube and files are measured differently. Leave GA4 **Enhanced measurement → Video engagement** on. The site does not push events for YouTube. Do not turn on the Tag Manager option that adds the YouTube JavaScript API to every embed.

- **YouTube without the listen card** follows autoplay. When autoplay is on, a muted player starts on load at `www.youtube.com` with `enablejsapi=1`, and the page hooks it so Tag Manager counts that play (`gtm.video` on load). When autoplay is off, the thumbnail stays until click, and that click opens the same counting player. The site does not push `video_start`. Tag Manager pushes `gtm.video` (shown as YouTube Video). The dataLayer event name stays `gtm.video`; Video Status is `start`, `progress`, or `complete`. A scrub that jumps past a percent does not send that progress mark. YouTube embeds never loop, so the player can end and Tag Manager can send complete.
- **YouTube with the muted card** previews on `youtube-nocookie.com` without `enablejsapi`. Loading the page does not count. The click opens the `youtube.com` player, the page hooks that one, and Tag Manager counts from there.
- **A file** (`.mp4`, `.webm`, `.mov`, `.ogg`, `.m4v`, or a path starting with `/`) pushes `video_start`, `video_progress`, and `video_complete` through `track()`. The muted card does not push `video_start`. Autoplay without that card does. Each progress percent is sent once per play, when playback passes it. Dragging past a percent does not send it. Closing the player and opening it again, restarting after the end, or a loop sends `video_start`, progress, and `video_complete` again.
- **Another embed** (Vimeo, or a non-file URL) pushes only `video_start` on the play click.

File events use the same video fields Tag Manager already sends for YouTube: `video_url`, `video_title`, `video_provider` (`file`), `video_duration`, `video_current_time`, `visible`, and on progress `video_percent`. `user_id` is the anonymous browser id added by `track()`, not an email.

In the web GTM container, forward `gtm.video` to the server by Video Status (`start` → `video_start`, `progress` → `video_progress`, `complete` → `video_complete`). Do not also forward a `video_start` from the page for YouTube. Files still need a custom-event trigger and a GA4 event tag for `video_start`, `video_progress`, and `video_complete`.

Check Tag Assistant on a YouTube landing. With a listen card, `gtm.video` is absent on load and appears after the click. Without a card and with autoplay on, `gtm.video` can appear on load. `video_start` from the page does not appear for YouTube.

### Page tests (A/B versions)

Page tests run only after **Settings → Tracking → A/B testing → Setup** passes for the site. Until then every visitor sees Default.

**What the site sends**

- `experiment_exposure` with `experiment_id` and `variant`, once per page and version. Sent for every test participant, including the Default group (`variant: "default"`).
- `experiment_id` is `contentType:slug:locale@YYYY-MM-DD` (the test run's start date). Tests started before run dates existed have no `@date`. Two tests started the same day on the same page share an id.
- Before Tag Manager loads, tested pages write `{ experiment_id, variant }` into the dataLayer (no event), so `page_view` and every later event can read them.
- Conversion pushes (form submissions and other conversions) carry the visit's **first** test: `experiment_id` and `variant` from the `4g_visit_exp` cookie (30 minutes, refreshed on activity, shared across tabs, like a GA4 session). The CRM lead uses the same rule and the same field names (`experiment_id` / `variant`).
- Staff, bots, and forced previews (`?force_variant=`) are never put in a test and send no exposure.

**Web container**

1. Data Layer Variables: `DLV - experiment_id` → `experiment_id`, `DLV - variant` → `variant`.
2. GA4 event tag `experiment_exposure`, triggered by the custom event `experiment_exposure`, with event parameters `experiment_id` and `variant`.
3. Add both as shared event parameters on the Google tag (so `page_view` carries them) and as event parameters on conversion tags.

**Server container**

The GA4 client and GA4 tag pass event parameters through. Check that no parameter filter or transformation strips `experiment_id` / `variant`.

**GA4**

- Register event-scoped custom dimensions `experiment_id` and `variant`: from **Settings → Tracking → A/B testing → Google Analytics** (Create them) or by hand in GA4 Admin → Custom definitions. Without them, GA4 reports can't split by version; the BigQuery export still has the parameters.
- Per-version Explorations: segment sessions that include `experiment_exposure` with `variant` = `b` (and one for `default`), then compare sessions, engagement and key events.
- Keep the event and parameter names: `server/ads/paid-detection.ts` reads `experiment_exposure` / `experiment_id` / `variant` from BigQuery for the paid and organic per-version numbers.

**Known gap**

Web GTM loads on first interaction or after 15 s. Visitors who leave sooner are in the server counts but never reach GA4.

### Product and persona

Every event carries the page's product and persona, once the site's tracking switch is on (Settings → Tracking → Events → Product & persona on events; staff setup steps are in that card's **Setup instructions**).

**What the site sends**

| Key | Value |
|---|---|
| `product` | Product short codes, comma-joined (`afx,aie`) |
| `persona` | Persona short codes (`cc,exp`) |
| `product_persona` | `product:persona` code pairs (`afx:exp,aie:cc`); `aie:` = product without persona |
| `funnel_stage` | `awareness`, `consideration`, `decision`, `post-enrollment` |
| `content_key` | Page `type:slug` (`landing:apply`) |
| `tracking_truncated` | `true` when a list was cut |

- Lists are cut at a whole code to 100 characters (GA4's limit per value). The cut keeps the funnel's first codes; the kept codes are then **sorted**, so the same audience always sends the same string. Events sent before 2026-10-25 may hold the same set in two orders.
- `all` = the page's funnel covers every product; `none` = a content page without a funnel.
- The server writes these keys into the dataLayer before Tag Manager loads (`server/utils/html-inject.ts`), so the first `page_view` carries them; later events add them on every push (`client/src/lib/tracking.ts`).
- Leads and the CRM get full ids (`ai-engineering`, `the-career-changer`), sorted and never cut. Translate codes with **Download code list** on the same card.

**Web container**

1. One Data Layer Variable per key (version 2): name `DLV - product`, Data Layer Variable Name `product`, and so on for all six.
2. A Google Tag: Event Settings variable with the six event parameters (name = key, value = `{{DLV - <key>}}`), attached to the Google tag under Shared event settings (so `page_view` carries them) and to every GA4 event tag under Event Settings Variable.

**Server container**

Nothing to add: the GA4 client turns the parameters into event data and the GA4 tag forwards them. Check that no "exclude parameters" or "allow parameters" transformation drops the six keys. Other server-side tags (Meta CAPI, Ads) need Event Data variables only if they should send these values.

**GA4**

- Register the six as event-scoped custom dimensions: **Create them** on the card, or GA4 Admin → Custom definitions. Not retroactive.
- A value is one string per event, so `cc,exp` is its own row. To include every event with one code, filter with **matches regex** `(^|,)cc(,|$)` (plain "contains" also matches longer codes that contain `cc`).

**BigQuery**

Split lists before counting; never group by the raw string:

```sql
SELECT code, COUNT(*) AS events
FROM `project.analytics_<property_id>.events_*`,
  UNNEST(SPLIT((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'persona'), ',')) AS code
WHERE _TABLE_SUFFIX BETWEEN '20261001' AND '20261031'
  AND code NOT IN ('', 'all', 'none')
GROUP BY code
ORDER BY events DESC
```

In app code, use `parseTrackingList` / `decodeTrackingCodes` / `decodeTrackingPairs` from `shared/tracking-context.ts`. Persona full ids can repeat across products: take the product from `product_persona`; a shared id without a pair has no product (never guessed). Lead counts by product / persona: Leads page cards **Product on page** and **Persona**, or `get_leads_breakdown` (`funnel_products`, `funnel_personas`).

---

## QA Checklist

Use this checklist when verifying that `visitor_id` flows correctly end-to-end.

### Browser-side verification

- [ ] Open browser DevTools → Console and filter for `[Tracking]`.
- [ ] On page load, confirm a `[Tracking] Visitor context set:` log appears and includes a non-empty `visitor_id` UUID.
- [ ] Submit a form or trigger a conversion. Confirm a `[Tracking] dataLayer.push:` log appears for the event and the object includes `visitor_id`.
- [ ] Trigger a general tracking event (e.g., scroll depth, CTA click). Confirm the push object also includes `visitor_id`.
- [ ] Confirm `visitor_id` in the event objects matches the value in the `[Tracking] Visitor context set:` log — all three values should be the same UUID for a given browser session.
- [ ] Open Application → Cookies and verify a cookie named `4g_visitor_id` exists with a non-empty UUID value.

### GTM Preview mode verification

- [ ] Open GTM → Preview mode and load a page.
- [ ] In the Tag Assistant panel, inspect the **Data Layer** tab after the page fires.
- [ ] Confirm the session-level push contains `visitor_id`.
- [ ] Trigger a conversion or tracking event. In the Data Layer tab, confirm the individual event push **also** contains `visitor_id` as a top-level key (not nested).
- [ ] Click on a tag that uses `{{DLV - visitor_id}}`. In the Variables section, confirm the variable resolves to a non-empty UUID.
- [ ] Verify the variable value is consistent across all event pushes in the same session.

### Cross-session / cookie persistence verification

- [ ] Note the `visitor_id` value from the DevTools cookie.
- [ ] Reload the page and confirm the same `visitor_id` appears in subsequent dataLayer pushes.
- [ ] Open an incognito window. Confirm a **different** `visitor_id` is generated.

### Server-side tag verification (if applicable)

- [ ] Confirm the server-side GTM container receives `visitor_id` in the event data for every inbound event.
- [ ] Confirm the field name is exactly `visitor_id` (snake_case, no camelCase variant).
- [ ] Cross-reference a known `visitor_id` against server-side logs to confirm stitching works end-to-end.

---

## Cookie Reference

The full cookie list (names, lifetimes, consent category, what each stores) lives in [cookies.md](cookies.md). Keep it as the single source of truth.

---

## HTTP Headers

The frontend sends the following session headers with every API request:

| Header              | Value                        |
|---------------------|------------------------------|
| `X-User-Id`         | The user's stable UUID       |
| `X-Session-Location`| Location campus slug         |
| `X-Session-Region`  | Geographic region            |
| `X-Session-Locale`  | Active locale (`en` or `es`) |

---

## Relevant source files

| File | Purpose |
|---|---|
| `client/src/lib/tracking.ts` | All dataLayer push logic; `visitor_id` is attached to every push |
| `client/src/lib/sessionBootstrap.ts` | Cookie read/write helpers (`getVisitorIdFromCookie`, `setVisitorIdCookie`) |
| `client/src/contexts/SessionContext.tsx` | Calls `setVisitorContext()` after `SESSION_READY` |

---

## Ecommerce funnel events

Purchasable-gated events via `trackEcommerce()` in `client/src/lib/tracking.ts`. Staff hub: `/private/store/ecommerce`. Product scope prefers section binds (`ecommerce_products`, `programs[].id`, inherit) — see `shared/resolveProductScope.ts` and `explain_site` topic `ecommerce`. CMS does not manage a billing plan catalog.

| Event | When | Notes |
|-------|------|-------|
| `view_item` | Hero `course` when product resolves | Scope / program page / CTA `?program=` |
| `add_to_cart` | CTA `tracking: add_to_cart` | Configurator handoff (`/payment-component`) or enrollment CTA |
| `view_item_list` | enrollment_selector / pricing_plans visible | Once per mount; skip edit mode |
| `select_item` | User changes enrollment program | Debounced; includes selection fields |
| `click_begin_checkout` | CTA `tracking: click_begin_checkout` | Checkout CTA click on this site |
| `begin_checkout` | Off-site only (learn.4geeks) | **Not fired** from this site |
| `purchase` | Off-site only | **Not fired** from this site |

CTA intent is explicit `cta.tracking` (field-editor `cta-tracking`), not URL sniffing at runtime. See `docs/component-behaviors.md`.

### Payload split

- **Central** (`trackEcommerce`): purchasable gate; flat `item_id` / `item_name` / `item_category` / `user_id` from the product map (`programs/{slug}/_ecommerce.yml`). No GA4 `items[]` array.
- **Enrollment call site** may also send (omit when N/A):
  - `item_list_name`: `"enrollment_selector"`
  - `selected_plan_option`: `programs[].plans[].id` (e.g. `basic` / `pro`) — **not** learn.4geeks billing `plan`
  - `amount` / `period_label`: from the selected plan (plan mode); in date mode `amount` may be `summary.price_amount` (display string, not GA4 revenue `value`)
  - `cohort_date`: selected `date_iso` (date mode)
  - `addon_id`: `addon.id` when the addon toggle is on
- **Hero**: `program_id` from product scope / CTA `?program=` / career-program path; CTA click awaits product-map load
- **Pricing**: `item_list_name: "pricing_plans"` on `view_item_list`

Non-effects: does not change lead `trackFormSubmission`; does not fire `begin_checkout` or `purchase` on-site (`click_begin_checkout` is the site CTA intent); `cta_banner` has no ecommerce wiring.
