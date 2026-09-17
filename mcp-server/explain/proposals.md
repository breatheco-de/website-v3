# Content proposals

Agents and staff can **propose** entry field changes or **idea** briefs when they have **`proposals_create`**. Live YAML does not change until a **different agent role** with **`proposals_review`** (Proposal Reviewer or Publisher) — or staff UI — **applies** edits. Notes handoffs stay open as reminders; **close** finishes them with a reason (no content change). Ideas use **accept** to greenlight a brief (still no YAML).

**Identity:** Mutating MCP requires a **role connector** (`/mcp/role/…`), `agent_session` start with exact `model` (`provider/model`), and `agent_session_id` on every mutate. Four-eyes and claims compare **username + role** (staff UI is separate). Exact model is stored for observability.

**MCP write overlay:** When `mcp_write_enabled` is false (default if unset), the catalog keeps view caps + `proposals_create` only — use `propose_change` and the author `update_proposal` toolkit. Direct draft/live tools and `proposals_review` (apply/reject/accept) are stripped; a write-enabled reviewer over MCP or staff Proposals UI must apply. Check `get_current_user`.

Agentic swarm role connectors may write **drafts** freely, may write **live** only with an active same-locale issue claim (same human+role), and must use proposals (not MCP promote/create) to go live — see agent-conventions §2.

## Tools (exactly 4)

| Tool | Caps | Job |
|---|---|---|
| `propose_change` | `proposals_create` | Create. `entries[]` → edits; `kind:"idea"` → idea brief; omit → notes. Optional `related_entries` (idea context; slug need not exist). Notes default `no_auto_retry`. Soft-blocks on recent entry writes. |
| `list_proposals` | `content_view` \| `proposals_create` \| `proposals_review` | **Stats-first** (`by_attention`, **`by_kind_status`**, `stalled_ideas`). Filter with `query` / `issue_id` / `status` / `kind` / `proposer_username` / `proposer_actor` / `agent_session_id` / `escalated` / `attention` / `stalled` → **summary** rows (`entry_count`, `field_paths`, `attention`, blocker counts; no ops/values). Scoped default **`sort=attention`** (role-aware) + open\|partial when status omitted (unless stalled); pass `sort: updated_at` for chronology. Opt-in **`kpi_history`** (+ `kpi_granularity` / `kpi_from` / `kpi_to`) → end-of-day stock series through yesterday. `proposal_id` → **full** detail; open\|partial also returns live `review_context` + `discovery_path`. |

**KPI strip ↔ `list_proposals`:** Unscoped calls return **live** Ideas/Edits/Notes × Open/Done/Rej via `proposal_stats.by_kind_status` (same as the staff strip big numbers; open includes partial; withdrawn omitted; empty site → all nine buckets as `0`). Sparkline history is **opt-in only** (`kpi_history: true`) — never attached by default. Event Webhooks are **not** proposal stats and never appear on this tool. Filtered (scoped) calls still return **site-wide** `by_kind_status` (warning `proposal_stats_site_wide`); do not treat those counts as the size of the filtered page.

See also **`explain_site` `topic: "proposals"` `subtopic: "reading"`**: damage/undo axes, checklist IDs, create refuses, apply block when target missing.

**Review situations:** optional `review_situations` on **edits** — hub `topic: "proposals"` with subtopics **`situations`**, **`internal-links`**, **`serp-title-description`**, **`funnel-classification`**, **`translations`**. Empty → infer from ops. Ideas always get default-on **`idea_opportunity_harm`** (`subtopic: "idea-opportunity-harm"`) — do not pass `review_situations` on ideas.

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
| `proposals_review` only | claim, release, apply, reject, accept, close, acknowledge, blockers | withdraw, attach_variant, set_no_auto_retry, revise_entries, set_review_situations |
| `proposals_create` only | claim, release, withdraw, attach_variant, set_no_auto_retry, revise_entries, set_review_situations | apply, reject, accept, close, blockers |
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

