---
name: website-mcp-conventions
description: >-
  Standing conventions for how an agent should talk to the human while using the
  Website MCP server to make changes to {{BRAND_TITLE}} (domain {{SITE_DOMAIN}}).
  This is a living list that grows as the human corrects or refines how they
  want these conversations to go. Always check these conventions before and
  after any Website MCP write (add_section, update_fields,
  replace_entry_sections, create_entry, publish_draft, promote_variant, delete_variant,
  translate_entry, etc.) — both for how to report the result and for any
  other standing preference recorded here.
---

# Website MCP — conversation conventions

This document is a running log of how the human wants agents to communicate
while doing CMS work through the Website MCP server for {{BRAND_TITLE}}. It starts
small and is meant to be edited in place as new conventions come up —
when the human corrects something or asks for a new habit, add it below
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

Whenever you tell the human you changed a page through the Website MCP,
give them the URL as a clickable markdown link — never just the slug or
the raw content path (e.g. not `scholarship/miami-tech-works`).

- Build the link from the page's public locale prefix + slug, e.g.
  `https://{{SITE_DOMAIN}}/en/scholarship/miami-tech-works`.
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

> Saved: [Miami Tech Works — How to apply](https://{{SITE_DOMAIN}}/en/scholarship/miami-tech-works?force_variant=draft#how-to-apply)

If the page were already live and you edited the live locale directly
(no `variant` param, `confirm_live_edit: true`), the link would omit
`?force_variant=draft` entirely.

### 2. Agentic roles: drafts free; live needs claim; publish via proposal

On an agentic swarm role connector (`/mcp/role/…`), write policy is enforced:

- **Draft / variant writes** (any locale): allowed with your edit caps — no issue claim required.
- **Live writes** (omit `variant`): allowed only while you hold an **active claim** on a validation issue for that **content type + slug + locale**. Successful live writes refresh the claim TTL (~30m).
- **Publish / promote / demote / create_entry**: denied — open an **edits** `propose_change` (field updates and/or `promote_on_apply`). Notes are reminders only (close with a reason; no YAML).
- **Stuck on a claimed issue:** `update_issue` **release** with a report (what you tried). Do **not** invent a proposal for that handoff — the issue stays in the open queue / can reopen for the next agent.

Staff unscoped `/mcp` is unchanged (no agentic gate).

When caps forbid a write (any connector), call `propose_change` (prefer **edits**) instead of pasting JSON in chat.

**Worked example:** missing `content_edit_text` on a blog CTA → `propose_change` with that entry’s `updates[]`, then tell the human a different editor must `update_proposal` with `action: "apply"`.

### 2b. Proposal collaboration (claim vs blocker vs approve)

Proposals are a shared work item, not a chat. Prefer one open proposal per draft variant (`proposal_exists` → join it).

- **Claim** only when you will edit the draft / soft updates. **add_blocker** to leave review feedback (what’s wrong, what fixed looks like, why — min 80 chars; no tool shopping lists). Do not claim only to approve.
- Only the **active claimant** may `resolve_blocker`. Do not resolve to overturn a disagreement — escalate or leave open; reviewers `reopen_blocker`.
- Open blockers block **apply** only (reject/withdraw still OK). Cleared blockers ≠ ship — re-preview, then four-eyes `apply`. For `promote_on_apply`, confirm ending experiments when asked (`confirm_end_experiment`).

**Worked example:** Blake adds a blocker on CTA product; Alex claims, fixes the draft, resolves with a note; Casey previews again then applies.

### 3. Cluster SEO only on live (or draft-before-live)

Do not write `seo.*` on A/B experiment variants, and do not write draft SEO once any live locale exists. Promote over live keeps live `seo:` — edit the live locale after promote if clustering must change.

**Worked example:** after promoting `variant: "b"`, call `update_fields` without `variant` to set `seo.pillar_path`, not another write on `b`.

### 4. Diagnostics `open_issues` is an open work queue

Treat `run_entry_diagnostics` / `get_diagnostics_job` `open_issues[]` as **actionable open work** (default), not a full validation dump. Soft-completed and other-author claims are excluded unless you pass `issue_status: "completed" | "claimed" | "all"`. Prefer one-slug sync (`freshness: "hard"`) before claim/edit; do not treat bulk/unscoped `open_issues[]` as live proof. Skip ids in `claimed_issues` / `completed_issues` (or `status !== "open"` and not `claimed_by_me`).

**Coding-agent-only issues:** Catalog codes with `coding_agent_only: true` are excluded from default `open_issues` and refuse `update_issue` claim (`action_required: issue_coding_agent_only`). They need a Cursor coding agent or staff (filesystem / content repo). Do not claim them. Visible under `issue_status: "all"` and staff Diagnostics.

**Worked example:** after edits, call `run_entry_diagnostics` with `slugs: [slug]`, `freshness: "hard"`, then claim from `open_issues[]` — not from a stale unscoped page.

### 5. Mutate reports: why + highlights (not process padding)

On field mutates and issue `complete`, pass `why` (goal/ticket in plain English) and `highlights` for big deltas (links added, section changes). Do not pad with “automatic MCP/bot” boilerplate. Server fills simple field values for staff; full diffs live on GitHub after push.

### 6. Claim only with a valid fix path — no invented keyword metrics

Claim an issue only when you already have a **valid fix path you can execute** with MCP (or a cited offline source). Do not invent facts (search volume, difficulty, rankings).

For `SEO_KEYWORD_RESEARCH_INCOMPLETE`:
- **OpenRush on:** call `refresh_keyword_metrics` (cache only). Do **not** write `seo.kw_monthly_volume` / `seo.kw_difficulty` YAML.
- **OpenRush off:** write both `kw_*` only with `seo_research_source: staff_provided` or `external:<tool_name>` from a real source.
- **No reliable source:** do not claim, or claim→`release` blocked — never guess numbers.

**Worked example:** OpenRush configured + keyword set without metrics → `refresh_keyword_metrics`, then revalidate — not `update_fields` with invented 1300/33.

### 7. Set `seo.refresh_tier` when clustering / topic nature is known

When enabling SEO clustering or classifying a page’s topic, set `seo.refresh_tier` to `fast`, `medium`, or `evergreen` (fact staleness — not traffic decay). Read `get_entry_fields` fill_intent or `explain_site` topic `seo` to pick. Cannot clear — change only by picking another tier. Revisit the tier when the page angle changes (e.g. concept explainer becomes a yearly “best of”). Per locale; translate does not copy.

**Worked example:** turning clustering on for a “best AI tools 2026” post → `update_fields` with `seo.refresh_tier: "fast"` (after reading fill_intent if unsure).
