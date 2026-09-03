---
name: 4geeks-mcp-conventions
description: >-
  Alejandro's conventions for how an agent should talk to him while using the
  4Geeks.com Website MCP server to make changes to 4geeks.com (and sibling
  sites). This is a living list that grows as he corrects or refines how he
  wants these conversations to go. Always check these conventions before and
  after any 4Geeks.com Website MCP write (add_section, update_fields,
  replace_entry_sections, create_entry, publish_draft, promote_variant, delete_variant,
  translate_entry, etc.) — both for how to report the result and for any
  other standing preference recorded here.
---

# 4Geeks.com Website MCP — conversation conventions

This document is a running log of how Alejandro wants agents to communicate
while doing CMS work through the 4Geeks.com Website MCP server. It starts
small and is meant to be edited in place as new conventions come up —
when Alejandro corrects something or asks for a new habit, add it below
as its own numbered convention rather than starting a new document.

For MCP **protocol** (sessions, reports, envelopes, multi-site), follow the
technical playbook from `bootstrap_agent` — this file is conversation
conventions only.

## How to update this file

- Add new conventions as new numbered entries under "Conventions." Keep
  each one short and concrete (a rule + a one-line example), not prose.
- If a new instruction changes or replaces an old one, edit that entry
  in place rather than leaving both — this file should always reflect
  current behavior, not a history of changes.
- Don't remove the worked examples when editing; update them so they
  stay accurate.
- Bump `CONVENTIONS_VERSION` in `mcp-server/lib/mcp-playbook.ts` when
  you change this file so agents re-fetch `skill.content` on bootstrap.

## Conventions

### 1. Always link to a page you modified, and flag drafts

Whenever you tell Alejandro you changed a page through the Website MCP,
give him the URL as a clickable markdown link — never just the slug or
the raw content path (e.g. not `scholarship/miami-tech-works`).

- Build the link from the page's public locale prefix + slug, e.g.
  `https://4geeks.com/en/scholarship/miami-tech-works`.
- **If the write was to a draft or non-live variant** (you passed a
  `variant` param, e.g. `variant: "draft"`, or the entry has no live
  locale yet), append `?force_variant=draft` (or the matching variant
  slug) as a query param so the link actually previews that variant
  instead of the live page — otherwise the link either 404s or shows
  stale live content.
- If the change was scoped to a specific section (e.g. via
  `section_id`), you can add the section's anchor too, e.g.
  `#how-to-apply`, after the variant query param.

**Worked example:** after editing the `how-to-apply` section on the
`miami-tech-works` scholarship draft (no live locale yet, written to
`variant: "draft"`), report it as:

> Ya se guardó: [Miami Tech Works — How to apply](https://4geeks.com/en/scholarship/miami-tech-works?force_variant=draft#how-to-apply)

If the page were already live and you edited the live locale directly
(no `variant` param, `confirm_live_edit: true`), the link would omit
`?force_variant=draft` entirely.

### 2. If you cannot write, propose — and link issues

When `update_fields` (or another mutate) is forbidden, call `propose_change` instead of pasting JSON in chat. If you cannot complete a validation issue, leave a proposal (`related_issue_ids`) with the edits or the steps you tried, then `update_issue` release.

**Worked example:** missing `content_edit_text` on a blog CTA → `propose_change` with that entry’s `updates[]`, then tell the human a different editor must `update_proposal` with `action: "apply"`.

