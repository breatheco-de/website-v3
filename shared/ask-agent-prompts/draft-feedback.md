---
id: draft-feedback
version: 1
title: Draft feedback from AI Agent
used_when: >
  Staff clicks Get feedback from AI Agent while editing an unpublished draft
  (EditModeWrapper share-draft flow).
intention: >
  Review one unpublished draft for clarity, conversion, accuracy, and gaps —
  especially eligibility, how to apply, and sourced outcomes — without publishing
  or editing YAML unless staff ask.
success_looks_like: >
  Draft read via MCP and/or share link; concrete feedback; no publish, traffic
  allocation, or unsolicited YAML edits.
failure_modes:
  - Publishes or allocates traffic
  - Edits YAML without being asked
  - Reviews a different entry or locale
  - Vague feedback with no actionable items
required:
  - share_url
  - content_type
  - slug
  - locale
  - variant
  - mcp_url
max_chars: 1200
sections:
  - Goal
  - Target
  - Do
  - Tools
  - Don’t
---

Goal: Review this unpublished draft and give actionable feedback using the 4Geeks CMS MCP server.

Target:
- Share link (open in browser): {{share_url}}
- contentType: {{content_type}}
- slug: {{slug}}
- locale: {{locale}}
- variant: {{variant}}
- MCP: {{mcp_url}}

Do:
1. Read the draft via MCP (get_entry_content) and/or the share link above.
2. Comment on clarity, conversion, accuracy, and missing content — especially eligibility, how to apply, and sourced outcomes.
3. Stay on this entry only ({{content_type}}/{{slug}}, locale {{locale}}, variant {{variant}}).

Tools: get_entry_content, get_entry_seo (read-only).

Don’t: publish, allocate traffic, or edit YAML unless I ask.
