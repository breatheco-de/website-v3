# Ads (paid traffic)

Call this topic before answering “what are ads doing for us?” or “why do Meta / Google Ads numbers not match the site?”. Tools: **`get_paid_traffic`** (`metrics_view`, read-only), **`get_leads_breakdown`** (`metrics_view`, read-only: the staff Leads page — leads by channel vs UTM source / medium) and **`update_ads_issue`** (`metrics_view`, mutating: Run checks / Re-check / Mark as fixed / Undo — see Ads issues lifecycle). Organic search → topic `seo` / `get_organic_traffic`. General GA4 behavior → topic `analytics` / `get_analytics_report`.

## Sources (never summed)

| Source | What it gives | Where it lives |
|---|---|---|
| Meta Marketing API | spend, clicks, landing page views, Meta-reported leads (pixel + instant forms), ad creative link | `.cache/{site}/meta-ads-days/{date}.json` (refresh last 10 days, keep 13 months, 90-day backfill; see Account sync) |
| Google Ads → BigQuery Data Transfer | spend, clicks, impressions, Google-reported leads (`google_leads`), campaign / ad group / ad setups, network split | `.cache/{site}/google-ads-days/{date}.json`, `google-ads-network-days/`, `google-ads-setups.json`, `google-ads-state.json` (see Google Ads) |
| GA4 BigQuery export | paid visits per landing page, engagement, bounce, experiment variant; Google campaign / ad group / network per visit; per-domain count of sessions GA4 credits to ads that we don't count | `.cache/{site}/paid-landing-days/{date}.json` (complete days only, ~2-day lag; `schema_version` 3) |
| Lead ledger | site leads (unique vs repeat, test flag), first / last paid landing with platform + campaign / ad set / ad ids | pipeline SQLite `lead_submissions` (no PII, 25-month retention) |

Meta-reported leads, Google-reported leads and site leads are **separate columns** — never add them. Spend is **per currency**, never converted (`mixed_currency` warning when accounts differ).

## What counts as a paid visit (GA4)

- **Per-visit evidence only.** A session (landing = first `page_view`) is a paid candidate when its landing URL has an ad click id (`gclid`, `gbraid`, `wbraid`, `dclid`, `fbclid`, `msclkid`, `ttclid`, `li_fat_id`, `twclid`, `sclid`, `epik`) or `utm_id`, or a paid `utm_medium` (URL first, else GA4 event-scoped `collected_traffic_source`). Then `classifyTraffic` decides paid / unclear (`fbclid` alone) / organic. No domain filter: an ad pointing at another domain still shows under destinations.
- **Ignored for paid detection:** `session_traffic_source_last_click` (GA4 carries the last non-direct source across sessions for weeks) and the first-user `traffic_source`. A returning visitor who once clicked an ad is **not** a paid visit on later direct / bookmark / newsletter visits.
- **GA4 ↔ Google Ads link** (`google_ads_campaign`) only supplies campaign / ad group ids for sessions with a Google click id on the landing URL; it never makes a session paid on its own.
- **`totals.attributed_only_visits`** `{ total, by_host[] }` (top 10 hosts + `(other)`): sessions GA4's last-click (or the Ads link without a click id) credits to ads, with no per-visit evidence. Whole window, all platforms, ignores `account` / `currency` / `content_type` / id filters. `null` + `ga4.attributed_only_unavailable_reason` when the export lacks `session_traffic_source_last_click` (can't measure, not zero). These sessions are in the organic baseline.
- **`ga4.old_rule_days`**: window days still cached at an older schema. After the schema bump, the next sync re-reads **every** cached day (whole retention) in one run; >0 only after a failed run, and the next sync finishes it.
- Non-effects: spend, Meta- / Google-reported leads and site leads (ledger, already URL-based) are unchanged. Paid visits drop vs the old rule; cost per visit rises; clicks → visits moves toward 100%.

## Account sync

- One sync reads **every** configured account (`meta.ad_account_ids` in `site_<name>/ads-config.yml`); every process (web + job worker) re-reads `ads-config.yml` when it changes on disk, so a newly added account is picked up by the next sync.
- Per-account state lives in `.cache/{site}/meta-ads-state.json` → `accounts[id]`; the report echoes it as `meta.accounts[] { id, name, currency, history_loaded, sync_error? }`.
- **Auto-backfill:** while any configured account has no `history_loaded_at` (`history_loaded: false` — new, or removed and re-added), a `refresh` (automatic, staff Resync, or `refresh: true`) runs as a 90-day backfill for all accounts. Accounts removed from settings are dropped from the state on the next sync.
- **Partial sync:** an account Meta refuses to read (no access, wrong id, disabled) is skipped with `sync_error`; other accounts still save, and its previously saved rows are kept. The sync fails as a whole only when every account fails. It stays `history_loaded: false`, so it retries the 90-day load next sync.

## Google Ads

- **Source:** we read only the Google Ads → BigQuery Data Transfer tables (staff create the transfer in Google Cloud; we never call the Google Ads API and never write to Google). Settings: `google { enabled, customer_ids, bigquery { project, dataset }, lead_conversion_actions, known_external_campaigns }` in `site_<name>/ads-config.yml` (staff UI Settings → Ads → Google, `ads_settings`). Only ticked `customer_ids` count.
- **Setup:** staff follow the Setup checklist in Settings → Ads → Google (`GET /api/settings/ads/google/setup`, read-only): dataset in GA4's location → BigQuery Data Viewer for the site's service account → transfer (daily, 30-day refresh window) → transfer access to Google Ads (latest run status + error text via the Data Transfer API when the service account can read it; a service-account-run transfer needs that account added as a Google Ads user) → 90-day backfill (progress = latest run per data day: loaded / running / queued / failed; falls back to distinct loaded days in the tables, where quiet days have no rows; short / in-progress history is a non-blocking check so staff can connect accounts immediately) → use the found accounts. No MCP tool; point staff there when `google_not_connected` / `google_sync_failing` appear.
- **Sync** (same `ads_sync` job as Meta + GA4; `meta_ads_sync` is an alias): re-reads the last **10 days** of spend / clicks and **30 days** of conversions every run, plus any day the transfer reloaded. Per-account state → report `google.accounts[] { id, name, currency, history_loaded, data_through, auto_tagging, sync_error? }`.
- **Lag:** the transfer lands each day late. The newest 1–2 days missing are normal (`google_data_through` warning: "missing, not zero"); older → `google_transfer_stale` warning + issue. `refresh: true` can't make the transfer run sooner.
- **Visit matching** (paid Google visits → campaign), in order; the report counts each in `google.visit_match { ga4_link, gclid, tags, none }`:
  1. GA4 ↔ Google Ads link (`session_traffic_source_last_click.google_ads_campaign` in the export) — best; used only when the landing URL has a Google click id (`gclid` / `gbraid` / `wbraid` / `dclid`).
  2. `gclid` joined to the transfer's `ClickStats` **inside BigQuery** (needs the same BigQuery location as GA4); click ids are never stored by us.
  3. URL suffix tags (`utm_id` / `utm_term` / `utm_content` = campaign / ad group / ad ids; template in Settings → Ads → Google).
  Unmatched visits stay paid Google traffic, just without campaign ids. **Performance Max** reports campaign level only (no ad group / ad).
