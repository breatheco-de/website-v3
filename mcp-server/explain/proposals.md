# Content proposals

Read-only agents and staff can **propose** entry field changes (or a write-up when stuck on a validation issue). Live YAML does not change until a **different** user with edit caps **applies** (edits) or **acknowledges** (notes).

## Tools (exactly 3)

| Tool | Caps | Job |
|---|---|---|
| `propose_change` | `content_view` or `seo_edit` | Create. `entries[]` → kind edits; omit → notes. Optional `related_issue_ids` (must exist). |
| `list_proposals` | same | **Stats-first:** no filters → `proposal_stats` only. Pass `proposal_id` / `query` / `issue_id` / `status` / `kind` for paginated `proposals[]` (`limit`/`offset`). |
| `update_proposal` | `content_edit_text` or `seo_edit` | `action`: claim \| release \| withdraw \| apply \| acknowledge \| reject |

Do not invent `get_proposal`, `apply_proposal`, etc.

## `list_proposals` (token hygiene)

- Unscoped call returns **counts only** (`proposal_stats` by status/kind) plus warning `proposals_need_filter`.
- Any of `status`, `kind`, `query`, `issue_id`, `proposal_id` unlocks the list (default page size 20).
- `proposal_stats` stay **site-wide** even when the list is filtered.

## Rules

- **Four-eyes:** apply / acknowledge / reject caller ≠ proposer username.
- **Multi-entry:** each entry has pending / done / failed. Apply skips done; re-checks baseline vs live only for remaining. Finished only when all entries are done.
- **Stale context:** if live values diverged from the proposal baseline, that entry fails with `context_stale` — no blind overwrite.
- **Issues:** optional links. Issue UI shows only linked proposals. Freestanding proposals are allowed.
- **Non-effects:** does not push GitHub, does not auto-complete validation issues (hint `update_issue` complete after apply). Config / redirects / RBAC are out of scope.

## Stuck on an issue

`propose_change` (notes or edits, `related_issue_ids`) then `update_issue` `release` with a report pointing at the proposal id.
