# Content proposals

Read-only agents and staff can **propose** entry field changes. Live YAML does not change until a **different** user with edit caps **applies** (edits). Notes handoffs stay open as reminders; **close** finishes them with a reason (no content change; not four-eyes).

Agentic swarm role connectors may write **drafts** freely, may write **live** only with an active same-locale issue claim, and must use proposals (not MCP promote/create) to go live — see agent-conventions §2.

## Tools (exactly 4)

| Tool | Caps | Job |
|---|---|---|
| `propose_change` | `content_view` or `seo_edit` | Create. `entries[]` → kind edits; omit → notes. Optional `variant`, `promote_on_apply`, `agent_session_id`. Optional `related_issue_ids` (must exist). Notes default `no_auto_retry`. Soft-blocks on recent entry writes (`confirm_recent_activity`). |
| `list_proposals` | same | **Stats-first:** no filters → `proposal_stats` only. Pass `proposal_id` / `query` / `issue_id` / `status` / `kind` for paginated `proposals[]` (`limit`/`offset`). Includes `review_mode`, `open_blocker_count`, `blockers`, `no_auto_retry`, `recent_activity`, close fields when finished. |
| `update_proposal` | `content_edit_text` or `seo_edit` | `action`: claim \| release \| withdraw \| apply \| close \| acknowledge (alias) \| reject \| attach_variant \| add_blocker \| resolve_blocker \| reopen_blocker \| set_no_auto_retry. Apply re-checks recent activity. |
| `get_entry_activity` | `content_view` or `seo_edit` | Read recent people/agent writes (14 days). Use before `confirm_recent_activity`. |

Do not invent `get_proposal`, `apply_proposal`, etc.

## Recent activity gate

- Edits create/apply: if linked live (and named draft) pages have people/agent writes in the last 14 days → `action_required: confirm_recent_activity` with `activity[]`. Call `get_entry_activity`, then retry with `confirm_recent_activity: true`.
- Current `agent_session_id` writes are omitted from the **gate** count only (still listed in `events[]`).
- Apply also ignores this proposal's own prior applies for the gate count.
- Activity unreadable → `activity_unavailable` (fail-closed; no confirm shortcut).
- Confirming does **not** write YAML or complete validation issues.

## Review modes

| `review_mode` | Meaning | On apply |
|---|---|---|
| `soft` | Field suggestions | Write `updates[]` to live |
| `soft_variant` | Field suggestions **into** a draft | Write `updates[]` into that variant file (no promote) |
| `draft_backed` | Prepared draft for go-live (`promote_on_apply`) | **Promote** variant (empty `updates` OK). May need `confirm_end_experiment` |

Always preview an attached draft before apply/reject. Notes have no apply — use **close** with a disposition.

## Notes / no_auto_retry

- New notes: `no_auto_retry: true`. Open notes with that flag + shared `related_issue_id` → second notes create fails (`notes_no_auto_retry`); join the existing id. Freestanding notes (no issues) are not gated this way. Edits creates remain allowed.
- MCP must **claim** before `set_no_auto_retry`. Staff UI may flip without claim. Claim alone does not clear the flag.
- Do not blindly retry the same wall; claim, escalate, or open an **edits** proposal with a real fix.

## Close (notes)

- `close` / `acknowledge` (alias): `close_reason` = `wont_fix` \| `fixed_elsewhere` \| `tracked_elsewhere` \| `other`.
- `close_note` min 20 chars except `wont_fix` (say where / what). No verification that “elsewhere” exists.
- Finishes the proposal; **no YAML change**; not four-eyes. Prefer leaving open if work remains.

## Collaboration

- **One open proposal per variant** — second create/attach → `proposal_exists`; join the existing id.
- **Claim** to fix the artifact; **add_blocker** to leave feedback (no claim). Multiple open blockers allowed.
- **Blocker body** (min 80): what's wrong, what fixed looks like, why — not MCP tool lists.
- **resolve_blocker**: active non-expired claimant only + resolve note. Expired claim → claim first.
- **Open blockers block apply only** — reject/withdraw/close still work.
- Cleared blockers ≠ approved — re-preview (`next_actions`) then four-eyes apply.
- No `challenge_blocker` — disagree without resolving; reviewer can `reopen_blocker`.

## `list_proposals` (token hygiene)

- Unscoped call returns **counts only** (`proposal_stats` by status/kind) plus warning `proposals_need_filter`.
- Any of `status`, `kind`, `query`, `issue_id`, `proposal_id` unlocks the list (default page size 20).
- `proposal_stats` stay **site-wide** even when the list is filtered.

## Rules

- **Four-eyes:** apply / reject caller ≠ proposer username. **Close is not four-eyes.**
- **Multi-entry:** each entry has pending / done / failed. Apply skips done; re-checks baseline vs live only for remaining. Finished only when all entries are done.
- **Stale context:** if live/variant values or variant file fingerprint diverged, that entry fails with `context_stale`.
- **Issues:** optional links. Issue UI shows only linked proposals. Freestanding proposals are allowed.
- **Non-effects:** does not push GitHub, does not auto-complete validation issues (hint `update_issue` complete after apply). Config / redirects / RBAC are out of scope. Blockers are not diagnostics issues. Close does not complete issues.

## Cannot finish an issue

Release the claim with a report (what you tried). Prefer leaving the issue open for the next agent — do not open a notes proposal just to clear the queue. Use an **edits** proposal only when you have a concrete field/promote fix for someone else to apply.
