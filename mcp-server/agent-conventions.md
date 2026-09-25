---
name: website-mcp-conventions
description: >-
  Standing instructions for any agent using the Website MCP server for
  {{BRAND_TITLE}} ({{SITE_DOMAIN}}) from any MCP host. The server teaches
  through its responses; this skill is how to read them, when to stop and ask
  a person, how proposals work between roles, and how to report to the human.
  Apply it on every Website MCP call, and re-check it before and after every
  write (update_fields, add_section, replace_entry_sections, translate_entry,
  propose_change, update_proposal, publish_draft, promote_variant, etc.).
---

# Website MCP — agent conventions

The server already knows the rules. Every response says what happened, what did **not** happen, and what to call next. Your job is to read those payloads carefully and follow them. This skill covers only what a payload cannot do for you: how to read it, when to stop and ask a person, how roles work together through proposals, and how to talk to the human.

- **Protocol** (identity, session order, envelopes): `playbook` from `bootstrap_agent`.
- **Depth** (architecture, proposals, SEO, layouts): `explain_site` topics — open the topic a payload names.
- **Recent changes:** `entries[].agent_impact` from `bootstrap_agent`.
- **This skill vs a live payload:** if they disagree, trust the payload (it reflects the running code) and mention the mismatch to the human.

## 1. Start of run

1. Call `bootstrap_agent` once (pass `site` when several sites exist). On later calls pass `include_skill_content: false` or `known_skill_version`.
2. Know who you are: read `primary_blocker`, `role_description`, and `allowed_tools` (`bootstrap_agent` / `get_current_user`). Many hosts drop the server's role instructions — do not assume you saw them.
   - `role_connector_required` → no writes on this connection. Give the human `connector_guide.role_connectors`; stay read-only.
   - `mcp_write_disabled` → propose-only. Follow `mcp_write_guide.course_of_action`.
3. `agent_session` `start` with your exact `provider/model` (e.g. `claude/sonnet-4.5`). Pass `agent_session_id` on every write. `session_conflict` → `resume: true` if it is your run, else `force_new: true` + report.
4. Several sites → pass `site` (the domain the human named) on **every** call. Never assume the first site.
5. A tool you need is not in your list → do not imitate it with other tools. Tell the human: your role lacks it, or the connector must be refreshed/reconnected (tool lists never update mid-chat).

## 2. Reading a response

Structured fields first; `message` prose last.

| You see | It means | Do this |
|---|---|---|
| `action_required` | A gate — someone must decide | §3 |
| `success: false`, no `action_required` | Hard failure | Change the inputs (read `code`, `details`, `property_path`). Never resend the same call. |
| `next_actions` · `required` | Needed for correctness | Do it before telling the human you are done |
| `next_actions` · `recommended` | Normal next step | Do it, or say why you skipped |
| `next_actions` · `optional` | Judgment | Your call |
| `warnings[]` | What did **not** / will not happen | Read every `code`; relay the ones that change what the human believes (§5b) |
| `side_effects[]` | What else changed (files, bound sections, other pages, drafts) | Relay wide blast radius |
| `discovery_path` | Optional research before a big step | `think` items first; `available: false` → ask a human for access. Never a gate; skipping is allowed |

- Only call tools a payload names or your tool list contains. Never invent tools, args, topics, or subtopics.
- `args_hint` is a starting point: fill real values; never send placeholders (`provider/model`, `…`).
- Lists return summaries on purpose. Fetch detail (`proposal_id`, `slugs`, `fields`) only for what you will act on; page instead of dumping.
- After a write, finish its `required` follow-ups (e.g. one-slug `run_entry_diagnostics` with `freshness: "hard"` after go-live).

## 3. Gates: who may say yes

A gate is the server asking for a decision. Passing a `confirm_*` flag is you answering it — answer only what you are entitled to answer.

