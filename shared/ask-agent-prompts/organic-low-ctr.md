---
id: organic-low-ctr
version: 1
title: High impressions, low CTR
used_when: >
  Staff clicks Ask Agent on a row in Diagnostics → SEO → Opportunities →
  "High impressions, low CTR".
intention: >
  Raise click-through at the current page-1 rank by improving SERP title and
  description fit for the query — not by rewriting the whole page.
success_looks_like: >
  Entry resolved; meta.page_title and/or meta.description updated (or propose_change);
  short summary of the new listing copy for that query.
failure_modes:
  - Rewrites the full page body when meta alone would fix CTR
  - Changes unrelated locales or pages
  - Invents keywords unrelated to the query
  - Runs diagnostics with confirm:true
required:
  - query
  - url
  - position
  - impressions
  - ctr
  - expected_ctr
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

Goal: Raise CTR for this page-1 listing without tanking relevance.

Target:
- query: {{query}}
- url: {{url}}
- position: {{position}} · impressions: {{impressions}}
- CTR: {{ctr}} · expected: {{expected_ctr}} ({{window_label}})
- MCP: {{mcp_url}}

Do:
1. Resolve that URL to contentType/slug/locale via MCP. If you cannot resolve it, stop and say so.
2. Read SEO via get_entry_seo; rewrite meta.page_title and/or meta.description so the listing matches the query and invites the click.
3. Keep body changes minimal unless the title cannot be honest without a small on-page fix.
4. Summarize the new title/description in plain text.

Tools: list_entries, get_entry_seo, update_fields, update_meta_fields, propose_change (if you cannot edit).

Don’t: rewrite the whole page; run diagnostics with confirm:true; locale fan-out unless a tool next_action says so.
