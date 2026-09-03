---
id: page-diagnostics
version: 1
title: Page Diagnostics Solve with AI
used_when: >
  Staff clicks Solve with AI Agent from Page Errors (DebugBubble) or pipeline
  View validation issues for one entry with open errors/warnings.
intention: >
  Fix the open validation issue queue for one entry via MCP — claim each issue,
  apply scoped YAML fixes, complete or release with reports — without starting a
  new diagnostics job.
success_looks_like: >
  agent_session used; issues claimed/completed or released with min-80 reports;
  copy changes listed in plain text; scope limited to this entry.
failure_modes:
  - Edits unrelated pages or locales without next_action
  - Skips update_issue claim/complete/release
  - Runs run_entry_diagnostics with confirm:true
  - Pastes JSON/YAML into human reports instead of plain new copy values
required:
  - url
  - content_type
  - slug
  - locale
  - variant_line
  - file_path
  - mcp_url
  - error_block
  - warning_block
max_chars: 3500
sections:
  - Goal
  - Target
  - Do
  - Tools
  - Don’t
---

Goal: Fix open Page Diagnostics validation issues for one entry using the 4Geeks CMS MCP server.

Target:
- URL: {{url}}
- contentType: {{content_type}}
- slug: {{slug}}
- locale: {{locale}}{{variant_line}}
- filePath: {{file_path}}
- MCP: {{mcp_url}}

Known issues (open work queue only):
### Errors
{{error_block}}

### Warnings
{{warning_block}}

Do:
1. Authenticate to MCP if needed. Call agent_session start; pass agent_session_id on every mutate; end with agent_session summarize (report min 80).
2. Treat the Known issues list as authoritative. Inspect with get_entry_content / get_entry_fields; fix with update_fields (and related write tools). Every content mutate needs report (min 80: what/why). When you set copy, list plain new values in the report (e.g. Title: …; Subtitle: …) — not JSON/YAML-only. Honor next_actions / warnings / side_effects.
3. Before editing an issue: update_issue claim with that issue id + report (why + plan, min 80). Read prior_attempts first if present. After fix: update_issue complete + report (what changed + plain copy values, min 80). If stuck: update_issue release + report (what you tried, min 80). Soft-complete only — does not push YAML or run diagnostics. Claims expire after 30 minutes; re-claim to refresh TTL may omit report.
4. If you lack edit caps, use propose_change then release the issue.

Tools: agent_session, get_entry_content, get_entry_fields, update_fields, update_issue, propose_change, list_proposals.

Don’t: call run_entry_diagnostics with confirm:true; start or poll a new diagnostics job; edit other contentType/slug/locale unless a tool next_action says so; locale fan-out unless next_action says so.
