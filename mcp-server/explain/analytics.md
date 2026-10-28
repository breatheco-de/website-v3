# Analytics (GA4 BigQuery reports)

Call this topic for **site-wide behavioral analytics** from the GA4 BigQuery export. Search Console → topic `seo` / `get_organic_traffic`. Product conversion journey KPIs → topic `product` / `funnel` / `get_product_funnel_analytics`.

## Which tool

| Tool | Data | Cap | Use when |
|------|------|-----|----------|
| `get_analytics_report` | GA4 `events_*` BigQuery; page_detail on Optimize for ads pages: site's own visit counts | `metrics_view` | Site summary, top pages, one page’s sessions/views, event counts, traffic sources, leads by source |
| `get_organic_traffic` | GSC clicks/impressions | `metrics_view` or `seo_edit` | Search demand, SERP risk, opportunities |
| `get_or_refresh_seo_research` | Planning research (keyword/SERP/ideas/competitors/gaps) | `seo_edit` | Estimates & SERP snapshots — not measured GSC clicks |
| `get_product_funnel_analytics` | Same GA4 export, scoped to a product journey | `content_view` | Per-SKU funnel page performance (not stage-to-stage flow) |

Do not treat GSC and GA numbers as the same metric. Journey analytics does **not** prove traffic moved between funnel stages. Planning research (`get_or_refresh_seo_research`) is not a substitute for `get_organic_traffic`.

## `get_analytics_report`

- **One report per call:** `site_summary` | `top_pages` | `page_detail` | `events_by_name` | `traffic_sources` | `traffic_source_conversions`.
- **Window:** `days` 1–90, complete UTC days ending yesterday (default 28). Expect ~1 day lag vs the GA UI.
- **page_detail identity:** pass `path` (public pathname/URL) **or** `content_type` + `slug` (+ optional `locale`). Bare slug alone fails. Response includes `resolved_paths`.
- **Statuses:** `ok` (including empty rows + `no_events_in_window` warning) vs `not_configured` (BigQuery disabled / missing project-dataset — staff `/private/tracking/ga4`).
- **Site:** every report reads the `site` it is called for (its BigQuery settings and pages), not the default site.
- **Non-effects:** Does not write content, call the GA Data API, or replace GSC / journey tools.

### `page_detail` source (GA4 vs the site's own counts)

- **Pick:** same as the staff page-stats drawer. Page whose content type has Optimize for ads on (`get_content_type_info` → `ads_optimized`) → `source: "first_party"` from `data/<site>/visits.db`; else GA4. Every page_detail response carries `source`.
- **`source` arg (page_detail only):** `ga4` forces GA4 (warning `drawer_uses_first_party` when the type is ads-optimized). `first_party` forces the site's own counts; fails when the type never used them.
- **Coverage:** the latest continuous on-period of Optimize for ads, from the first full UTC day after it was switched on, within the 90-day raw retention. Never stitched with GA4; an off-gap is not bridged.
  - `days` passed and reaching outside coverage → fails. Error `details { source, available_from, available_until, max_days }`. Retry with `days: max_days`, or `source: "ga4"` for longer history (different counting).
  - `days` omitted → shortened to the covered days. Top-level `days_shortened: true`, `window_start`, `window_end` + warning `first_party_window_shortened`.
  - No full day yet → fails with `collecting_since`.
  - Type switched off: default calls return GA4 (like the drawer). Explicit `first_party` → window ends on the switch-off day, `window_end_shifted: true` + warning.
- **first_party shape:** same `rows` / `totals` (`views`, `sessions`), `top_events: []` (warning `first_party_no_events`). Plus `totals.interactions { cta_clicks, form_starts, video_starts, video_completes }` and `totals.low_quality_excluded`.
- **Session rule (warning `first_party_counts`):** one session = one counted view of the page. Reloads, back/forward, bots, logged-in staff and suspected low-quality visits are left out; views count every page view. Not comparable with GA4 sessions.
- **Small samples:** `low_sample: true` + warning `first_party_low_sample` below 100 sessions (the drawer's minimum). Do not claim rates or winners.
- **Works without BigQuery** (first_party path never queries it).

### `traffic_source_conversions`

Answers “which traffic sources bring leads?” (not sessions alone).

- **Dimensions:** `source`, `medium`, `campaign` (missing → `(direct)` / `(none)` / `(not set)`).
- **Metrics:** `sessions`, `leads` (**event counts** from Count as lead / `getLeadConversionEventNames`), `lead_rate` (`leads/sessions`).
- **Sort:** `leads` desc, then `sessions` desc (converters first). `traffic_sources` remains sessions-first.
- **`attribution`:** default `session_last_click` (ops — prefer session last-click fields, then collected, then `traffic_source` with warning). Pass `first_user` for TOFU / first-touch.
- **`item_id` (optional):** filters **lead** events to that ecommerce `product_id` only; sessions stay channel-level → warning `lead_rate_channel_sessions`. Leads with empty `item_id` are excluded and counted in `totals.leads_missing_item_id` + warning (no content validator forces `item_id`).
- **Session mode unattributed:** leads without `ga_session_id` excluded from rows → `totals.leads_unattributed` + warning.
- **Empty Count as lead catalog:** `ok` with sessions/`leads: 0` + `no_lead_events_configured` (or `counts_as_lead_not_configured` when flags never set).

## Config

Non-secret settings: `tracking.bigquery` in site settings. Credentials: same GCS service account as media (`GCS_CREDENTIALS_JSON` / key file / ADC). SA needs BigQuery Data Viewer + Job User on the GA4 export dataset.

## Related

- Journey membership → `get_product_funnel`; journey metrics → `get_product_funnel_analytics`
- Organic → `explain_site` topic `seo`
- Staff UI: `/private/tracking/ga4`
