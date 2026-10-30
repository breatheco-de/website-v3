# Redirects

CMS 301/302 routing lives in **two YAML stores**. Runtime is **first-match** (one winner). Extra claims are conflicts, not a second winner. Browsers cache 301s — test in incognito.

## Capability

`test_redirect` requires **`read_redirects`**. Live `update_redirect` requires **`edit_redirects`**; draft mode (`variant`) requires **`seo_edit`** for the page's content type. Built-in Platform Steward has all three. Swarm SEO Specialist and Publisher have `read_redirects` + `seo_edit` (draft mode only, never live). Metrics Viewer (`metrics_view` only) has none. Missing cap → `denyResponse("read_redirects")` / `denyResponse("edit_redirects")` / `denyResponse("seo_edit", type)`. Agent identity is the connected staff user (`get_current_user` / `check_capability`).

## Two MCP tools

| Tool | Role |
|---|---|
| `test_redirect` | Inspect only. Returns winner, `conflicts[]`, `fixes[]`, `live_content`. Use this to verify. |
| `update_redirect` | One rule per call. Required `action`: `add` \| `delete` \| `move`. |

Do not dump the full catalog. `update_fields` / `update_entry_attributes` reject `meta.redirects` (`meta_redirects_use_update_redirect`); `update_redirect` is the only MCP writer. Do not use slug-scoped `run_entry_diagnostics` to re-check redirects.

## Two stores

1. **Page aliases** — the destination page's `meta.redirects`, whatever the page's source (static or database). MCP writes the dest-locale `{directory}/{slug}/{locale}.yml`; when the page exists in that language but has no file yet (database pages), the file is created (`side_effects` `file_created`). Staff "all languages" writes the page's `_common.yml`; languages without the page are skipped with warning `redirect_languages_skipped`. MCP does not write `_common.yml`.
2. **Custom file** — `site_<name>/custom-redirects.yml`. Regex `from`, external dest, or a known URL that is not an entry page (e.g. a listing). Unknown destinations → 404.

A write **does not** update the other store. `before_from` with a page destination → 400 `before_from_page_yaml`.

## Removed pages (`SOURCE_ITEM_REMOVED`)

When a database item disappears upstream (checked against a fresh copy), its page 404s; entry files are kept and nothing is written. The issue row carries `redirect_suggestion`: target = cluster main page (`pillar_path` when live) → listing page → the language's home page, skipping targets that are not live or are themselves redirect sources. `inbound[]` lists old addresses saved on the removed page (`{locale}.yml` and `_common.yml` `meta.redirects`).

Apply with `update_redirect` `action: add`, `from` = removed page URL, `to` = suggested target, `removed_entry: { content_type, slug, locale }`. `removed_entry` moves every inbound address to the same target (saved on the target page, or custom file when the target is not a page) and deletes it from the removed page; the response lists `moved_inbound` / `not_moved`. Show staff the inbound list before applying.

## First-match order

Exact `before` → regex `before` → fallbacks → canonical soft-match. `conflicts[].kind`: `duplicate_from` \| `regex_shadowed` \| `overwrites_content`.

A custom `to` may be `{{ entry.field }}` (legacy `{{ single.field }}` too). On the visit, that field is read from the entry the URL belongs to — whichever content type `url_pattern` matches, not a type named on the rule. The same `resolveSingleVars` pass pages use fills it in. Empty, missing, or anything that is not a site path or `http(s)` URL does not redirect; the page is served. `status: 302` stays temporary. Workshop series sessions use this: non-representative days store the representative URL on `redirectTo`.

Custom regex fallbacks (`custom-redirects.yml`, `priority: fallback`) only fire when the destination reaches a live page or external URL; otherwise the next rule is tried, then 404. A destination needing a blog category fix, or that is itself a redirect (max 3 hops), resolves to the final URL in one 301. Exact fallbacks, `before` rules, and page `meta.redirects` fallbacks are not guarded. `test_redirect` reports the same final `resolvedTo`.

