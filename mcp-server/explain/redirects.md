# Redirects

CMS 301/302 routing lives in **two YAML stores**. Runtime is **first-match** (one winner). Extra claims are conflicts, not a second winner. Browsers cache 301s — test in incognito.

## Capability

`test_redirect` requires **`read_redirects`**; `update_redirect` requires **`edit_redirects`**. Built-in Webmaster has both. Metrics Viewer (`metrics_view` only) does not. Missing cap → `denyResponse("read_redirects")` / `denyResponse("edit_redirects")`. Agent identity is the connected staff user (`get_current_user` / `check_capability`).

## Two MCP tools

| Tool | Role |
|---|---|
| `test_redirect` | Inspect only. Returns winner, `conflicts[]`, `fixes[]`, `live_content`. Use this to verify. |
| `update_redirect` | One rule per call. Required `action`: `add` \| `delete` \| `move`. |

Do not dump the full catalog. Do not use `update_fields` as the primary redirect writer (it can still touch `meta.redirects` but is not the path). Do not use slug-scoped `run_entry_diagnostics` to re-check redirects.

## Two stores

1. **Page aliases** — `{directory}/{slug}/{locale}.yml` `meta.redirects`. **Dest locale file only.** No `all_languages` / `_common.yml` in v1.
2. **Custom file** — `site_<name>/custom-redirects.yml`. Regex `from`, external dest, or DB-backed dest without a YAML folder.

A write **does not** update the other store.

## First-match order

Exact `before` → regex `before` → fallbacks → canonical soft-match. `conflicts[].kind`: `duplicate_from` \| `regex_shadowed` \| `overwrites_content`.

`overwrites_content` uses **`contentIndex.isKnownUrl` only** (not the SEO sitemap). Locale-home aliases (`/`, `/en`, `/es`, `/us` — see `shared/public-app-routes.ts` `LOCALE_HOME_ALIASES`) are **not** live; they must 301 to the canonical homepage per locale (`/en/home`, `/es/inicio`). After app routing changes, re-run validation / clear diagnostics cache if stale overwrite issues linger.

## `update_redirect`

Call `test_redirect` first. Live routing only — **`variant` is refused**.

| `action` | Required | Notes |
|---|---|---|
| `add` | `from`, `to` | Optional `before_from` (custom file only). Omit `before_from` = append. Infer store as above. |
| `delete` | `from`, `source` | Locale YAML or `site_*/custom-redirects.yml`. |
| `move` | `from`, `before_from` | **Fails** unless the rule is in `custom-redirects.yml`. Does not convert page aliases into the custom file. |

`before_from` on a page-YAML add → **fail** (not ignored).

Regex is allowed. Position can still be shadowed by an earlier broader pattern; `move` + `before_from` (custom only) raises it. No full-list reorder, no PUT of `custom-redirects.yml`, no regex inline from/to editor via MCP.

## Confirms (stacked)

One `action_required` listing **every** missing flag. Re-call with all of them. Overwrite confirm **does not** imply live confirm.

- `confirm_overwrite_content` — hiding or unhiding a live URL.
- `confirm_live_edit` — dest-locale file has `versioning.yml`.

## After write

`side_effects`: relative file written, redirect cache flush, redirects validation job queued, `markFileAsModified`. **Non-effect:** the other store. **Non-effect:** slug-scoped `run_entry_diagnostics` does not re-run redirects (the write path queued redirects itself).

`next_actions`: recommended `test_redirect` on the same URL. Tool names are only `test_redirect` / `update_redirect`.