- **Leads:** `google_leads` = conversions in the Submit lead form category + staff-picked `lead_conversion_actions`. Never summed with site or Meta leads. Site-lead credit per platform follows `model` (first / last paid landing platform stored per lead since v30 of the ledger; older leads → `lead_platform_legacy`, platform guessed from latest UTMs).
- **Spend without a site visit** → destinations `google_lead_form`, `calls`, `video_views`, `app` (plus `unknown_destination`); excluded from cost per lead.
- **Networks** (`google_networks`, summary + Google diagnostics): rows `search`, `search_partners`, `display`, `youtube`, `cross_network` (Performance Max), `other`, `not_split` with spend, clicks, impressions, paid visits; `not_split_share` = visits we couldn't tie to a network (`google_network_not_split` when high). Network spend is exact.
- **Filters:** `account` accepts a Google customer id (`123-456-7890`). `campaign_ids` / `adset_ids` (= ad groups) / `ad_ids` accept Google ids; with **both** platforms connected, id filters need `platform: meta | google` (error `platform_required_for_ids`).
- **Unticked accounts** that still send paid visits → `google.unconnected_accounts[]` + info issue `google_account_not_connected` (their spend isn't counted).

## Modes

| Mode | Returns |
|---|---|
| `summary` | totals, top 5 pages by spend, counts of pages / destinations / campaigns |
| `campaigns` | campaign groups (spend, clicks, Meta leads, paid visits, pages) — paginated |
| `entries` | managed pages with paid visits; `group=page` trims each row's `campaigns` to the top 3 by spend (`campaigns_total` = full count); `group=campaign` keeps the full list; `split_by_version` adds per-variant rows |
| `destinations` | spend that did **not** land on a managed page: instant forms, off-site, other site in sites.yml, missing page, unknown destination — so totals reconcile with Meta |
| `diagnostics` (no `platform`) | **overview**: worst `status` across platforms, `platforms.meta` / `platforms.google` cards `{ connected, status, open_errors, open_warnings, spend, platform_leads, site_leads, last_synced_at, data_through, top_issues (≤3) }`, `shared_issues` (lead records / consent), `totals`. `next_actions` → `platform: meta|google` for each connected platform with open issues. Writes nothing |
| `diagnostics` + `platform: google` | Google issues (codes below), KPIs `{ spend, tracked_spend, no_site_spend, google_leads, site_leads, paid_visits, clicks, clicks_to_visits_pct, matched_visits_pct }`, `networks`, `matching { ga4_link_available, gclid_join_tables, gclid_join_error }`, `url_suffix_template` (generated from the UTM convention), `utm_convention` (read-only view, see UTM convention), `resolved`, `run`. `issue_ids` filters; no per-ad evidence lists (`google_diagnostics_args_ignored`) |
| `diagnostics` + `platform: meta` | tracking issues (error/warning/info, spend affected, how to fix), KPIs, `run`; consent drop arrives as a `consent_rate_drop` warning (not an issue row). Two windows: money/traffic KPIs (`window_days`) follow `days` and **snap to 7 / 28 / 90** (saved windows); issues, `open_errors`/`open_warnings` and the consent drop always cover the last 28 days (`issue_window_days`) — changing `days` never hides or resolves an issue |

### Campaign breakdown per page (`entries[].campaigns`)

Answers "is it the page or one campaign?". Every campaign that spent on, sent paid visits to, or got site leads on the row; sorted by spend, untagged row last. `comparable_campaigns` = campaigns (untagged excluded) with `low_sample: false`.

- Per campaign: `spend`, `clicks`, `impressions`, `landing_page_views`, `paid_visits`, `engaged_sessions`, `unique_leads` (site, credited by the same `model` as the page), `meta_leads`, `pixel_leads_click` (Meta click window; `meta_leads - pixel_leads_click` = saw the ad only), `google_leads`, and rates `cost_per_visit`, `ctr`, `cpc`, `conversion_rate`, `cost_per_lead`, `meta_conversion_rate`, `meta_cost_per_lead`, `bounce_rate`, `low_sample` (same threshold as the page).
- Compact payload: `platform`, `campaign_id`, `campaign_name` always present; other keys are omitted when empty. Absent count = 0; absent rate / money (`{}`) = no denominator (e.g. no visits); a computed rate of 0 is kept; absent `low_sample` = false.
- Joining: spend / clicks / Meta leads come from the ad's destination; visits and site leads join only by a **known campaign id** (Meta `utm_id`, Google GA4 link / gclid / suffix id). No name matching.
- `untagged: true` row ("Visits without campaign tag"): paid visits and site leads on the page with no known campaign id. **Never spend.** `tag_texts` = top 5 `utm_campaign` texts seen (fix those links); `visits_by_platform`. Those texts still appear as name-only groups in `mode: campaigns`.
- Spend with `paid_visits: 0` on a campaign → rates null: the ad's link or tracking doesn't reach this page (not "infinitely expensive").
- Organic numbers and engaged time stay page-level only. Saved 7/28/90 windows rebuild once when `ADS_ATTRIBUTION_VERSION` (`server/ads/ads-rollups.ts`) changes.

### Ad URL history (Meta)

Meta spend follows the page each ad pointed to **on each day**, not only today's link (Google spend already arrives per landing page — unchanged). `ADS_ATTRIBUTION_VERSION` 3; past windows were recomputed (`attribution.url_history { since, recomputed_at }`).

- **Versions:** each ad in `.cache/{site}/ads-setup/meta.json` has `versions[]` `{ v, landing_urls, url_tags, destination, first_seen_at, last_seen_at, seeded_at?, tag_changes? }`. New version = host or path of the first link changed (or website ↔ Instant Form). Query / URL-parameter-only edits → `tag_changes` on the same version. `first_seen_at: null` + `seeded_at` = already live when history started. Multi-link ads compare `landing_urls[0]`.
- **Per day (account time zone):** inside one version → its link. **Changeover day(s)** (from the last read that saw the old link through the first read that saw the new one; several days when syncs were missed) whose two links reach **different final pages** (after site redirects) → spend, clicks, impressions, LPV and Meta leads split by that day's GA4 sessions with `utm_content` = ad id on old vs new page (`basis: "ga4"`); no such sessions → whole day to the new page (`basis: "whole_day_new"`). Integer counts split by largest remainder (parts add up). Same final page → a version is recorded but no split / no tag.
- **Before history** (`date < first_seen_at ?? seeded_at`): GA4 landings for the ad decide when ≥3 sessions that day (pages with ≥20% share keep spend; 2+ pages = an inferred changeover, `inferred: true`); else the earliest known link. For ads **without** the ad id in their links that fallback counts as `unconfirmed_page_spend` (totals + rows) → warning `ad_page_unconfirmed`. Totals never change.
- **Payload:** rows `url_change_days` (days an ad moved to / from the page), `url_change_spend` (part of `spend`), `url_changes[]` (≤5 `{ ad_id, ad_name, date, from_url, to_url, basis, inferred }`, newest first), `unconfirmed_page_spend`. Report `url_changes[]` (top 50 by that day's spend: + `campaign_id`, `from_key`, `to_key`, `spend`) + `url_changes_total`; `summary` keeps the top 10. Warning `ad_url_changed` whenever the window has any.
- **Diagnostics:** `spend_zero_visits` is skipped when all of the page's spend came from changeover days; `details.ads` lists every ad that pointed at the page during the window (not only today's link) and `previous_urls[]` `{ v, url, from, to }` (newest first, current included) when the link changed. `fresh_days` verification leaves out days when every affected ad was switching links (`url_change_days` on the rollup sum).
- Ads with no link history in the catalog (or never read) keep the old rule: creative link, else the page most of their GA4 visits landed on.

### Campaign name mapping (Meta + Google)

Paid visits with **no campaign id** (`utm_id` empty for Meta; no Google campaign id / gclid match) but a `utm_campaign` are tied to a campaign by **name on that visit's day**, using each catalog campaign's `names[]` `{ name, first_seen, last_seen }` (YYYY-MM-DD, case-insensitive; seeded once from every stored day row, then extended each sync). Exactly one campaign had the name that day → that campaign's row / group. Several → left untagged. None that day → the closest range only if a single campaign ever used the name; otherwise untagged.

- **Totals:** `campaign_name_matched_visits` (mapped), `campaign_name_ambiguous_visits` (several campaigns had the name; stayed untagged). Optional — absent when 0.
- **Non-effects:** paid / organic classification, `matched_visits`, clicks → visits ratios, id filters (`campaign_id` / `adset_id` / `ad_id`) and visits that carry `utm_id` are unchanged. `unrecognized_campaign` also counts every past name as known (renamed campaigns no longer look foreign).
- **Change history (not read by any tool):** campaign / ad set / ad settings that affect delivery or attribution (name, staff-set status + disapproved / with issues / account disabled, budgets, bidding, objective, optimization event, targeting hash + summary, schedule, creative id; Google bidding type, budget, networks, URL suffix) are logged on change to `.cache/{site}/ads-change-log/{platform}-{yyyy-mm}.json` (25 months). Production backs up URL versions, names, fingerprints and the log to `{content folder}/ads-history/` after each sync; a cache with no history restores from there.

`days` 1–90 ending **yesterday** (diagnostics KPIs snap to 7 / 28 / 90). `limit` default 25 (max 100) + `offset`. Diagnostics with `issue_ids` / id filters but no `platform` → Meta (`diagnostics_platform_defaulted`); other platforms → error `diagnostics_platform_unsupported`.

**Diagnostics is a read.** It returns the issues saved by the last Run / Re-check (`measured_at` + `window` per issue) and never runs checks, probes landing pages or opens / closes issues. `open_errors` / `open_warnings` count only `verify.state: "open"` (pending = marked fixed, waiting to confirm, is not counted).

### Google diagnostics issue codes

| Code | Severity | Meaning / staff fix |
|---|---|---|
| `google_sync_failing` | error | Transfer tables unreadable (permission / dataset) or repeated sync failures — grant BigQuery Data Viewer, check project / dataset in Settings |
| `google_transfer_stale` | warning → error when far behind | Transfer hasn't loaded recent days — Google Cloud → BigQuery → Data transfers run history |
| `google_transfer_missing_account` | error (not in transfer) / warning (unreadable) | Ticked account absent from the transfer tables — add it to the transfer (manager account) |
| `google_history_short` | info | Account history starts after the 90-day window — backfill the transfer |
| `google_account_not_connected` | info | Unticked account sends paid visits — tick it or ignore |
| `google_auto_tagging_off` | by spend share | Account has auto-tagging off, so no gclid — Google Ads → Account settings → Auto-tagging |
| `google_ga4_not_linked` | warning (info if gclid / tags match) | GA4 export lacks the Google Ads link — link GA4 ↔ Google Ads |
| `google_gclid_join_unavailable` | info / warning | ClickStats join failed (location / permissions); message in `matching.gclid_join_error` |
| `google_destination_policy` | info / warning | Spend that never reaches the site (lead forms, calls, video, app) or has no landing page |
| `google_conversions_not_reporting` | warning | Google counts no leads while the site records paid Google leads — check conversion actions / Settings lead actions |
| `spend_zero_visits` | by spend | Google ads spend on a page with no paid visits |

Shared checks (`ga4_ledger_gap`, `ledger_not_recording`, `consent_rate_drop`) carry `platform: "shared"` and appear on the Meta page + the overview's `shared_issues`. Every issue has `platform: meta | google | shared`. Shared checks run with the Meta check.

## UTM convention and checks

- **Where:** `site_<name>/ads-config.yml → utm_convention` `{ case: lowercase|any, separator: _|-, sources: { meta|google: { canonical[], aliases[] } }, mediums: { meta, google }, campaign_pattern (regex | null), require_ids, exceptions: [{ key, note? }] }`. Edited in YAML only — **no API / MCP write**; Settings → Ads (Meta and Google tabs) shows it read-only. Missing keys → defaults: meta sources `fb, ig, msg, an` (aliases `facebook, instagram`), medium `paid_social`; google source `google` (alias `adwords`), medium `cpc`; lowercase; no campaign pattern; `require_ids: true`.
- **GA4 standard is strict:** a medium must match GA4's paid rule `^(.*cp.*|ppc|retargeting|paid.*)$` or be a display medium (`display, banner, expandable, interstitial, cpm`). Other values in the file are **rejected** (default used) → `utm_convention_invalid` issue + warning with `rejected[] { field, value, reason, default_used }`. Source: GA4 default channel group rules (support.google.com/analytics/answer/9756891).
- **Generated templates:** Meta URL parameters (`utm_template`) and Google final URL suffix (`url_suffix_template`) are built from the convention. Meta keeps `{{site_source_name}}` while the canonical sources are a multi-value subset of `fb, ig, msg, an`.
- **`msg` / `an` are accepted on purpose:** GA4 puts them in Paid Other (not Paid Social) because neither is on its social source list; `fb` / `ig` land in Paid Social. They are a small share of Meta traffic, and the per-placement split needs the real value. To flag Audience Network instead, remove `an` from `sources.meta.canonical` (it then raises `utm_source_alias`); a literal `utm_source` in Meta loses the placement split.
- **Read view:** diagnostics (`platform: meta | google`) return `utm_convention { file, config_error, convention, rejected, meta_template, google_template, grace { active, changed_at, ends_at, accepted_old_values[] }, grace_days, history_file, standard }`; dense facts go to `warnings` (below).
- **Evidence (28-day issue window, same as other checks):** declared = Meta ads with spend (link + `url_tags`) and Google campaigns' `final_url_suffix` (ticked customers); observed = GA4 paid-landing candidates (paid only, `(direct)` / `(none)` / `(not set)` treated as empty) + lead ledger rows (non-test, with a platform). Evidence merges per campaign: `details.utm { params, values[] {param, value, expected}, ga4_channel, rule, visits, leads }`, `details.ga4_seen` (top 10), `details.ga4_totals`.
- **Codes** (Meta → `platform: meta`, Google → `google`, paid traffic from any other platform → `shared`; universal rules apply to every platform, source / medium-convention / id rules only to meta and google):

| Code | Fires when |
|---|---|
| `utm_unfilled_macro` | A placeholder (`{{…}}` / `{…}`) reached GA4 unfilled — always **error** |
| `utm_case_mixed` | `utm_source` / `utm_medium` has capitals while `case: lowercase` |
| `utm_bad_chars` | Spaces or characters outside `a-z 0-9 . _ + -` in source / medium |
| `utm_medium_nonstandard` | We count the medium as paid (`PAID_MEDIUMS`) but GA4 doesn't, e.g. `social_paid`, `sem`, `ads`, `ad` |
| `utm_source_alias` | Source not in `sources.<platform>.canonical` (aliases and unknown values) |
| `utm_medium_off_convention` | GA4-paid medium that differs from `mediums.<platform>` |
| `utm_campaign_pattern` | `campaign_pattern` set and `utm_campaign` doesn't match — **info** only |
| `utm_missing_ids` | Google traffic without numeric `utm_id` / `utm_term` while `require_ids` (Meta ids stay under `missing_tracking_params`) |
| `ads_config_unreadable` | `ads-config.yml` exists but can't be parsed — **error**; Meta / Google / GA4 syncs are skipped; checks use the last good parse (or defaults) |
| `utm_convention_invalid` | Values in `utm_convention` rejected (see GA4 standard) |

- **One issue per campaign and code.** Medium codes are skipped for campaigns where `non_paid_medium` already fires. Ids: meta `ads:meta:{code}:…` (grouped with other per-ad checks when Meta ads are behind it), google `…:{code}:google:{campaign}`, shared `…:{code}:{platform}:{campaign}`.
- **Severity:** below `alert_thresholds.utm_issue_min_visits` (5) with no spend → not raised. Grace, `utm_convention.exceptions`, known external campaigns, `utm_campaign_pattern` → info. With spend → the usual spend rule. Without spend → error at ≥ `utm_issue_error_visits` (50) visits, else warning.
- **Verify kinds:** Meta codes `after_sync` (Meta), Google codes `after_sync` (Google), shared codes `fresh_days` (3 days + 2 lag, ≥10 sessions). Config codes `instant`.
- **Convention changes (grace):** each environment keeps `.cache/{site}/utm-convention-history.json` (hash per version; the first read is the baseline, so a fresh copy has no grace). After a change, values from the previous version are accepted for **28 days** at info: issues carry `in_grace: true` + `grace_ends_at`, and responses carry warning `utm_convention_changed`. After that they are flagged normally. History is per environment and comes along with Download from production (local and production can differ until then).
- Non-effects: nothing changes in Meta or Google; paid / organic classification and report numbers are unchanged; the convention never edits ads.

## Ads issues lifecycle (Run / Re-check / Mark as fixed / Undo)

- **Storage:** issues live in the site validation cache (`{content_root}/validation-cache.json`, scope `ads`, `category: "ads"`; the web process is the only writer). Resolved rows go to the shared resolved-issues archive with `resolution`: `verified_gone` (a check confirmed it), `soft_complete`, `resource_gone` (the ad / campaign was deleted in the platform), `rule_retired` (the check no longer exists). Job records: `.cache/{site}/ads-diagnostics/jobs/` (last 30).
- **Identity:** `id = ads:{platform}:{code}:{level}:{resource_id}` (`level` account | campaign | adset | ad | none; site-wide checks add `:{subject}`). Never names, amounts or URLs, so pending marks survive Runs. `check_key` = the check's own key (e.g. `unrecognized_campaign:{campaign key}`).
- **Grouping:** per-ad problems are reported at the highest level whose spending ads are all affected (account → campaign → ad set), else per ad. Groups are sticky (never split; `affected_ads` grows / shrinks — a shrink is "Partly fixed", not a failed attempt). Untouched per-ad issues merge into a covering group silently; per-ad issues someone acted on stay separate. Evidence keeps the top **50** ads by spend; `affected_ads` keeps every id (`affected_ads_total`).
- **Verify kinds** (per code, `verify.verify.kind`):
  - `instant` — setup / landing checks (`missing_tracking_params`, `non_paid_medium`, `landing_not_live`, `ad_url_redirects`, destinations, `tracking_params_unchecked`). Fix, then **Re-check**; Mark as fixed is refused (`ads_mark_not_needed`). Meta Re-checks re-read those ads' setups first (≤200 ads).
  - `after_sync` — access / sync / transfer / account checks. **Mark as fixed** → pending until that platform's next successful Sync (`verify.waits_for_sync`), then Re-check (`ready_to_verify: true`) or the next Run confirms.
  - `fresh_days` — traffic checks (`spend_zero_visits`, `clicks_visits_low`, pixel / conversions, ledger, consent, …). Mark as fixed → judged only on days **after** the mark: from the first full day after it in the ad account's time zone, `days` days + `lag_days`, with `min_data` (clicks / spend / sessions / leads) on the affected ads (daily rollups `.cache/{site}/ads-daily-rollups/`; missing days never count). `verify.progress { days_counted, days_needed, metric, value, needed, waiting_for_spend }`, `verify.verify_after` (estimate). Below min data → "not enough data yet"; no spend → "waiting for spend". **Early fail** is allowed once min data is reached (the post-fix days already show the problem → reopened with a failed attempt); **early pass never**.
- **Pending** = `verify.state: "pending"` (completion overlay with `verify`). Not resolved, not counted as open. Undo returns it to open. A Re-check / Run that confirms → resolved `verified_gone`; still found → reopened (`last_check.outcome: still_open | reopened_early`) with a failed attempt.
- **Run checks** (`update_ads_issue action: run`, `POST /api/diagnostics/ads/run`): full Run for Meta (+ shared) and / or Google in a background fork (~1–3 min). One per site; busy → 409 `ads_run_busy`; while an Ads Sync runs → 409 `ads_sync_active`. A platform that couldn't be read is skipped (`run.last_run.skipped[]`, issue `not_checked`) and keeps its issues as last checked.
- **Re-check** (`action: recheck`, `issue_id` or `platform` + `level` + `resource_id`): only `instant` issues or pending issues with `ready_to_verify` (else 409 `ads_recheck_not_instant` / `ads_recheck_not_ready`). Small scopes go to the `ads_recheck` job queue (requests within 3 s share one job; `recheck_queued: true` on the issue); account scopes or > 50 ads go to the fork (busy → 409). A queued Re-check waits behind a running Run. A Re-check that can't read the platform leaves issues as they were (`last_check.outcome: couldnt_check`).
- **Race rule:** a Run only overrides actions made **before it started** — a mark / undo / Re-check result newer than the Run start is left untouched.
- **Mark as fixed** (`action: mark_fixed`): MCP must send `report` (≥40 chars: what changed in the ad platform and where; `ads_report_required`). Already pending → 409 `ads_already_pending`. **Undo** (`action: undo`): 409 `ads_not_pending` when nothing is pending.
- Nothing here changes Meta or Google Ads — staff / agents fix in the platform, then confirm here.

## Filters (campaign / ad set / ad / date range)

- `campaign_ids`, `adset_ids`, `ad_ids`: numeric Meta or Google ids (Google ad groups → `adset_ids`), ≤20 each; add `platform` when both are connected. OR within a level, AND across levels. Report modes echo `filters`. Find ids with `mode: campaigns` (`campaign_id`) or diagnostics `details.ads` (ad set / ad ids).
- **Spend** (Meta rows) matches on the row's own ids — complete.
- **GA4 visits** match on link tags (`utm_id` campaign, `utm_term` ad set, `utm_content` ad). Missing parents are filled from synced Meta ads (a visit tagged only with an ad id counts for that ad's ad set and campaign). Visits without the tag needed at the finest filtered level are **left out**, never estimated → `untagged_visits_excluded` (count + top pages). Treat visits, conversion rate and cost per visit as a **floor** when it appears. `known` ids for paid vs organic still come from every synced ad, so filtering never reclassifies traffic.
- **Leads** (ledger) match on the ids of the ad the visitor clicked **last**, whatever `model` says; page credit still follows `model`. With `model: first_paid` → `leads_matched_by_last_click`.
- **`account` / `currency`**: Meta-only filters that narrow all three sides. Spend = that account's (or currency's) rows. Paid visits count only when their `utm_id` / `utm_term` / `utm_content` match a synced campaign / ad set / ad in the filtered accounts; non-Meta and `unclear` visits are excluded. Meta paid visits with **no** tags → `totals.unassigned_visits` + `row.unassigned_visits` (could be any account); visits tagged with ids from Meta accounts we don't sync → `totals.unsynced_account_visits` (not this account's; connect it if it should count). Both → `visits_not_tied_to_account` warning (visit-based numbers are a floor). Leads count only when the last-clicked ad's ids are in the filtered accounts. Without these filters nothing is narrowed and both counts are 0.
- **No match**: ids with no spend, visits or leads in the window → `filter_no_match` (ids listed) + `next_actions` → `mode: campaigns`. The call still succeeds (a quiet campaign is a real answer).
- `since` / `until` (YYYY-MM-DD, UTC, inclusive) replace `days`. Only `since` → `days` forward (default 90); only `until` → `days` back (default 28). `until` after yesterday → clamped to yesterday; `since` before the ~13-month retention floor → clamped (`range_clamped`). Spans over 90 days, reversed or invalid dates → error (split the range). Nothing is fetched: days with no cached file → `data_gaps` (per source, compressed ranges) and `data_gaps: { meta_missing_days, ga4_missing_days }` — **missing, not zero**. GA4 days inside its ~2-day lag are not counted as gaps. Site leads before `collecting_since` still raise `ledger_collecting`.
- **Diagnostics**: id filters keep issues whose `details.ads` or `ga4_seen` match, plus issues with no ad scope (sync / setup failures). Kept issues list only matching ads (`ads_total` = matching count); `spend_affected`, KPIs, `open_errors` / `open_warnings` and `status` stay whole-site (`diagnostics_filtered` warning). With `issue_ids`, open issues outside the filter come back as `filtered_out_issue_ids` (`issue_filtered_out`). `since` / `until` are ignored (`range_ignored_in_diagnostics`).