`overwrites_content` uses **`contentIndex.isKnownUrl` only** (not the SEO sitemap). Locale-home aliases (`/`, `/en`, `/es`, `/us` — see `shared/public-app-routes.ts` `LOCALE_HOME_ALIASES`) are **not** live; they must 301 to the canonical homepage per locale (`/en/home`, `/es/inicio`). After app routing changes, re-run validation / clear diagnostics cache if stale overwrite issues linger.

## `update_redirect`

Call `test_redirect` first. Without `variant` it edits live routing (below). With `variant` it edits a draft (next section).

| `action` | Required | Notes |
|---|---|---|
| `add` | `from`, `to` | Optional `before_from` (custom file only). Omit `before_from` = append. Infer store as above. Optional `removed_entry` (SOURCE_ITEM_REMOVED) moves the removed page's old addresses too. |
| `delete` | `from`, `source` | Locale YAML or `site_*/custom-redirects.yml`. |
| `move` | `from`, `before_from` | **Fails** unless the rule is in `custom-redirects.yml`. Does not convert page aliases into the custom file. |

`before_from` on a page-YAML add → **fail** (not ignored).

Regex is allowed. Position can still be shadowed by an earlier broader pattern; `move` + `before_from` (custom only) raises it. No full-list reorder, no PUT of `custom-redirects.yml`, no regex inline from/to editor via MCP.

## Draft mode (`variant`)

A page's own old addresses can be staged on its draft so they go live with the page (e.g. a draft that renames the page). Cap: `seo_edit` for `content_type`.

| `action` | Required | Notes |
|---|---|---|
| `add` | `from`, `content_type`, `slug`, `locale`, `variant` | Exact path only (no regex). Never `to`, `before_from`, `removed_entry`, `priority`, or confirms — the address always points to this page. Optional `status` 301/302. |
| `delete` | same | May remove addresses copied from live (publish then removes them from live; proposal review is the gate). Optional `source` must be the draft file. |

`move` is refused. Rules:

- The draft file `{directory}/{slug}/{variant}.{locale}.yml` must exist (`draft_missing` → `create_variant`) and be at **0% traffic** (`draft_has_traffic`).
- A live page, an address already redirected elsewhere, or one caught by a pattern is refused — **except** this page's own current address in that locale when the draft gives the page a different `slug` there (rename).
- **Not indexed:** draft redirects never affect live routing, even on never-published pages. `test_redirect` shows live only. Warning `draft_redirect_dormant`.
- **Traffic:** a non-default variant whose old addresses differ from today's live file (including addresses live gained after the draft was made) cannot get traffic — `variant_has_redirect_changes` on the traffic save. Publish it instead, or make its old addresses match live. Lowering to 0% is always allowed.
- **Publish:** when live changed since the draft was made, `meta.redirects` merges per address (draft adds/removes + live adds/removes); only the same address changed differently on both sides conflicts (`meta.redirects[/path]`). Added addresses are re-checked; conflicting ones are dropped with warning `draft_redirects_skipped` (`details.skipped[]`: `from`, `code`, `message`) and publish continues. When live `meta.redirects` changed, publish flushes the redirect cache and queues redirects validation.

## Confirms (stacked)

One `action_required` listing **every** missing flag. Re-call with all of them. Overwrite confirm **does not** imply live confirm.

- `confirm_overwrite_content` — hiding or unhiding a live URL.
- `confirm_live_edit` — dest-locale file has `versioning.yml`.

## After write

`side_effects`: relative file written, redirect cache flush, redirects validation job queued, `markFileAsModified`. **Non-effect:** the other store. **Non-effect:** slug-scoped `run_entry_diagnostics` does not re-run redirects (the write path queued redirects itself).

`next_actions`: recommended `test_redirect` on the same URL. Tool names are only `test_redirect` / `update_redirect`.