- **You may confirm** when the human already asked for exactly this in the chat (they asked you to edit the live page → `confirm_live_edit: true`). Unsure → write a draft `variant` instead.
- **Ask the human (or your orchestrator / reviewer) first**, showing the payload facts:
  - new taxonomy values — categories, URL params, tags (`confirm_new_values`; show `observed_values`)
  - overwriting newer work (`confirm_overwrite_newer_live`, `confirm_source_changed`, `confirm_base_unknown`; show `conflicting_fields` / `live_changes_since_base`)
  - deleting, or changing many pages at once (`confirm_delete`, `confirm_affected_entries`, `confirm_template_*`; show the count)
  - ending an experiment (`confirm_end_experiment`), rejecting a proposal (`confirm_reject`), spending research budget past a warning (`confirm_seo_research_budget`)
- **Never confirm a gate you do not understand.** Open the `explain_site` topic from `next_actions` first.
- **Stop and tell the human** (no workaround): `escalated`, `issue_coding_agent_only`, `proposal_deleted`, `withdraw_disabled`, `role_connector_required`, `mcp_write_disabled`.

## 4. Never invent

Do not make up anything the site will publish or rely on: keyword volume/difficulty, rankings, prices, dates, product facts, testimonials, CRM tags, conversion events, image URLs. Use the MCP (catalogs in `explain_site`, `get_or_refresh_seo_research`, `list_media`, `get_product`), a source the human gave you, or ask. No reliable source → leave it out and say so.

## 5. Talking to the human

### 5a. Link every page you changed

Clickable link, never just a slug or file path.

- Use the path from `urls[locale]` on `get_entry_content` / `list_entries` and prefix `https://{{SITE_DOMAIN}}`. URL patterns differ per content type — do not build paths by hand.
- Draft / non-live variant → append `?force_variant=<variant>` so the link previews it. Section edit → add `#section_id` after it.

**Worked example:** after editing the `how-to-apply` section on the `miami-tech-works` scholarship draft:

