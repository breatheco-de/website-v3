---
id: redirect-overwrites-content
version: 2
title: Redirect overwrites live content
used_when: >
  Staff clicks Ask Agent from the Redirect Conflict Resolve dialog (or Diagnostics
  redirect row) for REDIRECT_OVERWRITES_CONTENT after Redirects → Test confirms
  the path is live content.
intention: >
  Resolve a real page-vs-redirect conflict on one path. Default: the redirect is the
  newer decision (consolidation/pruning), so retire the old page and keep the 301.
  Remove the redirect only when the old page clearly should stay — never leave both.
success_looks_like: >
  test_redirect / isKnownUrl agrees with the chosen outcome; old page deleted (its URL
  moved into the destination's meta.redirects) or, when the page should stay, redirect
  removed; site_* pushed with commit SHA when YAML changed; redirects validation re-run;
  plain-language report of which option and why.
failure_modes:
  - Clears diagnostics cache instead of fixing YAML
  - Removes the redirect just to clear the warning
  - Deletes both the page and the redirect
  - Treats folder-slug phantom paths as live without test_redirect / isKnownUrl
  - Edits unrelated redirects or locales
required:
  - redirect_url
  - source_file
  - code
  - description
  - mcp_url
max_chars: 2800
sections:
  - Goal
  - Target
  - Do
  - Tools
  - Don’t
---

Goal: Resolve REDIRECT_OVERWRITES_CONTENT so either the page or the redirect owns `{{redirect_url}}`, not both.

Target:
- Code: {{code}}
- Path (redirect from): {{redirect_url}}
- Redirect defined in: {{source_file}}
- Situation: {{description}}
- Live content at that path: confirmed via Redirects → Test / contentIndex.isKnownUrl
- MCP: {{mcp_url}}

Do:
1. Re-confirm with test_redirect (or Redirects → Test) that {{redirect_url}} is live content, not a phantom folder-slug URL.
2. Default (keep the 301): retire the old page at {{redirect_url}} with delete_entries. For a page redirect, pass redirect_to = the page that owns {{source_file}}; for custom-redirects.yml, pass no_redirect_reason "covered by custom-redirects.yml". Check the preview it returns (dependents, ads), then run it with confirm:true.
   Only if the old page clearly should stay: delete the redirect from {{source_file}} (update_redirect delete; confirm_overwrite_content if required).
3. If editing site_* YAML, push to the content GitHub repo in the same task (commit SHA required).
4. Re-run site-wide redirects validation. Report which option and why in plain language.

Tools: test_redirect, delete_entries, update_redirect, get_entry_content.

Don’t: remove the redirect just to clear the warning; clear the diagnostics cache to “fix” it; delete both page and redirect; invent live URLs from folder names — trust isKnownUrl / Test a URL.
