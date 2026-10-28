# Cookies

One list of every cookie the public site and the staff area use. Staff and legal can copy the table into the public Privacy Policy. File paths and helper names live in **For developers** at the end.

No cookie ever stores a visitor's name, email or phone number.

## Cookie table

"Page scripts can read it" = JavaScript on our pages can see the value. "Server only" = the browser sends it to our server, but scripts on the page cannot read it (HttpOnly).

"Whole site" = shared across our subdomains (for example `4geeks.com` and `learn.4geeks.com`). "This host" = only the exact domain that set it.

### Our cookies (first party)

| Name | Set by | Who can read it | Scope | Lifetime | Purpose | Category | What it stores |
|---|---|---|---|---|---|---|---|
| `4g_consent` | Server, when the visitor answers the banner (or scrolls in notice regions) | Page scripts + server | Whole site | 12 months after accepting, 5 days after rejecting (configurable) | Remembers the visitor's cookie choice so the banner does not reappear | Necessary | Choice (accepted / rejected / accepted by browsing), banner type shown, date |
| `4g_ads` | Server, only after consent | Server only | Whole site | 30 days | Remembers which ad or campaign brought the visitor, so a later form submission can be credited to the right page | Advertising | Latest campaign tags (UTM), ad click IDs, Meta browser ID, first and last paid landing page with time. No personal data |
| `4g_ctx` | Page script | Page scripts | Whole site | 180 days | Keeps the visitor's language, nearest campus and region between pages. After consent it also keeps campaign tags and landing pages | Necessary (campaign fields: Advertising) | Language, campus, region, approximate city; after consent: campaign tags, click IDs, first page visited |
| `4g_user_id` | Page script and server | Page scripts + server | Whole site | 180 days | Random ID for this browser. Keeps page versions consistent and detects repeat form submissions | Necessary | A random identifier (not linked to a person) |
| `4g_visitor_id` | Older versions of the site | Page scripts + server | Whole site | 180 days | Legacy name for `4g_user_id`, still read so returning visitors keep the same ID | Necessary | A random identifier |
| `4g_versioning` | Server | Server only | This host | 30 days | Remembers which version of a page the visitor was shown so it does not change between visits | Necessary | Random browser ID + page version per page |
| `4g_tok` | Page script, after the visitor logs in | Page scripts | Whole site | 180 days | Keeps the visitor logged in on account features | Necessary | Login token |
| `4g_redir_trace` | Server, when a redirect happens | Page scripts + server | Whole site | 2 minutes | Debugging: which redirects led to the current page | Necessary | List of recent redirect steps (URLs, no personal data) |

### Staff-only cookies (not set for public visitors)

| Name | Set by | Who can read it | Scope | Lifetime | Purpose |
|---|---|---|---|---|---|
| `4g_staff` | Server, on staff login | Server only, only on `/private` pages | This host | Staff session length | Lets staff open admin pages |
| `sidequest_dash` | Server | Server only | This host | Short dashboard session | Access to the background jobs dashboard |
| `sidebar_state` | Page script | Page scripts | This host | 7 days | Remembers whether the admin sidebar is open |

### Third-party cookies (loaded through Google Tag Manager or embeds)

These are set by other companies' scripts. We do not load the Meta pixel or GA4 from our code; they come through Tag Manager and respect the consent choice (see **Consent Mode**).