## Diagnostics issue details

- Order: severity (error → warning → info), then spend affected (summed across currencies for ordering only), then id. `issues_total` counts all; `limit`/`offset` page the issues.
- Each issue: `id`, `check_key`, `level`, `resource_id`, `affected_ads` (capped at 20 ids in the list; full with `issue_ids`) + `affected_ads_total`, `measured_at` + `window` (the Run that measured it), `verify` (see Ads issues lifecycle), `last_check`, `recheck_queued`, `not_checked`, `scope` (`campaign_id`, `campaign_name`, `account_id`, `url`, `page_key`, `ad_id` when known), `first_seen` (ISO), `details`:
  - `ads[]` — Meta ads that spent in the 28-day issue window: ids + names for ad / ad set / campaign / account, `effective_status` (ACTIVE, PAUSED, …; `null` = setup never read), `spend`, `link_clicks`, `impressions`, `landing_page_views`, `last_spend_date`, `landing_url`, `url_tags`, plus `missing` (template params), `medium` (non-paid `utm_medium`), `unchecked_reason`, or (when GA4 verified) `tagging_source` (`setup` | `meta_auto` | `none`), `ga4_tagged_sessions`, `checked_clicks`. Paused ads stay listed — the spend already happened. Sorted by spend.
  - `ads_total`, `ads_offset` — the list is trimmed: top **3** per issue in the list call.
  - `unchecked[]` `{ reason, ads, spend }` — ads with spend we could not compare to the template. Reasons: `account_unreadable` (Meta refused to read the ad's account on the last sync — `meta.accounts[].sync_error`; staff fix access or the id), `setup_fetch_failed` (Meta didn't return the ad setup on the last sync — `refresh: true` or staff Resync), `ad_removed_in_meta` (deleted/archived; nothing to fix), `no_link_found` (no website link, e.g. call/message ads; URL parameters don't apply).
  - `ga4_seen[]` (destinations with **no** synced ad, e.g. off-site from Google or another Meta account): top 10 GA4 tag groups `{ platform, source, medium, campaign, campaign_id (utm_id), adset_id (utm_term), ad_id (utm_content), visits, leads, first_seen, last_seen }` + `ga4_untagged_visits` (no `utm_content`, so ad set / ad can't be known).
  - `setup_last_read_at` — oldest successful ad-setup read for the issue's account(s); `null` = never read or the last read failed (stored per account in `.cache/{site}/meta-ads-state.json` as `setup_read_at` / `setup_error`).
- Which ads: missing / non-paid / unchecked / unverified tracking → the campaign's ads; `landing_not_live`, `ad_url_redirects` → every ad on that URL (spend affected = their sum); `spend_zero_visits` and destination rows → ads whose link resolves there (current link or any link version live in the window; see Ad URL history).
- `landing_not_live` (severity by spend, `site_fixable: true`): the ad's URL isn't a live page on this site and doesn't redirect to one (resolved in-process, no HTTP probe). Runtime-only pages (not in content) show as "coming soon" — not checked yet.
- **Meta tracking vs GA4** (Meta only; Google URL-suffix issues unchanged):
  - Full template with good `utm_content` (`{{ad.id}}` or the ad's own id) → tagged from setup (`tagging_source: setup`). A present but wrong `utm_content` (other ad's id, `{{ad.name}}`, `{{placement}}`, …) is **not** fully tagged — same GA4 path as a missing template.
  - Otherwise we compare Meta **link clicks** and GA4 sessions with `utm_content = ad_id` on **complete** GA4 days only (same dates both sides). Window: last `tracking_check_days` (default 7) complete days; if clicks there are below `tracking_missing_min_clicks` (20), fall back to the full 28-day issue window. Fewer than 4 complete days → unverifiable.
  - **Both-conditions `meta_auto`:** sessions ≥ `tracking_tagged_min_sessions` (3) **and** sessions/clicks ≥ `tracking_missing_max_visit_pct` (10%). Those ads are **hidden** (Meta tagged at click time). Cookie-consent loss is absorbed by the 10% floor — no separate control.
  - **Confirmed missing** (`missing_tracking_params`, warning): clicks ≥ min and not `meta_auto`. Skipped per ad when that ad's own bare URL has Meta `landing_not_live`, or the ad's page has Meta `spend_zero_visits` (Google zero-visit does not skip Meta). `ad_url_redirects` does not skip. Fix via Meta only on this code.
  - **Unverifiable** (`tracking_params_unverified`, info, `platform: meta`): not enough clicks or complete days, or only `utm_id` missing. No Fix via Meta.
  - **Unchecked** (`tracking_params_unchecked`, info): setup unread / no link / removed — **discard-only** via GA4: if the ad meets `meta_auto`, drop it from the warning; otherwise keep. Never emit confirmed-missing without a readable setup. When a campaign already has confirmed missing, remaining unchecked fold into that issue's `details` (no separate unchecked row for that campaign).
  - GA4 not configured → setup-only (missing template / dubious content still warn as today).
- `tracking_params_unchecked` (info, per campaign): ads with spend couldn't be checked and none in that campaign were confirmed missing (after GA4 discard).
- Reports (`summary` / KPIs): `untagged_clicks` / tagged use the **report's own dates** for `meta_auto` (not the 7-day diagnostic window). `adIsTagged` is false for dubious `utm_content` unless `meta_auto`. Google rows unchanged.
- `unrecognized_campaign` (`check_key` `unrecognized_campaign:{key}`, campaign level when the campaign id is known, `site_fixable: false`, `spend_affected: {}`): GA4 paid Meta visits to **this site's own pages** (entry / missing page — off-site and other-site visits never count) whose campaign (`utm_id`, else numeric `utm_campaign`, else campaign name) is not in any connected account. Known = any id in all stored Meta day rows (~90 days, connected accounts) or ad creatives, or a name matching a connected campaign (case-insensitive).
  - Severity: none below `thresholds.unrecognized_campaign_min_visits` (3); warning at/above; error at ≥ `unrecognized_campaign_error_visits` (20) **or** ≥ `unrecognized_campaign_error_share_pct` (5%) of paid Meta visits — share rule only when paid Meta visits ≥ `unrecognized_campaign_share_min_visits` (100).
  - Skipped when Meta is not connected or while `meta_access_failed` / `meta_sync_failing` is open. `details.pages[]` `{ key, url, title, visits }` (top 5), `details.ga4_seen[]` (tag rows), `details.ga4_totals` `{ visits, leads }`.
  - `ads-config.yml → meta.known_external_campaigns` (`[{ key, note? }]`, max 100) turns matches into **info** ("Known external campaign"). Staff add entries via Diagnostics "Mark as known" or Settings → Ads (`ads_settings`); there is no MCP write — suggest it to staff.
- GA4-only `off_site_destination` rows (no synced ad links there, only GA4-tagged visits) are info and say none of your ads link here; when a flagged `unrecognized_campaign` brings ≥50% of those visits, `why` names it.
- Lead records vs GA4 (one or neither, never both):
  - `ledger_not_recording` (`site_fixable: true`): GA4 counted paid leads in the issue window but the ledger has **0** credited paid submissions. `info` = the ledger never recorded a non-test lead (new setup, or a local/staging copy — live leads are recorded on the live server); `warning` = it did and stopped (`why` carries the last recorded date, UTC). Fix is on the site: forms must submit through the form/webhook endpoints. Say "we can't compare", not "tracking is broken".
  - `ga4_ledger_gap` (warning): compares only days both sources cover — GA4-exported days from the ledger's first full day on (GA4 lags ~2 days; the ledger's first day is partial). Needs ≥7 such days and ≥1 submission, else skipped. `why` states the day count. Threshold: `ga4_ledger_gap_bootstrap_pct` until the trailing 28 days also have ≥7 comparable days, then `ga4_ledger_gap_widen_pts` vs that baseline.
  - A skipped gap check (or one replaced by `ledger_not_recording`) leaves the open list **without** a `resolved` entry — it was not fixed, just not measurable.
- **Detail follow-up:** `issue_ids` (≤10) → only those issues from the saved list, `ads_limit` default 50 (max 200; evidence holds the top 50), `ads_offset` to page, full `affected_ads`, `missing_issue_ids`. No snapshots — ids are stable across reads.
- `refresh: true` (any mode, needs `ads_settings`) queues the same Meta read as staff Resync (last 10 days + ad setups; 90 days while any account has `history_loaded: false`), then reads the cache immediately (`refresh.state` queued → re-call per `next_actions`). Without the grant: `refresh_not_allowed`, the cached read proceeds.

## Paid classification

- Paid = paid medium (`cpc`, `paid_social`, …) **or** a platform click ID that implies paid (`gclid` alone = Google paid).
- Meta needs a paid medium **or** a matching Meta ID (`utm_id` campaign / `utm_content` ad). `fbclid` alone = **Meta: unclear** (organic Facebook shares carry it too).
- UTM template for every Meta ad (shown in Settings → Ads), generated from the UTM convention; defaults: `utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_id={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}`. Meta fills `{{site_source_name}}` with `fb` / `ig` / `msg` / `an`; ads set up earlier with `utm_source=facebook` still count as paid Meta (see Facebook vs Instagram) but raise `utm_source_alias`.
- **Classification is not configurable:** `PAID_MEDIUMS` / click-id rules stay in code. The UTM convention only decides which tags get flagged, never which visits count as paid.

## Facebook vs Instagram (`meta_platforms`)

Returned by `summary` and `diagnostics` (KPI window, follows `days`) when Meta is connected; absent otherwise. Rows in order `facebook`, `instagram`, `messenger`, `audience_network`, `other`, `not_split`; rows with nothing are dropped. Each row: `spend`, `clicks`, `meta_leads` (sum of the picked lead conversions — see Meta lead conversions), `paid_visits`, `unique_leads`, `cost_per_lead` (spend / site leads, `null` with none), `conversion_rate` (site leads / paid visits), `low_sample`.

- **Visits:** paid Meta GA4 sessions by `utm_source`: `fb` → facebook, `ig` → instagram, `msg` → messenger, `an` → audience_network. Anything else (legacy `facebook`, blank, custom) → `not_split`.
- **Leads:** credited, non-repeat, non-test site leads with platform Meta, bucketed by the **lead's own** `utm_source` (its latest campaign tags) — same for `last_paid` and `first_paid`.
- **Spend:** separate Meta read per ad × `publisher_platform` (`.cache/{site}/meta-ads-platform-days/`; Meta `others` / unknown → `other`). Only ads landing on this site (`entry` / `missing_page`) count. Ads whose URL parameters use `{{site_source_name}}` (or a literal `fb`/`ig`/`msg`/`an`) go to their placement row; ads on an older tag put spend in `not_split`, so spend, visits and leads line up per row.
- **`excluded_spend`** `{ instant_form, off_site, unknown }`: spend not in any row (Instant Form, `off_site` / `other_site`, `unknown_destination`). Never in `cost_per_lead`.
- **`spend_since`**: first day placement spend exists for every account in scope (`null` while any account's 90-day placement history is still loading). **`spend_partial`**: `spend_since` after the window start, history not loaded, or the last placement read failed for an account (`meta.accounts` state `platform_error`) — spend and `cost_per_lead` are a floor.
- **`not_split_share`**: `not_split` visits / all placement visits (3 decimals).
- Filters: `account`, `currency`, `campaign_ids` / `adset_ids` / `ad_ids`, `content_type` narrow placement spend like the main report.
- Non-effects: main `totals.spend` and page rows keep using the regular Meta read (no placement breakdown) — never sum `meta_platforms` spend with them. No Meta ads are changed; existing `utm_source=facebook` tags stay until staff update the ads (Fix via Meta on `missing_tracking_params` only adds missing params; on `utm_source_alias` it can replace `utm_source` — see Staff Fix via Meta). A failed placement read never fails the sync.

## Meta lead conversions

- **What counts:** `meta_leads` (totals, pages, campaigns, placements) = plain **sum** of the conversions picked in `ads-config.yml → meta.lead_conversions` (Settings → Ads → Meta, next to Ad accounts). Keys: `fb_pixel_lead` (Meta `offsite_conversion.fb_pixel_lead`, the standard Lead event) or a custom conversion id (`offsite_conversion.custom.<id>`). **Nothing picked → standard Lead event** (the card shows a warning). Overlapping picks are never de-duplicated — they raise `lead_conversions_overlap`.
- **Recalculation:** changing the picks recalculates every window from cached days (`meta.lead_conversions_changed_at`; the card notes it for 7 days). Days cached before per-conversion counts only know the standard Lead event; the next sync re-downloads 90 days once per account (`meta.accounts[].conversions_loaded_at`) and retries on later syncs.
- **Report** (`summary` mode): `lead_conversions { meta_picked, meta_changed_at, meta[] {key, name, count}, site[] {name, count}, meta_incomplete_days, snapshot_lacks_conversions }`. `meta[]` sums to `totals.meta_leads` (names from the synced custom conversions, else the id). `site[]` groups the credited, non-repeat, non-test leads behind `totals.unique_leads` by form conversion name (`(no conversion name)` when blank) and sums to it. `meta_incomplete_days` counts only when a custom conversion is picked (picked customs read 0 on those days → Meta number is a floor). `snapshot_lacks_conversions`: dev production copy downloaded before production cached per-conversion counts — download again after production syncs.
- **Diagnostics KPIs (Meta):** `meta_conversions`, `site_conversions`, `meta_lead_conversions_picked` (`[]` = standard Lead fallback), `lead_conversions_changed_at`, `meta_conversions_incomplete_days`, `snapshot_lacks_conversions`. Missing on snapshots built before this shipped.
- **Issues** (all `platform: meta`, `site_fixable: false`, `spend_affected: {}`, numbers in `evidence`):
  - `lead_conversions_overlap` (warning, id `lead_conversions_overlap:{a}|{b}` sorted): over the 28-day issue window, both picks report on ≥ `conversion_overlap_days_pct` (80) of ad-days where either has results (≥3 such ad-days) and totals differ ≤ `conversion_overlap_count_pct` (20). `evidence.conversions[].optimized_ads` = ads whose ad set `promoted_object` optimizes for it; `estimated_extra` = the smaller count. Recommendation keeps the optimized one (else the larger count). Resolves once one is unpicked or they stop overlapping.
  - `pixel_events_lockstep` (warning, id `pixel_events_lockstep:{pixel}:{a}|{b}`): two events on one pixel, each ≥ `lockstep_min_events` (20) in the last 7 days, totals within `lockstep_count_pct` (2) and identical counts in ≥80% of active hours. Skips `PageView` and pairs in `meta.expected_event_pairs`. Usually one Tag Manager trigger fires both tags (the site pushes one dataLayer event per form).
  - `lead_conversion_stopped` (warning, id `lead_conversion_stopped:{id}`): a picked custom conversion no selected account lists (`reason: missing`), archived (`archived`), or not shared with a selected account that has spend (`not_shared`, `evidence.accounts`). Picks are never removed automatically. Skipped when no account's conversion list could be read.
  - `pixel_not_reporting_leads` names the picked conversions (or the standard Lead fallback).
- **Fix actions** (`issue.action`, staff-only settings writes after a confirm in Diagnostics; `ads_settings`; no MCP write — suggest them to staff): `unpick_lead_conversion` → `POST /api/ads/meta/lead-conversions/unpick { key }`; `mark_expected_event_pair` → `POST /api/ads/meta/expected-event-pairs { pixel_id, events }`. Both only edit `ads-config.yml → meta`; nothing changes in Meta or Tag Manager. Picker options: `GET /api/ads/meta/conversions?account_ids=&picked=` (live from Meta, 5-min cache, else the last sync's file).
- **Data:** each sync saves `.cache/{site}/meta-custom-conversions.json` (per account) and `meta-pixel-events.json` (last 7 days, hourly per event, pixels deduped across accounts); both are in production downloads. Failures there never fail the sync (previous lists kept, `meta.accounts[].conversions_error`).

## Clicks → visits

Same traffic on both sides, so it measures clicks lost between Meta and the site:

- **Numerator** `matched_visits`: paid Meta visits whose `utm_id` / `utm_term` / `utm_content` match a synced campaign / ad set / ad in the filtered accounts (`account` / `currency` narrow both sides). Other paid Meta visits → `totals.unmatched_meta_visits` (other ad accounts, shared tagged links, ads without the template). Without `account` / `currency`, `paid_visits` still counts both; with them, only matched visits count (see Filters).
- **Denominator** `totals.ratio_clicks`: Meta **link clicks** (never landing page views) from ads landing on this site (`entry` / `missing_page`) on days with a GA4 export. Excluded: instant forms, `off_site` / `other_site` / `unknown_destination`, days GA4 has not exported (~2-day lag), and ads whose setup lacks the template **and** GA4 did not confirm `meta_auto` on the report window → `untagged_clicks` (reported separately by `missing_tracking_params`). Unchecked setups stay in. `clicks` is unchanged and still counts every click.
- Rows: `clicks_to_visits` = row `matched_visits` / its ratio clicks (`null` with none), plus `untagged_clicks`. Diagnostics KPIs: `clicks_to_visits_pct`, `clicks_to_visits_mismatch`, `unmatched_meta_visits`, `untagged_clicks`.
- **Above 110%** (`clicks_to_visits_mismatch: true`, row ratio > 1.1): GA4 and Meta measure different traffic (session restarts, tagging) — say "mismatch", never "more visits than clicks". `clicks_visits_low` never fires on a mismatched window and ignores a mismatched baseline.

## Meta metrics on page rows

Each page / destination row (and `totals`) now carries Meta-side fields derived from cached insights. Under `platform=all`, site visits / site leads / site `conversion_rate` can mix Meta and Google; Meta fields stay Meta-only.

| Field | Formula / meaning | `null` / grey |
|---|---|---|
| `impressions` | Sum of Meta (and Google when on the row) impressions | — |
| `pixel_leads_click` | Standard Lead in Meta's 7-day click window (0 until day files have the split) | — |
| `ctr` | `clicks / impressions` | `null` with no impressions |
| `cpc` / `cpm` | spend ÷ clicks; spend ÷ impressions × 1000 (per currency) | empty money when denom is 0 |
| `landing_rate` | `landing_page_views / clicks` | `null` with no clicks |
| `meta_conversion_rate` | `meta_leads / landing_page_views` | `null` when Meta reports no page loads (never falls back to clicks) |
| `meta_cost_per_lead` | spend ÷ `meta_leads` | empty money with no Meta leads |
| `lpv_to_visits` | `matched_visits` ÷ tagged Meta landing page views on GA4 days (same rules as `ratio_clicks`) | `null` with none; ratio > 1.1 → measurement mismatch (same threshold as clicks → visits) |
| `meta_low_sample` | `landing_page_views` under `thresholds.min_paid_visits_for_rates` | greys Meta rates in the staff UI |

- **"Saw the ad only" (staff UI / agents):** derive as `max(0, meta_leads − pixel_leads_click)` so it always adds up to `meta_leads`. Do not treat Meta's raw `1d_view` window as the display number.
- **`meta_split_days { covered, total }`:** days in the window whose cached Meta rows include `pixel_leads_click`. Partial coverage → say the click vs saw-the-ad-only split is based on X of Y days.
- **Pixel gap:** when a row has `clicks > 0` and `landing_page_views === 0`, Meta conversion rate is `null` — say the Meta Pixel may be missing on that page.

## Lead credit

- One lead → one landing page. Default **last paid landing** (`model=last_paid`); `first_paid` is the switch. 30-day lookback, **no split**. The form page never gets credit unless it was itself the paid landing.
- Repeats (same browser + same form within 24h) are **submissions**, not leads. Test leads (staff session / test email pattern) are excluded from counts but still delivered to the CRM.
- `last_visit_organic`: lead credited to paid, but the visit where they converted came organically (>30 min gap). Shown, not re-credited.
- Journeys are **per browser** (`attribution.basis: browser_observed`) — cross-device paths are invisible.

## Lead channel (ledger, staff Leads page)

- Every lead row now stores `channel` (`paid` | `meta_unclear` | `organic_search` | `organic_social` | `ai_assistant` | `email` | `referral` | `direct` | `tagged_other`), `first_channel`, `last_organic_channel`, `channel_landing_path` (page that channel's visit landed on), `referrer_host`, `country` (ISO2 from the visitor's connection) and `traffic_status` (paid / unclear / organic at submit). `NULL` channel = recorded before tracking or by an old cached page.
- Order: internal UTMs (`utm_source` = this host or its parent domain) are ignored → paid → `fbclid` only = `meta_unclear` → other UTM tags → referrer host (search / social / AI / webmail) → `referral` → no referrer = `direct`. Last non-direct wins; `first_channel` is write-once. Without tracking consent the channel only covers the converting visit.
- **Paid wins:** an ad click within 30 days (`PAID_LOOKBACK_DAYS`) before the lead keeps `channel: paid`; `last_organic_channel` keeps the later non-paid visit. On the staff Leads page this 30-day rule applies only to rows with `traffic_status` (recorded after launch), so earlier paid counts are unchanged; Meta unclear is a separate bucket there.
- Non-effects: `get_paid_traffic`, the Ads report and lead credit are unchanged (Meta unclear still handled as before). Channel fields are **not** sent to the CRM. `utm_*` on the lead are never synthesized or rewritten — Source / medium and Channel can disagree for the same lead.
- Agents read these counts with **`get_leads_breakdown`** (next section).

## Leads breakdown (`get_leads_breakdown`)

Same numbers as the staff Leads page (`/private/store/leads`), read-only, `metrics_view`. Use it for "how many leads by channel / by source / medium / by page / by experiment?". Spend, campaigns, cost per lead → `get_paid_traffic`. Search Console clicks → `get_organic_traffic`.

- **One site per call.** Multi-site installs get `single_site` naming the sites left out; call again per site and never sum silently.
- **Args:** `range` `7d` | `30d` (default) | `90d` | `all` (UTC days, no custom dates); `include_test` (test + repeat leads, default off); filters `channel`, `source`, `medium`, `conversion_path`, `landing_path`, `experiment`, `variant`, `ttl`, `product`, `funnel_product`, `funnel_persona` — exact values, `"(none)"` = empty. Copy values from any breakdown row's `filter` to drill down.
- **Payload:** `site`, `range`, `start_ms` / `end_ms`, `collecting_since`, `tracking_since` (first lead with a channel), `product_since`, `funnel_since` (first lead with a page funnel product list), `funnel_filter_labels` (names for active funnel filters), `kpis` (`in_range`, `previous`, `delta_pct`, `paid` / `paid_share`, `meta_unclear`, `tagged`, `tracked`, `organic_search` / `organic_share` over tracked leads, `no_consent`, `total_all_time`), `breakdowns` (`channels`, `source_medium` with `off_convention`, `conversion_paths`, `landing_paths`, `experiments`, `funnel_products`, `funnel_personas`, `time_to_lead`).
- **Funnel products / personas:** `funnel_products` / `funnel_personas` explode the ledger's comma lists (shared decoder `parseTrackingList` / `decodeTrackingPairs` in `shared/tracking-context.ts`); a lead counts once per product / persona, so counts and `pct` can pass `in_range` / 100%. Persona row keys are `product:persona` full ids from `product_persona` pairs (since pipeline migration 42); older rows fall back to the persona list, and a persona id several products share is never guessed: key `:persona`, label "(product unknown)". Sentinels: `all` (site-wide page, not added to each product), `none` (no funnel), `"(none)"` (not recorded). `funnel_product` / `funnel_persona` match one whole list item; `funnel_product` ≠ `product` (catalog product the form resolved). Opt-in: `include_timeline` → `timeline` (day ≤ 120 days, else week; series paid, meta_unclear, organic_search, ai_assistant, other_organic, not_tracked); `include_leads` → `leads { total, shown, rows, note }` — the **latest 20** matching leads only (newest first, no paging, no name / email / phone). Narrow filters to see others.
- **Channel vs source / medium:** two views of the same leads. `source_medium` groups by UTM tags on the link; `channels` uses tags first, then the referring site for untagged visits (warning `source_medium_differs_from_channel`, always present).
- **Warnings:** `single_site`; `not_production_data` (dev machines: with the date of the last download from production, or "never downloaded" — do not report those as real numbers); `filters_match_nothing` (+ one `next_action` retrying without the most specific filter: variant → experiment → funnel_persona → funnel_product → product → conversion_path → landing_path → ttl → source → medium → channel); `paid_count_differs_from_paid_traffic` (always); `channel_tracking_partial` (tracking started inside the range or not at all: earlier leads are "Not tracked yet", `organic_share` covers tracked only); `paid_rule_change_in_range` (the 30-day paid rule starts mid-range); `no_consent_leads`; `funnel_counts_overlap` (funnel products recorded or a funnel filter set: one count per product / persona); `funnel_tracking_partial` (page product / persona recorded from inside the range, or not yet); `persona_product_unknown` (older leads with a shared persona id).

### Paid leads: this tool vs `get_paid_traffic`

`kpis.paid` here = paid platform, or (for leads recorded since channel tracking) an ad click within 30 days; `fbclid` alone is `meta_unclear`, not paid. `get_paid_traffic` credits each lead to one paid landing with its own model (`last_paid` / `first_paid`) and window. The two counts differ by design — say which one you quote. Neither tool changes the other.

## Lead product (ledger, staff Leads page)

- Lead rows store `product_id` (catalog `product_id` from `_product.yml`) and `product_slug` (product page slug). Source: the lead form's `resolveConversionProduct` (`ecommerce_product_field`, page `funnel.products`, product page) — the same result sent to GA4 as `item_id`. The form posts `ledger_product_id` / `ledger_product_slug`; both are ledger-only keys (stripped before CRM delivery).
- The server keeps a value only if it is in the site's product catalog (paused included); otherwise both are `NULL`. `NULL` also = unresolved, a site without a catalog, or recorded before pipeline migration 35. Staff see "recorded from {date}" (`product_since` on `/api/ads/leads/stats`).
- **Paused products resolve:** paused (`actively_selling: false`) stops promotion, not counting. Since 2026-10-08, GA4 `item_id` (and dataLayer consumers via GTM) also include leads for paused products, so a paused product's "Lead conversions (28d)" can rise.
- Staff Leads page: `/private/store/leads?product=<product_id or slug>` matches either column. The product card's "Lead conversions (28d)" (GA4 events, test/repeat included, 28 days) will not match the ledger count (unique, test/repeat hidden, 30-day default).
- Non-effects: no CRM field added; `program` on the CRM payload unchanged. Agents filter by product with `get_leads_breakdown` (`product`).
- **Funnel product / persona (since pipeline migration 41):** `lead_submissions.product` / `.persona` = the page funnel's (or form override's) products / personas as **full ids**, comma-joined and sorted (`all` / `none` sentinels). `lead_submissions.product_persona` (since pipeline migration 42) = `product:persona` full-id pairs, the only unambiguous persona → product link. Distinct from `product_id` / `product_slug` (the single catalog product the form resolved). Rows before migration 41 are `NULL` (no pairs before 42) — say "since launch", there is no backfill. All three keys also reach the CRM (not ledger-only). Group / filter with `get_leads_breakdown` (`funnel_products`, `funnel_personas`, `funnel_product`, `funnel_persona`).

## Limits agents must state

- **Consent:** ask regions (EU/EEA/UK/CH) need opt-in; Consent Mode v2 advanced mode models some rejected visits in GA4. Consent reaches agents **only as warnings**: `consent_estimates` → say “includes estimates”; `consent_rate_drop` → accept rate fell vs the prior 28 days. Fewer accepts means fewer *measured* visits, not fewer real ones. The per-region breakdown and banner rules are staff-only (Diagnostics → Legal `/private/diagnostics/legal`, Settings → Legal); there is no MCP consent/settings tool.
- **Covered days:** site leads exist only since the ledger started (`collecting_since`, `covered_days`). Earlier windows under-count site leads (`ledger_collecting` warning). The GA4 vs ledger gap check already limits itself to shared days (see Diagnostics issue details).
- **Low sample:** rates are unreliable under `thresholds.min_paid_visits_for_rates` (default 20) paid visits (`low_sample: true`).

## Warnings

| Code | Meaning / action |
|---|---|
| `meta_refresh_in_progress` | Background refresh queued or running (`refresh.state` queued/running) — re-call in ~1 minute (see `next_actions`) |
| `meta_refresh_failed` | Refresh didn't run (`refresh.state: failed`; job failed, or queued >5 min without starting). Message carries `refresh.error` and `refresh.retry_after`. Numbers are the last cached sync; do **not** re-call in a loop. Staff retry via Sync now (Settings → Ads); agents with `ads_settings` may pass `refresh: true` once |
| `jobs_worker_down` | Background job worker not running (`refresh.state: worker_down`), so no automatic refresh. Numbers are the last cached sync. Staff Sync now runs it in the web server instead |
| `meta_not_connected` | No token (`META_ADS_ACCESS_TOKEN`) or no enabled accounts — staff: `/private/settings/ads/meta` |
| `meta_production_snapshot` | Dev/local only: numbers are a copy downloaded from production (`meta.source: "production_snapshot"`, `meta.pulled_at`, `meta.last_date`, `meta.production_origin`). Nothing re-syncs it without a local Meta token; days after `last_date` are missing, not zero. Say "production copy as of …", never "live" |
| `meta_snapshot_hidden_accounts` | With a production copy: some downloaded accounts aren't in local Ads settings; their spend (in the message) is left out of totals |
| `ga4_not_configured` | BigQuery export unset — staff: `/private/tracking/ga4` |
| `mixed_currency` | Accounts in several currencies — compare within one currency |
| `ledger_collecting` | Window starts before the ledger — site lead counts partial |
| `consent_estimates` | Ask-region visits include Consent Mode estimates (message carries the reject %) |
| `consent_rate_drop` | `diagnostics` only: ask-region accept rate fell ≥30% vs the prior 28 days — measured visits drop, real visits may not. Staff fix in Settings → Legal |
| `ads_truncated` | `diagnostics`: some issues list only their top ads — re-call with `issue_ids` (+ `ads_offset` from the message) |
| `issue_not_found` | `issue_ids` entry not open (resolved or wrong id) — re-list |
| `ads_diagnostics_model` | Always on diagnostics: issues come from the last Run / Re-check; KPIs from saved windows |
| `ads_never_run` | No Run finished yet — issues are empty; `update_ads_issue action: run` |
| `ads_run_in_progress` / `ads_recheck_in_progress` | A Run / Re-check is running — re-call in ~1 minute |
| `ads_last_job_failed` | Last Run / Re-check failed (message has the error); issues were left as they were |
| `ads_platform_not_checked` | The last Run skipped a platform (reason in message); its issues are as last checked |
| `ads_sync_active` | An Ads Sync is running — Runs and big Re-checks return 409 until it finishes |
| `tracking_unchecked_account_unreadable` / `_setup_fetch_failed` / `_ad_removed_in_meta` / `_no_link_found` | Counts of ads with spend not checked against the template, by reason (see `details.unchecked`) |
| `visits_not_tied_to_account` | `account` / `currency` filter: untagged Meta visits (`unassigned_visits`) and/or visits with ids from unsynced accounts (`unsynced_account_visits`) were left out — visit-based numbers are a floor |
| `meta_account_unreadable` | A configured account was skipped on the last sync (`meta.accounts[].sync_error`); others still synced. Its spend is the last saved data or none. Staff fix access / id in Settings → Ads |
| `meta_account_not_synced` | Account(s) with `history_loaded: false` — spend may be missing until the next sync's automatic 90-day load |
| `refresh_not_allowed` | `refresh: true` without `ads_settings` — cached read returned |
| `refresh_failed` | `refresh: true` could not queue the sync (message has the error) |
| `untagged_visits_excluded` | Id filter: paid Meta visits to pages in the result had no tag at the filtered level — visit-based numbers are a floor |
| `leads_matched_by_last_click` | Id filter + `model: first_paid`: leads matched by last-clicked ad |
| `filter_no_match` | Id filter: listed ids matched nothing in the window — check ids (`mode: campaigns`) or widen the range |
| `range_clamped` | `since` / `until` moved inside yesterday / retention (message says which) |
| `data_gaps` | Window days with no cached Meta / GA4 file — missing, not zero |
| `diagnostics_filtered` | Diagnostics issues narrowed by id filters; KPIs and counts stay whole-site |
| `issue_filtered_out` | `issue_ids` entry open but outside the id filters |
| `range_ignored_in_diagnostics` | `since` / `until` passed to diagnostics — ignored |
| `meta_platform_not_split` | ≥50% of placement visits come from ads on an older `utm_source` tag — Facebook vs Instagram comparison is incomplete until staff update those ads' URL parameters to the template |
| `meta_platform_spend_partial` | Placement spend starts after the window start, is still loading, or the last placement read failed — `meta_platforms` spend / cost per lead are a floor; main totals unaffected |
| `google_not_connected` | Google Ads not set up — Google spend / leads missing. Staff: `/private/settings/ads/google` |
| `google_data_through` | Newest Google day loaded is before the window end — later days missing, not zero (normal for 1–2 days) |
| `google_transfer_stale` | Transfer is further behind than normal — staff check the transfer run history |
| `google_account_not_synced` | Ticked Google account(s) unreadable on the last sync — their spend missing; others fine |
| `google_network_not_split` | Many paid Google visits can't be tied to a network — network spend exact, visits per network incomplete |
| `lead_platform_legacy` | Some leads predate per-platform landing ids; their platform follows the latest UTMs, not the credited landing |
| `ad_url_changed` | Meta ad(s) changed links in the window: spend before / after stays on the old / new page; changeover days are split (approximate). See `url_changes` and rows' `url_change_days` |
| `ad_page_unconfirmed` | Older spend (before URL history) from untagged Meta ads is assumed to go to each ad's earliest known link (`unconfirmed_page_spend`); totals unchanged |
| `utm_convention_changed` | Diagnostics (meta / google): `utm_convention` changed in this environment; `{ changed_at, grace_ends_at, accepted_old_values[], file }`. Old values are info until `grace_ends_at`, then flagged. History is per environment |
| `utm_convention_invalid` | Diagnostics: values in `ads-config.yml → utm_convention` were rejected (not GA4-standard); `{ rejected[] { field, value, reason, default_used }, file }`. Defaults are used; staff fix the YAML |
| `ads_config_unreadable` | `ads-config.yml` can't be parsed; `{ error, file }`. Syncs are skipped until fixed; numbers and checks use the last good parse. Staff fix the YAML (no MCP write) |
| `diagnostics_platform_defaulted` | Diagnostics detail args without `platform` — Meta was used |
| `google_diagnostics_args_ignored` | Google diagnostics ignores id filters / `ads_limit` / `ads_offset` |

`status: "not_configured"` when neither Meta, Google Ads nor GA4 is set up.

## Side effects / non-effects

- The live server refreshes every connected site daily at 5 AM America/New_York (`ads_daily_sync` cron in the worker → queues `ads_sync`). A worker that was down at 5 AM catches up on start when no refresh started since that slot; a failed morning run is not retried by the schedule. Laptops / non-live servers never run it.
- Reads may enqueue one background refresh (`ads_sync` job; legacy `meta_ads_sync`) when data is older than 24h; the response does not wait for it. After a failed refresh, reads wait before retrying (1h, 2h, 4h, then 6h max; `refresh.retry_after`) and never run the refresh in the web server when the worker is down.
- Every mode returns `refresh`: `{ state: idle|queued|running|failed|worker_down, requested_at, started_at, finished_at, error, retry_after, progress }` (state file `.cache/{site}/ads-refresh-state.json`).
- `refresh.progress` is `{ done, total, label }` only while `running` (else `null`; also `null` if the run reports no steps). `total` is counted before the run starts: per Meta account one lookup + one per 15-day insight chunk + one per 15-day placement chunk (90 days on an account's first placement load) + creatives + conversions and pixels, then one pixel-events read, one save, then one per GA4 day (max 30; none for `older`). Steps vary in length — don't infer time remaining. Staff see it as a bar in Settings → Ads → Meta → Sync only.
- `diagnostics` (every platform and the overview) writes nothing and probes nothing. Issues change only through `update_ads_issue` (or the staff buttons): Run / Re-check write `{content_root}/validation-cache.json` + the resolved archive and `.cache/{site}/ads-diagnostics/jobs/`; mark_fixed / undo write the completion overlay in the validation cache.
- After each Sync, daily rollups (`.cache/{site}/ads-daily-rollups/`, 150 days) and the saved 7 / 28 / 90-day report windows (`.cache/{site}/ads-report-windows/`) are rebuilt for the days it touched; reads serve those (`rollup_days_missing` when a window has gaps).
- `refresh: true` → `POST /api/ads/sync` (one `ads_sync` job for Meta + Google + GA4) → side effects `meta_sync_enqueued` (writes `.cache/{site}/meta-ads-days/`, `meta-ads-platform-days/`, `meta-ads-creatives.json`, `meta-custom-conversions.json`, `meta-pixel-events.json`, `meta-ads-state.json` when the job runs) and `google_sync_enqueued` (`google-ads-days/`, `google-ads-network-days/`, `google-ads-setups.json`, `google-ads-state.json`). Each part only runs for a connected platform.
- Never changes Meta or Google Ads campaigns, ads, budgets, settings, consent, or lead delivery — `refresh` only reads. Settings edits are staff-only (`ads_settings`, UI); the consent window is `consent_settings` (staff UI).

## Staff fix for missing tracking parameters (no MCP tool)

- `missing_tracking_params` issues show **Fix via Meta** in Diagnostics → Ads for staff with `ads_edit` ("Edit live ads"; built-in roles `ads_manager`, `platform_steward`). Only **confirmed** missing (GA4 did not see enough visits with the ad's id). `tracking_params_unverified` has no Fix. Uses the same env `META_ADS_ACCESS_TOKEN` as syncs, which must also have `ads_management` (missing scope → Meta permission error at preview/apply). The HTTP routes refuse MCP loopback — agents cannot run it; point staff to the issue drawer instead.
- Effect per ad: new creative from the **same page post** (likes/comments kept) with `url_tags` = existing tags + only the template params the ad lacks (link or URL parameters); the ad is pointed at it. Max 50 ads per confirm; stops on token / permission / rate-limit errors; re-reads ad setups afterwards; the issue clears on the next Re-check (staff press Re-check; nothing re-checks automatically).
- Side effects: changed ads go back to Meta review (may pause briefly); the ad set may re-enter learning. Non-effects: budgets, audiences, ad copy/media, non-paid `utm_medium` values, other campaigns.
- **Replace mode** (UTM codes `utm_case_mixed`, `utm_bad_chars`, `utm_medium_nonstandard`, `utm_source_alias`, `utm_medium_off_convention`, only on `platform: meta` issues with Meta ads in evidence): replaces the offending `utm_source` / `utm_medium` in the ad's URL parameters with the convention's template values; other tags stay. Preview returns `mode: "replace"`, `warning` (Meta re-review) and per ad `replaced[]`. Skips `already_correct` and `value_in_link` (the value sits in the website link, which can't be edited here). GA4-only or Google UTM issues have no Fix button.
- Skipped (staff fix in Meta Ads Manager): dynamic / Advantage+ creative, catalog ad, Instant Form, no reusable page post, deleted/archived, already tagged, not found. Routes: `POST /api/ads/meta/tracking-fix/preview|apply` (`server/ads/tracking-fix.ts`, `server/ads/meta-write.ts`).
- **Google: no Fix button.** Google issues (`google_auto_tagging_off`, missing URL suffix) are fixed by staff in Google Ads (Account settings → Auto-tagging; Account settings → Final URL suffix, copied from Settings → Ads → Google). We have no Google Ads API write access (read-only BigQuery transfer). A staff-only add-only fix is reconsidered once the transfer has ≥28 days of data and those issues show real spend affected; until then point staff to the issue's how-to-fix.

## Paths

- Server: `server/ads/` (`meta-client.ts`, `meta-ads-days.ts`, `google-ads-bq.ts`, `google-ads-days.ts`, `paid-detection.ts`, `ads-report.ts`, `ads-diagnostics.ts`, `google-ads-diagnostics.ts`, `ads-diagnostics-overview.ts`, `ads-rollups.ts`, `ads-setup.ts`, `lead-ledger.ts`, `ads-refresh.ts`), issue lifecycle `server/ads/diagnostics/` (`codes.ts` verify kinds, `grouping.ts`, `apply.ts`, `verify.ts`, `engine.ts`, `fork-service.ts`, `recheck.ts`, `read.ts`, `actions.ts`), job `server/jobs/definitions/ads-recheck.ts`, worker `scripts/ads-diagnostics-worker.ts`; routes `server/routes/ads.ts` (`GET /api/diagnostics/ads?platform=overview|meta|google`, `POST /api/diagnostics/ads/run|recheck|mark-fixed|undo`)
- Shared rules: `shared/paid-traffic.ts`, `shared/paid-attribution.ts`, `shared/ads-diagnostics-rules.ts`, `shared/ads-settings.ts`
- Settings: `site_<name>/ads-config.yml` (accounts, thresholds, lead conversions, test emails, `utm_convention`). Legacy fallback: the `ads:` block in `settings.yml`, read only while `ads-config.yml` does not exist (data migration `004_move_ads_settings_to_ads_config` moves it; when both exist `ads-config.yml` wins); token env `META_ADS_ACCESS_TOKEN` (`ads_read` for syncs; add `ads_management` for staff Fix via Meta)
- Staff UI: Diagnostics → Ads overview (`/private/diagnostics/ads`), Meta (`/private/diagnostics/ads/meta`), Google (`/private/diagnostics/ads/google`); Settings → Ads → Meta / Google (`/private/settings/ads/meta|google`); Diagnostics → Legal (`/private/diagnostics/legal`, consent breakdown), Ads perspective on each content type list, Settings → Ads
- Consent diagnostics: `server/legal/legal-diagnostics.ts`, route `GET /api/diagnostics/legal` in `server/routes/consent.ts`
- Cookies & consent: `docs/cookies.md`