- **Live review:** default-on situation `idea_opportunity_harm` + checklist `idea_opportunity_harm` (Goal → Evidence → Fit → Brand → dilution) stacked with `idea_accept` (lock/`next_step`). Playbook: `explain_site` `topic: "proposals"` `subtopic: "idea-opportunity-harm"`. Incomplete brief → `add_blocker`; wrong vehicle → close/refile edits. Discovery tools optional.
- **accept:** four-eyes (human+role); open blockers block; `next_step` min 20; **`accepted_entry`** `{ contentType, slug, locale }` required (locks that page+locale); → `finished` + `accepted`. **No YAML.** Refuse if another accepted idea already holds that entry (`accepted_entry_taken`).
- **close** park: `wont_fix` \| `tracked_elsewhere` \| `other` (not four-eyes). Do not use close for “yes.”
- Optional `related_entries`: context only; targets may not exist yet (prefills accept UI when present).
- **Follow-up edits:** pass `implements_proposal_id` to the accepted idea. Required when creating edits for a reserved entry. At most one **open/partial** implements child (`idea_already_in_progress`). Entry must match `accepted_entry`. Brand / selling-figure ship gates run on that edits proposal (`new_content_brand` / `selling_page_figures`), not on the idea.
- **Stalled:** accepted idea with a locked entry and **no** implements child in `open`/`partial`/`finished`. Rejected/withdrawn children resurface stalled. List with `stalled: true`; stats include `stalled_ideas`. Legacy accepts without `accepted_entry` are not stalled.

## Recent activity gate

- Edits create/apply: recent writes → `confirm_recent_activity` after `get_entry_activity`.
- On open review, `list_proposals(proposal_id)` may elevate `get_entry_activity` and warn `recent_entry_writes` when SERP ops or gate-filtered writes exist — see **`explain` topic `reading-proposals`**.
- Confirming does **not** write YAML or complete validation issues. Same-field SERP churn + live not broken → reject (title/description-only) or revise to drop SERP ops (mixed) instead of confirming.

## Review modes (edits)

| `review_mode` | On apply |
|---|---|
| `soft` | Write `updates[]` to live |
| `soft_variant` | Write into draft variant (no promote) |
| `draft_backed` | Promote variant. May need `confirm_end_experiment` |

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
- **revise_entries** (authors): rewrite pending/failed soft ops; idle or self-claim only; foreign claim blocks; open blockers stay open until `resolve_blocker`.
- **Open blockers block apply and idea accept** — reject/withdraw/close still work.
- **Escalated:** steward UI hold (`escalated: true` + note). Status stays open|partial. MCP `update_proposal` fails (`code: escalated`) until release. Not an MCP action. Sibling create may warn `escalated_sibling`.
- Cleared blockers ≠ approved — re-preview then four-eyes apply/accept.
- Optional `supersedes_proposal_id` on `propose_change` links a replacement to a rejected/withdrawn predecessor (`replaced_by` on the old). Never required.
- **Withdraw:** `close_note` min 20 (no reject-kind gate).

## Rules

- **Four-eyes:** apply / reject / accept when caller identity (username+role or UI) ≠ proposer identity. **Close/park is not four-eyes.**
- **Non-effects:** no GitHub push; no auto-complete issues; accept/close do not create entries.

## Create refuses + review context

- **Refuse create:** `entry_not_found` (missing write target), `mixed_risk_bundle` (mixed selling/new-public/other in one edits or idea related set), `competing_entry_edits` (second open edits on same type+slug+locale), `implements_required` / `idea_already_in_progress` / `implements_entry_mismatch` (accepted-idea follow-through).
- **Allowed shape:** live missing but named draft exists → `new_public_content` (promote later).
- **Apply block:** `target_missing` when the page was deleted after filing — reject/withdraw/close still work.
- Live `review_context` on `list_proposals(proposal_id)` for open|partial; snapshot on list rows is a filed hint only.
- Multi-row list is **summary only** (`proposals_view: "summary"`, warning `proposals_summary_only`): use `attention`, `entry_count`, `field_paths` to triage; pass `proposal_id` for ops/baselines before apply.
- **Attention triage:** buckets `escalated` → `awaiting_rereview` (blockers fixed) → `no_feedback` → `blocked` (reviewer order). Create-only agents get blocked earlier in the default sort; may see warning `attention_author_scope_hint` unless they pass `proposer_username` / `agent_session_id`. Filter with `attention`. Escalated rows still freeze `update_proposal` until release.
- Before apply, prefer `list_proposals(proposal_id)` + `explain` → `reading-proposals`.

Full checklist IDs and axes: `explain` → `reading-proposals`.
