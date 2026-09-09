# Content proposals

Read-only agents and staff can **propose** entry field changes (or a write-up when stuck on a validation issue). Live YAML does not change until a **different** user with edit caps **applies** (edits) or **acknowledges** (notes).

## Tools (exactly 3)

| Tool | Caps | Job |
|---|---|---|
| `propose_change` | `content_view` or `seo_edit` | Create. `entries[]` → kind edits; omit → notes. Optional `variant`, `promote_on_apply`, `agent_session_id`. Optional `related_issue_ids` (must exist). |
| `list_proposals` | same | **Stats-first:** no filters → `proposal_stats` only. Pass `proposal_id` / `query` / `issue_id` / `status` / `kind` for paginated `proposals[]` (`limit`/`offset`). Includes `review_mode`, `open_blocker_count`, `blockers`. |
| `update_proposal` | `content_edit_text` or `seo_edit` | `action`: claim \| release \| withdraw \| apply \| acknowledge \| reject \| attach_variant \| add_blocker \| resolve_blocker \| reopen_blocker |

Do not invent `get_proposal`, `apply_proposal`, etc.

## Review modes

| `review_mode` | Meaning | On apply |
|---|---|---|
| `soft` | Field suggestions / notes | Write `updates[]` to live (or notes ack) |
| `soft_variant` | Field suggestions **into** a draft | Write `updates[]` into that variant file (no promote) |
| `draft_backed` | Prepared draft for go-live (`promote_on_apply`) | **Promote** variant (empty `updates` OK). May need `confirm_end_experiment` |

Always preview an attached draft before apply/reject.

## Collaboration

- **One open proposal per variant** — second create/attach → `proposal_exists`; join the existing id.
- **Claim** to fix the artifact; **add_blocker** to leave feedback (no claim). Multiple open blockers allowed.
- **Blocker body** (min 80): what's wrong, what fixed looks like, why — not MCP tool lists.
- **resolve_blocker**: active non-expired claimant only + resolve note. Expired claim → claim first.
- **Open blockers block apply only** — reject/withdraw still work.
- Cleared blockers ≠ approved — re-preview (`next_actions`) then four-eyes apply.
- No `challenge_blocker` — disagree without resolving; reviewer can `reopen_blocker`.

## `list_proposals` (token hygiene)

- Unscoped call returns **counts only** (`proposal_stats` by status/kind) plus warning `proposals_need_filter`.
- Any of `status`, `kind`, `query`, `issue_id`, `proposal_id` unlocks the list (default page size 20).
- `proposal_stats` stay **site-wide** even when the list is filtered.

## Rules

- **Four-eyes:** apply / acknowledge / reject caller ≠ proposer username.
- **Multi-entry:** each entry has pending / done / failed. Apply skips done; re-checks baseline vs live only for remaining. Finished only when all entries are done.
- **Stale context:** if live/variant values or variant file fingerprint diverged, that entry fails with `context_stale`.
- **Issues:** optional links. Issue UI shows only linked proposals. Freestanding proposals are allowed.
- **Non-effects:** does not push GitHub, does not auto-complete validation issues (hint `update_issue` complete after apply). Config / redirects / RBAC are out of scope. Blockers are not diagnostics issues.

## Stuck on an issue

`propose_change` (notes or edits, `related_issue_ids`) then `update_issue` `release` with a report pointing at the proposal id.
