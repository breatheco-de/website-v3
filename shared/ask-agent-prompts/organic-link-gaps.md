---
id: organic-link-gaps
version: 1
title: Internal linking gaps
used_when: >
  Staff clicks Ask Agent on a row in Diagnostics → SEO → Opportunities →
  "Internal linking gaps".
intention: >
  Raise inbound internal links to this ranking URL to at least three by adding
  contextual links from related live pages — not by inventing a keyword strategy
  or spamming nav/footer links.
success_looks_like: >
  Related live pages identified; 1–3 contextual body links added toward this URL
  (or propose_change); short summary of which sources now link here.
failure_modes:
  - Invents a search-query content rewrite instead of linking
  - Adds only footer/nav/sitewide chrome links
  - Links from unrelated pages
  - Runs diagnostics with confirm:true
required:
  - url
  - position
  - impressions
  - inbound
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

Goal: Raise inbound internal links to this URL to at least 3.

Target:
- url: {{url}}
- position: {{position}} · impressions: {{impressions}} · inbound: {{inbound}} ({{window_label}})
- MCP: {{mcp_url}}

Do:
1. Resolve that URL to contentType/slug/locale via MCP. If you cannot resolve it, stop and say so.
2. Find related live pages (same topic/cluster) via list_entries / content tools.
3. Add contextual in-body links from those pages to this URL until inbound is on track (≥3). Prefer quality over volume.
4. Summarize which pages now link here.

Tools: list_entries, get_entry_content, update_fields, propose_change (if you cannot edit).

Don’t: invent a keyword strategy for this URL; add footer/nav spam; rewrite unrelated pages; run diagnostics with confirm:true; locale fan-out unless a tool next_action says so.
