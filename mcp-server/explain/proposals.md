# Content proposals

Read-only agents and staff can **propose** entry field changes or **idea** briefs. Live YAML does not change until a **different agent role** (or staff UI) **applies** edits. Notes handoffs stay open as reminders; **close** finishes them with a reason (no content change). Ideas use **accept** to greenlight a brief (still no YAML).

**Identity:** Mutating MCP requires a **role connector** (`/mcp/role/…`), `agent_session` start with exact `model` (`provider/model`), and `agent_session_id` on every mutate. Four-eyes and claims compare **username + role** (staff UI is separate). Exact model is stored for observability.

Agentic swarm role connectors may write **drafts** freely, may write **live** only with an active same-locale issue claim (same human+role), and must use proposals (not MCP promote/create) to go live — see agent-conventions §2.

## Tools (exactly 4)

| Tool | Caps | Job |
|---|---|---|
| `propose_change` | `content_view` or `seo_edit` | Create. `entries[]` → edits; `kind:"idea"` → idea brief; omit → notes. Optional `related_entries` (idea context; slug need not exist). Notes default `no_auto_retry`. Soft-blocks on recent entry writes. |
| `list_proposals` | same | **Stats-first.** Filter with `proposal_id` / `query` / `issue_id` / `status` / `kind` (`edits`\|`notes`\|`idea`). |
| `update_proposal` | `content_edit_text` or `seo_edit` | `action`: claim \| release \| withdraw \| apply \| **accept** \| close \| acknowledge \| reject \| blockers \| set_no_auto_retry \| attach_variant. |
| `get_entry_activity` | `content_view` or `seo_edit` | Read recent writes (14 days). Use before `confirm_recent_activity`. |

Do not invent `get_proposal`, `apply_proposal`, etc.

## Kinds

| Kind | When | Primary disposition |
|---|---|---|
| `edits` | `entries[]` or `promote_on_apply` | Four-eyes **apply** / **reject** |
| `notes` | No entries, default | **close** with reason (wall handoff) |
| `idea` | `kind:"idea"`, no entries | **accept** (next_step) or **close** park |

Do **not** use notes for new-spoke / config pitches — use `kind:"idea"`.

## Ideas

- **accept:** four-eyes (human+role); open blockers block; `next_step` min 20; → `finished` + `accepted`. **No YAML.**
- **close** park: `wont_fix` \| `tracked_elsewhere` \| `other` (not four-eyes). Do not use close for “yes.”
- Optional `related_entries`: context only; targets may not exist yet.

## Recent activity gate

- Edits create/apply: recent writes → `confirm_recent_activity` after `get_entry_activity`.
- Confirming does **not** write YAML or complete validation issues.

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
- **Claim** = working it (human+role; staff UI may take over). **add_blocker** = feedback.
- **Open blockers block apply and idea accept** — reject/withdraw/close still work.
- Cleared blockers ≠ approved — re-preview then four-eyes apply/accept.

## Rules

- **Four-eyes:** apply / reject / accept when caller identity (username+role or UI) ≠ proposer identity. **Close/park is not four-eyes.**
- **Non-effects:** no GitHub push; no auto-complete issues; accept/close do not create entries.
