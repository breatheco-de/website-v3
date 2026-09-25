# Content proposals

Agents and staff can **propose** entry field changes or **idea** briefs when they have **`proposals_create`**. Live YAML does not change until a **different agent role** with **`proposals_review`** (Proposal Reviewer or Publisher) — or staff UI — **applies** edits. Notes handoffs stay open as reminders; **close** finishes them with a reason (no content change). Ideas use **accept** to greenlight a brief (still no YAML).

**Identity:** Mutating MCP requires a **role connector** (`/mcp/role/…`), `agent_session` start with exact `model` (`provider/model`), and `agent_session_id` on every mutate. Four-eyes and claims compare **username + role** (staff UI is separate). Exact model is stored for observability.

**MCP write overlay:** When `mcp_write_enabled` is false (default if unset), the catalog keeps view caps + `proposals_create` only — use `propose_change` and the author `update_proposal` toolkit. Direct draft/live tools and `proposals_review` (apply/reject/accept) are stripped; a write-enabled reviewer over MCP or staff Proposals UI must apply. Check `get_current_user`.

Agentic swarm role connectors may write **drafts** freely, may write **live** only with an active same-locale issue claim (same human+role), and must use proposals (not MCP promote/create) to go live — see agent-conventions §6. Human-assigned roles may write directly within their caps (MCP write on) and may also propose.

## Tools (exactly 4)

| Tool | Caps | Job |
|---|---|---|
| `propose_change` | `proposals_create` | Create. `entries[]` → edits; `kind:"idea"` → idea brief; omit → notes. Optional `related_entries` (idea context; slug need not exist). Notes default `no_auto_retry`. Soft-blocks on recent entry writes. |
| `list_proposals` | `content_view` \| `proposals_create` \| `proposals_review` | **Stats-first** (`by_attention`, **`by_kind_status`**, `stalled_ideas`, `needs_review_edits`). Filter with `query` / `issue_id` / `status` / `kind` / `proposer_username` / `proposer_actor` / `agent_session_id` / `escalated` / `outcome_review` / `attention` / `stalled` / `needs_review` → **summary** rows (`entry_count`, `field_paths`, `attention`, blocker counts; no ops/values). Scoped default **`sort=attention`** (role-aware) + open\|partial when status omitted (unless stalled); pass `sort: updated_at` for chronology. `needs_review: true` → open\|partial edits in awaiting_rereview or no_feedback. Opt-in **`kpi_history`** (+ `kpi_granularity` / `kpi_from` / `kpi_to`) → per-bucket **flow** series (each bucket restarts at 0; `open` = created, finished/rejected = closed in bucket; hour / day ×28 / Monday-week ×12, plus the in-progress bucket marked `partial: true`). `proposal_id` → **full** detail; open\|partial also returns live `review_context` + `discovery_path`. |

**KPI strip ↔ `list_proposals`:** Unscoped calls return **live** Ideas/Edits/Notes × Open/Done/Rej via `proposal_stats.by_kind_status` (same as the staff strip big numbers; open includes partial; withdrawn omitted; empty site → all nine buckets as `0`). Sparkline history is **opt-in only** (`kpi_history: true`) — never attached by default. It is flow per period (trend), not the pile — the big numbers come from `by_kind_status`, not the last spark point. Event Webhooks are **not** proposal stats and never appear on this tool. Filtered (scoped) calls still return **site-wide** `by_kind_status` (warning `proposal_stats_site_wide`); do not treat those counts as the size of the filtered page.

See also **`explain_site` `topic: "proposals"` `subtopic: "reading"`**: damage/undo axes, checklist IDs, create refuses, apply block when target missing.

**Review situations:** optional `review_situations` on **edits** — hub `topic: "proposals"` with subtopics **`situations`**, **`internal-links`**, **`serp-title-description`**, **`funnel-classification`**, **`translations`**. Empty → infer from ops. Ideas always get default-on **`idea_opportunity_harm`** (`subtopic: "idea-opportunity-harm"`) and may declare **one** demand label: **`anticipated_demand`**, **`existing_demand`** (`subtopic: "existing-demand"`), **`fast_decay_news`**, or **`broken_url`** (`subtopic: "broken-url"`). Authors who file `broken_url` must call `get_runtime_issues` first. **New-URL ideas** also need structured **`idea_funnel`** `{ stage, products }` before accept (`set_idea_funnel`; `"all"` only with awareness).