| Name | Company | Lifetime | Purpose | Category |
|---|---|---|---|---|
| `_ga`, `_ga_<ID>` | Google Analytics 4 | Up to 2 years | Counts visits and pages; tells new from returning visitors | Analytics |
| `_fbp` | Meta pixel | 90 days | Meta's browser ID, used to measure ad results | Advertising |
| `_fbc` | Meta pixel (or our script, from the `fbclid` in an ad link) | 90 days | Records that the visitor clicked a Meta ad | Advertising |
| Cloudflare Turnstile | Cloudflare | Session | Bot protection on forms (set on Cloudflare's domain, not ours) | Necessary |

**Safari note:** Safari limits cookies set by page scripts (`4g_ctx`, `4g_user_id`, `4g_tok`, `_ga`, `_fbp`) to 7 days after the visitor's last visit. Server-set cookies (`4g_ads`, `4g_versioning`, `4g_consent`) keep their full lifetime.

## What waits for consent

- **Before consent:** campaign tags, ad click IDs and landing pages are kept in the page's memory only. They are not written to `4g_ctx`, and `4g_ads` is not set. GA4 and the Meta pixel run in cookieless mode (see Consent Mode).
- **Same-visit leads:** if the visitor submits a form before answering the banner, that submission still carries the campaign details from memory. Nothing is stored in a cookie.
- **After consent:** campaign details are saved to `4g_ctx` and `4g_ads`, and GA4 / Meta cookies are allowed.
- **After reject:** `4g_ads` is deleted and campaign fields are removed from `4g_ctx`. Language, campus and login cookies keep working.
- **Always on (necessary):** `4g_consent`, `4g_user_id`, `4g_versioning`, `4g_tok`, `4g_redir_trace` and the non-campaign parts of `4g_ctx`.

## How consent is remembered

- Accept is remembered for **12 months**, reject for **5 days**. Both are configurable in **Settings → Legal → Consent Window**.
- Setting reject under 6 months shows a warning: some EU regulators treat asking again that soon as pressure.
- Visitors can change their choice any time with **Privacy choices** in the footer.

## Consent Mode

We use Google Consent Mode v2 in **advanced** mode:

- Before the page loads, all four signals (`ad_storage`, `analytics_storage`, `ad_user_data`, `ad_personalization`) default to **denied**.
- While denied, Google tags send cookieless pings (no cookies, no IDs). Google uses these to model conversions.
- When the visitor accepts (or browses in a notice region), the signals switch to **granted**. The Meta pixel receives `fbq('consent', 'grant')`, and Tag Manager gets a `consent_update` event.

## Regions

- **Ask regions** (default: EU countries, Iceland, Liechtenstein, Norway, UK, Switzerland): the banner shows equal **Accept** and **Reject** buttons. Ignoring it means no consent.
- **Everywhere else (notice):** a short notice with **OK**. Pressing OK or scrolling counts as consent.
- **Unknown country** (location could not be detected): notice by default; can be changed to ask in Consent Window.
- The country list can be the default or a custom list (Consent Window).

## Ads-first pages

Content types with **Optimize for ads** on (content type dashboard) are ad landing pages:

- **Notice regions:** consent counts as soon as the visitor lands (stored as "accepted by browsing"); the notice bar still shows with **OK**. Ask regions are unchanged: Accept or Reject. When the server already knows the visitor's country (cached IP lookup), consent is granted before Tag Manager starts; otherwise it is granted once the banner's country lookup answers, so the very first page view of that visit may go out cookieless.
- **Unknown country** follows the Consent Window setting, like the rest of the site.
- Tag Manager loads on page load instead of on first interaction. Any page opened with `gclid`, `fbclid`, `gbraid` or `wbraid` in the URL also loads it on page load (consent is unchanged there).

## Adding a new cookie

1. Pick a category: necessary, analytics or advertising.
2. If it is not necessary, set it only after consent (server: check `4g_consent`; page script: `hasTrackingConsent()`). For Tag Manager tags, use the built-in consent checks.
3. Never store name, email or phone in a cookie.
4. Add a row to the table above.
5. Ask legal to update the Privacy Policy.

## For developers

| Cookie | Code |
|---|---|
| `4g_consent` | `shared/consent.ts` (`serializeConsentCookie`, format `v1.<decision>.<mode>.<epochSec>`), `server/routes/consent.ts` (`POST /api/consent`), `client/src/lib/consent.ts` |
| `4g_ads` | `server/ads/ad-context.ts` (base64url JSON, ≤3500 bytes), `POST /api/ad-context`, client `client/src/lib/adContext.ts` |
| `4g_ctx` / `4g_tok` | `client/src/lib/sessionCookie.ts`, `client/src/lib/sessionBootstrap.ts` (`saveSession` strips marketing fields without consent via `stripMarketingFields` in `shared/session.ts`) |
| `4g_user_id` / `4g_visitor_id` | `client/src/lib/sessionBootstrap.ts`, `server/versioning/cookie-utils.ts` (`readUserId`) |
| `4g_versioning` | `server/versioning/cookie-utils.ts` |
| `4g_redir_trace` | `server/redirect-trace-cookie.ts`, `shared/redirect-trace.ts` |
| `4g_staff` | `server/staff-session-cookie.ts` (path `/private`) |
| `sidequest_dash` | `server/sidequest-dashboard-auth.ts` |
| `sidebar_state` | `client/src/components/ui/sidebar.tsx` |
| Consent Mode default | `client/index.html` (inline script before GTM) |
| Banner + settings | `client/src/components/ConsentBanner.tsx`, `client/src/components/settings/ConsentWindowCard.tsx`, `settings.yml` → `consent.window` |
| Consent counts | `server/ads/consent-store.ts` → pipeline SQLite `consent_daily` (25 months) |
| Ads-first visit channel | `shared/page-visit-channel.ts` maps `classifyChannel` (`shared/traffic-channel.ts`) onto the page stats buckets |
| Ads-first pages | `server/ads/ads-first.ts` (`applyPageBoot` → `window.__4G_PAGE__`: ads-first flag, visitor consent mode, page token), inline scripts in `client/index.html`, landing consent persisted by `ConsentBanner.tsx` |
| Own visit counts (no cookie) | `client/src/lib/page-ready.ts` → `POST /api/page-ready`, `/api/page-link` → `data/<site>/visits.db`. Sets and reads no cookie or storage; nothing to add to the table above |

Parent-domain scope comes from `getParentCookieDomain` (skipped on localhost and IPs).