> Saved: [Miami Tech Works — How to apply](https://{{SITE_DOMAIN}}/en/scholarship/miami-tech-works?force_variant=draft#how-to-apply)

A live edit (no `variant`) omits `?force_variant=`.

### 5b. Say what did not happen

When a warning changes the picture, say it plainly: "saved as a draft — not live yet", "this field changes every language", "Spanish was not updated", "waiting for another role to apply". Explain codes; do not just quote them.

### 5c. Reports: why + highlights

Writes and issue `complete`: `why` (goal in plain English) + `highlights` for big changes (links added, sections changed). Claim / note / summarize: `report` (min 80). Plain values, no JSON/YAML dumps, no "automated MCP" filler. One `agent_session` `summarize` at the end.

### 5d. Do not leave work in chat

Blocked by permissions → `propose_change`, not JSON pasted in chat. Out-of-scope defects you notice → a notes proposal (§7d adjacent findings), not only a chat mention.

## 6. Write policy

Everybody can use proposals. **Agent (swarm) roles are forced to** — they never publish or edit live on their own:

- Drafts / variants: free with your edit permissions.
- Live: only while you hold an active **issue** claim for the same content type + slug + locale (same human + role). Live writes refresh it (~30 min). Stuck → `update_issue` `release` with what you tried (not a notes proposal).
- Publish / promote / demote / `create_entry`: never directly → an **edits** proposal (`promote_on_apply` to go live). Brief before work exists → `kind: "idea"`.

**Human-assigned roles** (e.g. Platform Steward, custom roles) may write directly within their permissions when MCP write is on, and may also propose. MCP write off → propose-only for anyone.

An **issue claim** (unlocks agent live writes on that page) and a **proposal claim** ("I am working this proposal") are different things.

## 7. Proposals — how roles work together

A proposal is how work passes between roles: one role proposes, a **different** role decides. Staff act in the Proposals UI (take over claims, escalate, review outcomes). Every open proposal carries a server-built review layer — `review_context` — that says what kind of risk it is and what to check. Read it; never review from the summary alone.

### 7a. Seats

| Seat | Agent roles | `update_proposal` actions |
|---|---|---|
| Author | Swarm Orchestrator, Copy Editor, SEO Specialist, Layout Editor, Translator, Media Editor | `propose_change`; claim, release, withdraw, attach_variant, revise_entries, set_review_situations, set_no_auto_retry, revert |
| Reviewer | Proposal Reviewer | claim, release, apply, reject, accept, close, blockers — cannot create, withdraw, or edit pages |
| Both | Publisher | everything |

- **Four-eyes:** apply / reject / accept need a different username + role than the proposer **and** any co-author (editing someone's proposal draft makes you a co-author). Close is not four-eyes. A different model under the same role is not a different person.
- An action refused for your caps is a seat problem, not something to retry — hand off to the right seat.
- `escalated: true` → a steward paused it. Do not call `update_proposal`; read `escalated_note`.

### 7b. Three kinds

| Kind | Filed with | What happens |
|---|---|---|
| `edits` | `entries[]` and/or `promote_on_apply` | Writes a 0%-traffic draft **now**; apply only promotes it. Live is unchanged until apply. |
| `idea` | `kind: "idea"` | A brief. Accept reserves a page + locale; writes no YAML. |
| `notes` | neither | Visible backlog / handoff. Close with a reason; writes no YAML. Never for new-page pitches (use `idea`). |

### 7c. As an author

1. **Look before filing.** `list_proposals` (`query`, `issue_id`) for open work on the same page. `proposal_exists`, `competing_entry_edits`, `join_existing_*` → join it (`revise_entries`), do not duplicate. Recent writes on the page → `get_entry_activity`; pass `confirm_recent_activity` only if your change is clearly distinct.
2. **One risk per proposal.** Do not mix outcome figures, new pages, and other edits (`mixed_risk_bundle`). Keep SERP title/description separate from body edits (`mixed_serp_and_body`).
3. **Declare `review_situations`** so reviewers get the right checklist: `internal_links`, `serp_title_description`, `funnel_classification`, `body_copy_edit`, `selling_figures`, `new_public_content`, `promote_draft`, `locale_translation`. `situation_ops_mismatch` → retag with `set_review_situations`. Catalog: `explain_site` `topic: "proposals"` `subtopic: "situations"`.
4. **Summary** (min 80) = intent + why. Never paste values — ops carry them. Go-live with no updates: why this draft should go live. Optional `rationale` = deeper reasoning; `situation_note` = what live looks like now.
5. **After filing:** read `side_effects.drafts_written`; give the human the draft preview link (§5a). Page-level fields (`funnel.*`, `meta.robots`, `authors`, …) change every language — say so.
6. **Follow your attention bucket** (`list_proposals` with `proposer_username` / `agent_session_id`):
   - `blocked` → fix with `revise_entries` (idle or self-claimed only), then the active claimant `resolve_blocker`s. Revise does not clear blockers; never resolve to win a disagreement.
   - `needs_author` / `context_stale` → live moved under your draft; `revise_entries`.
   - Undo something already applied → `revert` (files a new proposal; four-eyes).
7. **New pages and new languages:** no `create_entry`, no `variant` — the proposal creates the folder and draft. What the edits must contain → §7g.

### 7d. As a reviewer

Open `list_proposals(proposal_id)` before any decision — list rows are summaries without ops. Read `review_context` in this order:

1. **Can it be decided at all:** `block_apply`, and warnings like `target_missing`, `situation_changed`, `recent_entry_writes`, `layout_owner_changed`.
2. **Risk:** `damage_class` — what public impact: `none` → `existing_metadata` → `existing_content` → `selling_page` (adds or changes hire rates, salaries, tuition, or prices on **any** page) → `new_public_content`. `undo_cost` + `undo_cost_reason` — how hard apply is to reverse (high: shared template, first publish of a language, page-level fields, sections).
3. **What to check:** `active_checklists` — score every checklist that fired. Playbooks: `explain_site` `topic: "proposals"` (`subtopic: "reading"` lists every checklist and its playbook).
4. **Optional research:** `agent_preview.think_items` → `discovery_path`. When `get_entry_activity` is listed first, check it before apply.
5. **The actual change:** `author_diff`, `sections_summary`, `merge_preview`, `affected_entries`. `update_proposal` with `dry_run: true` shows the apply result without writing.

Your job is to stop harm — invented claims, lost query fit, false scope, unjustified new URLs, wrong layout — not to rewrite for punchier copy. Pick one lane:

| Lane | When | Effect |
|---|---|---|
| `add_blocker` | The proposed change is wrong, invents a claim, or the summary's scope is false. Say what is wrong, what fixed looks like, why (min 80). No tool shopping lists | Blocks apply |
| notes (adjacent findings) | A live defect the ops do not touch, or a problem on another page. Name the page; link an issue only if one exists; join existing notes. Nothing to park → no empty notes | Does not block |
| `reject` | Must never ship: bad, not implementable, illegal/policy, harmful, weaker duplicate, target missing. `confirm_reject` + `reject_kind` + `close_note` (min 80). Not for polish | Closes it |
| `apply` | Every fired checklist passes | Four-eyes; confirm gates per §3 |

- One failing checklist does not sink the rest: blocker on those ops; the author drops or fixes them; apply is all-at-once.
- Cleared blockers ≠ approved — re-read, then apply.
- Queue: default `sort=attention` ranks for your seat (reviewer: `escalated` → `awaiting_rereview` → `no_feedback` → `blocked`). `needs_review: true` = edits waiting for a reviewer.
- No `proposals_create` (Proposal Reviewer): hand park items to a role that has it; never turn them into blockers.

### 7e. Ideas

- Always scored opportunity vs harm: **Goal → Evidence → Fit → Brand → dilution**. Authors put goal, evidence, and a kill line in `summary` / `rationale`. Incomplete brief → `add_blocker`; wrong vehicle → close and refile as edits.
- At most one demand label: `anticipated_demand` (lasting queries after a launch), `existing_demand` (compete for current search), `fast_decay_news` (announcement only — expect reject), `broken_url` (call `get_runtime_issues` first; only if you have it).
- New-URL ideas need `idea_funnel` `{ stage, products }` before accept.
- **Accept** (four-eyes): `accepted_entry` `{ contentType, slug, locale }` + `next_step` (min 20). Reserves that page; writes nothing. `accepted_entry_needs_layout` → follow-up must send full `sections`; `accepted_entry_not_creatable` → a human creates the database row first.
- **Follow-through:** edits with `implements_proposal_id` (one open at a time). Pick up stalled ideas with `list_proposals({ stalled: true })`.
- **Close** parks (`wont_fix`, `tracked_elsewhere`, `other`) — never use close for "yes".

**Worked example (new attached blog post, `layout_owner: shared_template`):**

1. Author: `propose_change` with `kind: "idea"` and `related_entries: [{ contentType: "blog", slug: "what-is-grok", locale: "en" }]`.
2. A different role: `update_proposal` `action: "accept"` with the same `accepted_entry` and a `next_step`. No YAML yet.
3. Author: `propose_change` with `implements_proposal_id`, `review_situations: ["new_public_content"]`, and field `updates[]` only (title, description, body/`content`, category) — **no** `variant`. The proposal writes `{slug}/_common.yml` and the unpublished draft now.
4. A different role: `update_proposal` `action: "apply"`. A new category also needs `confirm_new_values: true` after the human approves.

### 7f. Translations

`translate_entry` always writes a non-public variant (default `draft`) — never live. Polish there with write tools, then `propose_change` with `variant`, `promote_on_apply: true`, `review_situations: ["locale_translation"]`. Summary: intent + "Translated from {src} → {tgt}" (no pasted body). Reviewers score fidelity to the source, not punchier copy. Playbook: `explain_site` `topic: "proposals"` `subtopic: "translations"`.

### 7g. Layout owner: what a draft contains

`layout_owner` is on `get_entry_content`, proposal entries, `review_context.entries[]`, and section errors. `get_content_type_info` / `list_entries` show only the type default (a detached entry reports `entry`). `layout_owner` wins over `body_model`.

| `layout_owner` | Examples | Draft contains | New language | Apply writes |
|---|---|---|---|---|
| `shared_template` | attached blog post, attached database-backed entry | fields only (sections → `attached_sections_refused`) | field edits only | `{locale}.yml` fields with `sections: []` (or field overrides for database-backed); template untouched |
| `entry` | landing, downloadable, program page, any detached entry | fields + the full layout: one `{ field_path: "sections", value: [...] }`, or `sections[i].x` on an existing locale | full translated `sections` (else `sections_required`, `details.new_locale`) | the whole page |
| `is_shared_template: true` | slug `template` of a shared-layout type | the shared layout itself | full `sections` | `template.{locale}.yml` → every attached entry in that language (`confirm_affected_entries: N`); detached entries unaffected |

Every full `sections` array is shape-checked against the component registry (`invalid_sections` + `property_path`) — read `get_component_schema` first. Images, links, and product scope are still on you. Publishing an empty `entry` page fails with `empty_page`. Database-backed types cannot be created by proposal (a human creates the row). Recipes (new section-built page, change every entry's layout): `explain_site` `topic: "proposals"` `subtopic: "overview"`.

## 8. Diagnostics and issues

- `open_issues[]` from `run_entry_diagnostics` / `get_diagnostics_job` is the open work queue, not a full validation dump. Claim from a fresh one-slug run (`slugs: [slug]`, `freshness: "hard"` → poll `get_diagnostics_job`), never from a stale bulk page.
- Skip ids in `claimed_issues` / `completed_issues` (or `status !== "open"` and not `claimed_by_me`).
- Follow each issue's `suggestion`, `help`, `next_actions`, and `staff_context` (notes from staff). `coding_agent_only: true` → never claim; it needs a coding agent or staff.
- Claim only with a fix path you can execute via MCP or a cited source. No path → do not claim, or `release` with why.

## 9. SEO habits

- Cluster `seo.*` only on live (or a draft before any live locale exists). Never on A/B variants; after promote, edit live (promote keeps live `seo:`).
- Keyword metrics: research on → `get_or_refresh_seo_research` `action: keyword_metrics`; never write `seo.kw_monthly_volume` / `seo.kw_difficulty`. Research off → write both only with `seo_research_source: staff_provided` or `external:<tool_name>`. No source → do not claim `SEO_KEYWORD_RESEARCH_INCOMPLETE`.
- Measured clicks = `get_organic_traffic`. Planning = `get_or_refresh_seo_research` (`keyword_metrics` | `serp` | `keyword_ideas` | `competitors` | `keyword_gaps` — gaps needs `competitors` first). Cache-first, with session and daily budgets.
- Set `seo.refresh_tier` (`fast` | `medium` | `evergreen` = how fast the facts go stale, not traffic) when clustering or classifying a page; revisit when the angle changes (explainer → yearly "best of" is `fast`). Per locale; translate does not copy it; cannot be cleared. Unsure → `get_entry_fields` `fields: ["seo.refresh_tier"]` for `fill_intent`.

## 10. Reader copy must not expose SEO topology

Clusters, pillars, spokes, piece counts ("third in our X cluster"), and companion-piece maps are staff packaging. Keep them out of reader-facing body and headings; link by page job instead. YAML `seo.*` and proposal summaries may still say "cluster hub". Teaching what a topic cluster is, when that *is* the article topic, is fine.

- **Bad:** "This is the third piece in our Grok Bot cluster. For the full picture, start with…"
- **Good:** "New here? Read [what Grok Bot is](…) or [how to set it up](…). This page is only what's new since launch."

Reviewers treat this as `add_blocker` on body, new-page, link, and translation proposals — not reject for voice alone.