| `update_proposal` | `proposals_create` and/or `proposals_review` (actions filtered) | See action allowlists below. |
| `get_entry_activity` | same as list | Read recent writes (14 days). Use before `confirm_recent_activity`. |

Do not invent `get_proposal`, `apply_proposal`, etc.

## Swarm decide seats

| Role | Create | Decide (apply/reject/accept/close/blockers) |
|---|---|---|
| Specialists + Orchestrator | yes (`proposals_create`) | no — author toolkit only (claim/release/withdraw/attach/set_no_auto_retry) |
| **Proposal Reviewer** | no | yes — review toolkit (no withdraw/attach/set_no_auto_retry) |
| **Publisher** | yes | yes — full toolkit |

Approve (apply) may change **live or draft** content that was already proposed. Reviewer cannot free-edit pages or create proposals.

## `update_proposal` action allowlists

| Caps | Allowed | Denied |
|---|---|---|
| `proposals_review` only | claim, release, apply, reject, accept, close, acknowledge, blockers | withdraw, attach_variant, set_no_auto_retry, revise_entries, set_review_situations, revert |
| `proposals_create` only | claim, release, withdraw, attach_variant, set_no_auto_retry, revise_entries, set_review_situations, revert | apply, reject, accept, close, blockers |
| both | full set | — |

## Kinds

| Kind | When | Primary disposition |
|---|---|---|
| `edits` | `entries[]` or `promote_on_apply` | Four-eyes **apply** / **reject** |
| `notes` | No entries, default | **close** with reason (wall handoff) |
| `idea` | `kind:"idea"`, no entries | **accept** (`next_step` + `accepted_entry`) or **close** park |

Do **not** use notes for new-spoke / config pitches — use `kind:"idea"`.

### Summary by kind

| Kind | `summary` job (min 80) |
|---|---|
| `edits` | **Intent + why** only. Do **not** paste proposed field values — those live in `updates[]` / ops. List triage uses title + `field_paths`. Go-live with empty updates: say **why this draft should become live** (preview owns exact copy). |
| `notes` | Handoff payload: steps tried + recommended next. |
| `idea` | Brief: pitch + desired outcome. |

**Field roles:** `summary` = above; optional `rationale` = deeper reasoning (still no value dumps); optional `situation_note` = current live picture, not proposed values.

After **`revise_entries`**, trust Proposed changes / ops over an older summary if scope drifted — revise does not rewrite summary.

## Ideas

- **Live review:** default-on situation `idea_opportunity_harm` + checklist `idea_opportunity_harm` (Goal → Evidence → Fit → Brand → dilution) stacked with `idea_accept` (lock/`next_step`). Optional demand label stacks `anticipated_demand` | `existing_demand` | `fast_decay_news` | `broken_url` (Evidence follows the label). Playbooks: `subtopic: "idea-opportunity-harm"` / `"existing-demand"` / `"broken-url"`. Incomplete brief → `add_blocker`; wrong vehicle → close/refile edits. Discovery tools optional.
- **accept:** four-eyes (human+role); open blockers block; `next_step` min 20; **`accepted_entry`** `{ contentType, slug, locale }` required (locks that page+locale); → `finished` + `accepted`. **No YAML.** Refuse if another accepted idea already holds that entry (`accepted_entry_taken`).
- **close** park: `wont_fix` \| `tracked_elsewhere` \| `other` (not four-eyes). Do not use close for “yes.”
- Optional `related_entries`: context only; targets may not exist yet (prefills accept UI when present).
- **Follow-up edits:** pass `implements_proposal_id` to the accepted idea. Required when creating edits for a reserved entry. At most one **open/partial** implements child (`idea_already_in_progress`). Entry must match `accepted_entry`. Brand / selling-figure ship gates run on that edits proposal (`new_content_brand` / `selling_page_figures`), not on the idea.
- **Stalled:** accepted idea with a locked entry and **no** implements child in `open`/`partial`/`finished`. Rejected/withdrawn children resurface stalled. List with `stalled: true`; stats include `stalled_ideas`. Legacy accepts without `accepted_entry` are not stalled.

## Recent activity gate

