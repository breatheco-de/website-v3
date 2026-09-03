---
id: organic-missing-serp
version: 1
title: Missing SERP features
used_when: >
  Staff clicks Ask Agent on a row in Diagnostics → SEO → Opportunities →
  "Missing SERP features".
intention: >
  Help the page compete for featured snippet / People Also Ask or appear in
  the live SERP for one page-1 query, via clear answer blocks and schema
  companions — without inventing fake SERP features.
success_looks_like: >
  Entry resolved; FAQ/answer or schema-related edits (or propose_change);
  summary tied to the query and SERP gap shown in Target.
failure_modes:
  - Claims to “set” Google features that cannot be forced
  - Rewrites unrelated pages
  - Ignores the SERP badges in Target
  - Runs diagnostics with confirm:true
required:
  - query
  - url
  - position
  - impressions
  - serp_status
  - window_label
  - mcp_url
max_chars: 1300
sections:
  - Goal
  - Target
  - Do
  - Tools
  - Don’t
---

Goal: Improve chance of winning snippet/PAA or appearing for this query in the live SERP.

Target:
- query: {{query}}
- url: {{url}}
- position: {{position}} · impressions: {{impressions}} ({{window_label}})
- SERP snapshot: {{serp_status}}
- MCP: {{mcp_url}}

Do:
1. Resolve that URL to contentType/slug/locale via MCP. If you cannot resolve it, stop and say so.
2. Read content + SEO; add a clear, concise answer block and/or FAQ that matches the query (and PAA-style questions when relevant).
3. Fix schema.org companions / structured answers if get_entry_seo shows gaps.
4. Summarize what you changed for this query.

Tools: list_entries, get_entry_content, get_entry_seo, update_fields, propose_change (if you cannot edit).

Don’t: invent or promise SERP features; rewrite unrelated pages; run diagnostics with confirm:true; locale fan-out unless a tool next_action says so.
