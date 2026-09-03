---
id: organic-page2
version: 1
title: Page 2 opportunity
used_when: >
  Staff clicks Ask Agent on a row in Diagnostics → SEO → Opportunities →
  "Page 2 (positions 11–20)".
intention: >
  Steer an MCP-connected agent to improve one query×URL that already ranks
  about positions 11–20 so it can move toward page 1, via content match and
  internal links — not a full site rewrite.
success_looks_like: >
  Entry resolved; targeted body/FAQ and/or internal-link edits (or propose_change);
  brief summary scoped to that query and URL.
failure_modes:
  - Rewrites unrelated pages or locales
  - Ignores the specific query and only "improves SEO" generically
  - Runs diagnostics with confirm:true
  - Pastes a huge plan instead of making scoped MCP changes
required:
  - query
  - url
  - position
  - impressions
  - window_label
  - mcp_url
max_chars: 1200
sections:
  - Goal
  - Target
  - Do
  - Tools
  - Don’t
---

Goal: Move this page from Google page 2 toward page 1 for one query.

Target:
- query: {{query}}
- url: {{url}}
- position: {{position}} · impressions: {{impressions}} ({{window_label}})
- MCP: {{mcp_url}}

Do:
1. Resolve that URL to contentType/slug/locale via MCP (list_entries / content tools). If you cannot resolve it, stop and say so — no edits.
2. Read the entry + SEO; strengthen how the page matches the query (body, headings, FAQ) without changing the page’s main topic.
3. Add 1–3 contextual internal links from stronger related live pages to this URL.
4. Summarize what you changed and why.

Tools: list_entries, get_entry_content, get_entry_seo, update_fields, propose_change (if you cannot edit).

Don’t: rewrite unrelated pages; run diagnostics with confirm:true; locale fan-out unless a tool next_action says so.
