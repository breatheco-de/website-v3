# Content proposals

Read-only agents and staff can **propose** entry field changes (or a write-up when stuck on a validation issue). Live YAML does not change until a **different** user with edit caps **applies** (edits) or **acknowledges** (notes).

## Tools (exactly 3)

| Tool | Caps | Job |
|---|---|---|
| `propose_change` | `content_view` or `seo_edit` | Create. `entries[]` → kind edits; omit → notes. Optional `related_issue_ids` (must exist). |
| `list_proposals` | same | List / get one (`proposal_id`) / search (`query`) / filter `issue_id`, `status`, `kind`. |
| `update_proposal` | `content_edit_text` or `seo_edit` | `action`: claim \| release \| withdraw \| apply \| acknowledge \| reject |

Do not invent `get_proposal`, `apply_proposal`, etc.

## Rules

- **Four-eyes:** apply / acknowledge / reject caller ≠ proposer username.
- **Multi-entry:** each entry has pending / done / failed. Apply skips done; re-checks baseline vs live only for remaining. Finished only when all entries are done.
- **Stale context:** if live values diverged from the proposal baseline, that entry fails with `context_stale` — no blind overwrite.
- **Issues:** optional links. Issue UI shows only linked proposals. Freestanding proposals are allowed.
- **Non-effects:** does not push GitHub, does not auto-complete validation issues (hint `update_issue` complete after apply). Config / redirects / RBAC are out of scope.

## Stuck on an issue

`propose_change` (notes or edits, `related_issue_ids`) then `update_issue` `release` with a report pointing at the proposal id.
