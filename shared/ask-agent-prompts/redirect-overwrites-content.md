---
id: redirect-overwrites-content
version: 1
title: Redirect overwrites live content
used_when: >
  Staff clicks Ask Agent from the Redirect Conflict Resolve dialog (or Diagnostics
  redirect row) for REDIRECT_OVERWRITES_CONTENT after Redirects → Test confirms
  the path is live content.
intention: >
  Resolve a real page-vs-redirect conflict on one path: either remove the redirect
  (keep the page) or change/retire the content URL so the 301 can own the path —
  never leave both.
success_looks_like: >
  test_redirect / isKnownUrl agrees with the chosen outcome; redirect removed or
  content URL changed; site_* pushed with commit SHA when YAML changed; redirects
  validation re-run; plain-language report of which option and why.
failure_modes:
  - Clears diagnostics cache instead of fixing YAML
  - Deletes both the page and the redirect without an explicit staff choice
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
2. Choose with staff intent: keep page → delete the redirect from {{source_file}} (update_redirect delete; confirm_overwrite_content if required); or keep 301 → change/retire the content URL first, then the path can redirect.
3. If editing site_* YAML, push to the content GitHub repo in the same task (commit SHA required).
4. Re-run site-wide redirects validation. Report which option and why in plain language.

Tools: test_redirect, update_redirect, get_entry_content, update_fields (only if changing the content URL/slug).

Don’t: clear the diagnostics cache to “fix” it; delete both page and redirect without an explicit choice; invent live URLs from folder names — trust isKnownUrl / Test a URL.