- Edits create/apply: recent writes → `confirm_recent_activity` after `get_entry_activity`.
- On open review, `list_proposals(proposal_id)` may elevate `get_entry_activity` and warn `recent_entry_writes` when SERP ops or gate-filtered writes exist — see **`explain` topic `reading-proposals`**.
- Confirming does **not** write YAML or complete validation issues. Same-field SERP churn + live not broken → reject (title/description-only) or revise to drop SERP ops (mixed) instead of confirming.

## Proposals 1.0 — the draft is the source of truth (edits)

New edits proposals carry `system_version: "1.0"`. Legacy rows (`system_version` null) are read-only: anything except withdraw / reject / release / outcome review returns **`legacy_version`** → re-file (open legacy edits were closed with `close_reason: legacy_version`; accepted legacy ideas stay implementable).

- **Create / `revise_entries`:** `updates[]` are written into a 0%-traffic draft **now**. Named `variant` = use that draft (must be 0% traffic → else `variant_has_traffic`; not owned by another open proposal → else `draft_in_proposal`, with `env` when it lives in another environment). No variant → the proposal creates `draft` (or `draft-p{id6}` when taken) from today's live, or `{}` for an unpublished locale / accepted-idea new entry (also creates `{slug}/_common.yml`). Drafts carry `_draft.proposal { id, env, created_by_proposal, created_fingerprint }`. Any failure rolls back every draft touched. `revise_entries` restarts drafts this proposal created from today's live, then writes.
- **Field scope:** page-level (`common`) fields — `funnel.*`, `meta.robots`, `meta.priority`, `meta.change_frequency`, `published_at`, `detached`, `authors` — publish to `{slug}/_common.yml` for **every locale** (warning `common_fields_all_languages`). Only one open proposal per page may stage them (`competing_shared_fields` → join it with `revise_entries`). Remove a field with `{ field_path, op: "remove" }` (or `value: null`): the draft stores `null` until publish (warning `common_field_removal_staged`). `meta_target` is ignored with a warning. Attached posts take field updates only (`attached_draft_structure`).
- **Reading:** `ops` / `baseline_context` / `author_diff[]` (`field_path`, `before`, `after`, `scope`, `removed`, `source` for translations) are derived from the draft vs its recorded base. `author_diff_approximate: true` = no base copy (diff vs today's live; may include others' live edits). `requested_ops` + `ops_match_request: false` = the draft now differs from what the author sent. Per entry: `base_status` ok|stale|unknown, `merge_preview` (rebuild → `author_fields` + `live_changes_since_base`; or `conflict` / `has_sections` / `no_base_copy`), `source_changed`, `draft_missing`. Each entry carries `layout_owner` (+ `detached` / `is_shared_template`; `layout_owner_at_filing` in review lookups) — what the draft should contain is the conventions §7g table. `sections` counts as one field in `author_diff`; `sections_summary { before_count, after_count, rows[{ index, type, status: added|removed|changed|moved, changed_keys?, from_index? }], truncated? }` says which sections changed (max 30 rows, 8 keys). Template proposals add `affected_entries { count, sample }`.
- **Template proposals** (change every attached entry's layout): one entry per locale on slug `template` (file `template.{locale}.yml`, `is_shared_template: true`), `all_or_nothing: true`; apply needs `confirm_affected_entries: N` (attached pages in that locale). Detached entries are never changed. Covering only some live template languages warns `template_locales_incomplete`; apply `dry_run` and apply warn `template_placeholders_unfilled` (new `{{ entry.* }}` placeholders some attached entries cannot fill; never blocks). Playbook: topic `shared-layout`.
- **Apply = promote only** (fingerprint-checked). Stale draft with non-overlapping fields → rebuilt on today's live (warning `draft_rebuilt`); overlap / sections / no base copy → **`context_stale`** with `conflicting_fields` (nothing published; proposal → attention `needs_author`). Translation source changed → `context_stale` (`reason: source_changed`). Draft gone → `draft_missing`. No recorded base (pre-1.0 draft) → **`draft_base_unknown`** → retry with `confirm_base_unknown: true` after `dry_run`. Template → **`confirm_affected_entries: N`** (N = attached pages in that locale). `dry_run: true` returns `merge_preview` and writes nothing. `all_or_nothing` (create / revise) checks every entry first → `all_or_nothing_blocked` with the pending list; a write failing mid-way leaves `partial` (no auto-undo).
- **Co-authors:** anyone who edits a proposal's draft outside the proposal is recorded in `co_authors` and cannot apply it (`four_eyes_co_author`). Live writes that make an open proposal stale return warning `open_proposal_will_go_stale` with ids.
- **Revert** (`update_proposal action: "revert"`, finished|partial 1.0 edits): files a **new** proposal with `reverts_proposal_id` that puts back each done entry's pre-apply values (fields that did not exist are removed). Live unchanged until that proposal is approved (four-eyes). Fields changed again since apply → `revert_conflicts` + `conflicting_fields` (nothing created). Folder restore is not the undo path.
- **Reject / withdraw / close / abandon:** drafts the proposal created (fingerprint unchanged) are deleted; drafts that existed before (or were edited by others) are kept and unlinked.
- **Stale lifecycle:** `stale_since` set when live or the source moves under the draft; cleared by revise/rebuild. Daily sweep: 30 idle days → `stale_flagged_at` (+ event `proposal_stale_flagged`); 90 → withdrawn with `close_reason: abandoned_stale`. Daily link check: a draft whose proposal is closed / missing in its env is unlinked after 7 days (deleted only if created by the proposal and unchanged); remote env unreachable → `unverified_since`, never cleaned.
- **Undo cost (risk):** `undo_cost` + `undo_cost_reason` from `author_diff` — high: shared template, first publish of a locale, any `common` field (incl. removal), `sections`; medium: `seo.*` / meta / URL params / slug; low: locale text/image fields.

## Worked examples

**New section-built page (`layout_owner: entry` — downloadable, landing, program page):**

1. Author: `propose_change` with `kind: "idea"` and `related_entries: [{ contentType: "downloadable", slug: "ai-engineering-interview-kit", locale: "en" }]`.
2. A different role: `update_proposal` `action: "accept"` with that `accepted_entry` + `next_step` → warning `accepted_entry_needs_layout` (the follow-up must carry the whole layout).
3. Author: `propose_change` with `implements_proposal_id`, `review_situations: ["new_public_content"]`, no `variant`, and the whole layout as one update — `entries[0]`: `{ contentType: "downloadable", slug: "ai-engineering-interview-kit", locale: "en", updates: [{ field_path: "meta.page_title", value: "…" }, { field_path: "sections", value: [{ type: "hero", version: "1.0", … }] }] }`. Read shapes with `get_component_schema` first (`invalid_sections` otherwise). The proposal creates `{slug}/_common.yml` + the draft.
4. A different role: `update_proposal` `action: "apply"` (publishing with no sections fails `empty_page`).

**Change the layout of every attached entry of a type:** target slug `template`, one entry per live template language, `all_or_nothing: true`; apply with `confirm_affected_entries` (the count per locale). Detached entries need their own edits (or a reattach). A type without a shared layout has no template — edit each entry separately.

**Blocker round-trip:** Reviewer adds a blocker on the CTA product ("wrong product for this persona; should point to the full-stack program; the page is a decision-stage page"). Author runs `revise_entries` to fix the draft, then (as active claimant) `resolve_blocker` with a note. A different role re-reads `list_proposals(proposal_id)` and applies.

## Notes / no_auto_retry

- New notes: `no_auto_retry: true`. Duplicate notes on same issue blocked until claim + clear flag or close.
- MCP must **claim** before `set_no_auto_retry`. Staff UI may flip without claim.

## Close (notes)

- `close` / `acknowledge`: `wont_fix` \| `fixed_elsewhere` \| `tracked_elsewhere` \| `other`.
- Finishes without YAML; not four-eyes.

## Collaboration

- **One open proposal per variant** → `proposal_exists`.
- **Claim** = working it (human+role; staff UI may take over). **add_blocker** = feedback for polish.
- **Reject** = rare terminal: bad / not implementable / illegal-or-policy / harmful / duplicate weaker / target missing. Requires `confirm_reject`, `reject_kind`, and `close_note` (min 80). Do **not** reject for polish.
- **revise_entries** (authors): replace pending/failed entries (1.0: rewrites the draft); idle or self-claim only; foreign claim blocks; open blockers stay open until `resolve_blocker`. Clears `stale_since`.
- **Open blockers block apply and idea accept** — reject/withdraw/close still work.
- **Escalated:** steward UI hold (`escalated: true` + note). Status stays open|partial. MCP `update_proposal` fails (`code: escalated`) until release. Not an MCP action. Sibling create may warn `escalated_sibling`.
- **Outcome review:** steward-only UI retro on closed proposals (finished|rejected|withdrawn): `outcome_review` good|bad, `outcome_review_note` (what went wrong), `outcome_review_expected` (what should have happened), `outcome_lesson_captured_*`. Read-only for agents — not an MCP action, no warnings, does not affect other proposals. Filter `list_proposals` with `outcome_review: good|bad|none|bad_open`.
- Cleared blockers ≠ approved — re-preview then four-eyes apply/accept.
- Optional `supersedes_proposal_id` on `propose_change` links a replacement to a rejected/withdrawn predecessor (`replaced_by` on the old). Never required.
- **Withdraw:** site Rules (`proposals.withdraw.mcp`): `proposer_only` (default), `any_create_author`, or `disabled` (`withdraw_disabled` — ask staff). `close_note` min 20. Staff UI follows separate staff setting.

## Rules

- **Four-eyes:** apply / reject / accept when caller identity (username+role or UI) ≠ proposer identity — unless site Rules turn four-eyes off (or staff UI exempt). **Close/park is not four-eyes.**
- **Site Rules:** stewards configure withdraw / four-eyes / holds at Agents → Rules; changes apply to the next action only.
- **Non-effects:** no GitHub push; no auto-complete issues; accept does not create YAML. Create/revise write only 0% drafts (never live).

## Create refuses + review context

- **Refuse create:** `entry_not_found` (missing write target that is not a reserved slug, or a type that cannot be created from a proposal), `database_entry_required` (cannot create a database row), `required_fields_missing`, `attached_sections_refused` / `attached_draft_structure`, `sections_required` / `page_create_no_draft` (new `layout_owner: entry` page without full `sections`, or with a variant; `sections_required` + `details.new_locale` for a new language of an entry page, a detached entry, or a new template language), `invalid_sections` (any full `sections` array failing the component registry; `property_path` + `issues`), `mixed_risk_bundle` (mixed selling/new-public/other in one edits or idea related set), `competing_entry_edits` (second open edits on same type+slug+locale), `competing_shared_fields`, `draft_in_proposal`, `variant_has_traffic`, `implements_required` / `idea_already_in_progress` / `implements_entry_mismatch` (accepted-idea follow-through).
- **Allowed shapes:** live missing but named draft exists → `new_public_content`. Slug locked by an accepted idea, no variant → the proposal creates `{slug}/_common.yml` + the draft (`new_public_content`); apply publishes `{locale}.yml`. `layout_owner: shared_template` (attached posts): field updates only, `template.{locale}.yml` never changes. `layout_owner: entry` (downloadable, landing, detached, …): must include one full `{ field_path: "sections", value: [...] }` (accept warns `accepted_entry_needs_layout`). Database types: accept succeeds with warning `accepted_entry_not_creatable`; a human creates the page.
- **Per locale:** a new language on an existing page folder is a normal edit (no idea needed).
- **Apply block:** `target_missing` when the page was deleted after filing — reject/withdraw/close still work. `empty_page` when a section-built page would publish with no sections. New URL-param values on a new-entry apply need `confirm_new_values: true`.
- Live `review_context` on `list_proposals(proposal_id)` for open|partial; snapshot on list rows is a filed hint only.
- Multi-row list is **summary only** (`proposals_view: "summary"`, warning `proposals_summary_only`): use `attention`, `entry_count`, `field_paths` to triage; pass `proposal_id` for ops/baselines before apply.
- **Attention triage:** `needs_author` (1.0 stale draft — out of the reviewer queue until the author revises) plus buckets `escalated` → `awaiting_rereview` (blockers fixed, or the author rewrote entries / marked a blocker fixed and no open blockers remain) → `no_feedback` → `blocked` (reviewer order; open blockers beat an author rewrite). Create-only agents get blocked earlier in the default sort; may see warning `attention_author_scope_hint` unless they pass `proposer_username` / `agent_session_id`. Filter with `attention`. `needs_review: true` is open|partial **edits** in `awaiting_rereview` or `no_feedback` only (staff Edits badge). Escalated rows still freeze `update_proposal` until release.
- Before apply, prefer `list_proposals(proposal_id)` + `explain` → `reading-proposals`.

Full checklist IDs and axes: `explain` → `reading-proposals`.
