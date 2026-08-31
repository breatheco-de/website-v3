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

All conversion events include `visitor_id` in the dataLayer push.

### Product identity on conversions (`item_id`)

Lead forms may set `ecommerce_product_field` (default `program`) — the submit field used to resolve ecommerce product identity. Resolution uses page `funnel.products` (same rules as ecommerce tracking) and the product map (`_ecommerce.yml`).

When resolve succeeds, the conversion dataLayer push **dual-writes**:

- `program` — unchanged CRM / webhook value from the form
- `item_id` — ecommerce `product_id` (same as `trackEcommerce`)
- `program_id` — content slug

GTM must register `item_id` (and ideally `program_id`) as GA4 event parameters on conversion tags so BigQuery exports include them. If the user pick is outside the page funnel, CRM still receives `program` but analytics `item_id` is omitted.

## General Tracking Events

| Event Name            | Description                        |
|-----------------------|------------------------------------|
| `page_view`           | Fired on each page navigation      |
| `experiment_exposure` | A/B test variant assignment        |
| `cta_click`           | User clicks a call-to-action       |
| `video_play`          | User plays a video                 |
| `scroll_depth`        | User scrolls to a depth threshold  |

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

| Cookie Name      | Description                                   | Max Age  |
|------------------|-----------------------------------------------|----------|
| `4g_visitor_id`  | Stable user identity (client-readable UUID)   | 180 days |
| `4g_user_id`     | Legacy user identity (fallback)               | 180 days |
| `4g_versioning`  | A/B test variant assignments (HttpOnly)       | 30 days  |

The cookie is set by `setVisitorIdCookie()` in `client/src/lib/sessionBootstrap.ts` and read by `getVisitorIdFromCookie()`, which is called inside every dataLayer push.

> **Note:** The legacy cookie name `4g_user_id` is still read as a fallback for backward compatibility, but all new sessions write to `4g_visitor_id`.

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
