# Reading proposals (review context)

When you open a single open/partial proposal via `list_proposals(proposal_id)`, the response includes live **`review_context`** (situation classification) and often a **`discovery_path`** built from `agent_preview.think_items`. Terminal proposals (`finished` / `rejected` / `withdrawn`) have no live review context.

List rows may include a **`review_context_snapshot`** (filed-at-create or last shape-change hint). Prefer live `review_context` for decisions.

**Situations = checklists.** One `damage_class` badge (worst case); many `active_checklists` / think items can stack on the same proposal. On **edits**, author-declared **`review_situations`** (optional) plus inferred packs drive which checklists fire — see **`explain_site` `topic: "proposals"` `subtopic: "situations"`**. On **ideas**, classify always injects **`idea_opportunity_harm`** (filed list empty; no retag) — see **`subtopic: "idea-opportunity-harm"`**. Staff may store a decide-time **`decision_debug`** snapshot — it is **stripped from MCP** payloads (staff UI only); do not invent or require it.

**Role split:** proposers optimize opportunity (CTR / query fit) via create skills; reviewers use checklists to stop **harm** (invented claims, query drops, false scope, unjustified new URLs) — not to rewrite for punchier copy.

## Two axes

| Axis | Values | Meaning |
|---|---|---|
| **Damage class** | `none` · `existing_metadata` · `existing_content` · `selling_page` · `new_public_content` | What kind of public impact this open work has |
| **Undo cost** | `none` · `low` · `medium` · `high` | How hard apply is to undo (`none` = notes/idea; `low` = draft-only soft_variant; `medium` = soft live write; `high` = draft_backed / promote_on_apply) |

Selling content types (`landing` / `landings` / `program` / `programs`) always classify as `selling_page`, even for meta-only SEO.

## Checklist module IDs

| ID | When it fires |
|---|---|
| `selling_page_figures` | Selling page damage on **edits** |
| `new_content_brand` | New public content on **edits** (ship gate — not on ideas) |
| `dedup_coordinate` | Open notes (or non-edits) sibling shares an issue |
| `dedup_competing_edits` | Open edits sibling shares an issue |
| `dedup_fix_pending` | Reviewing **notes** while an edits sibling is open — check the fix before closing as wont_fix |
| `idea_opportunity_harm` | Always on ideas — opportunity vs site harm scorecard. Playbook: `idea-opportunity-harm-proposals` |
| `idea_accept` | Always on ideas — accept locks brief only (`accepted_entry` + `next_step`) |
| `notes_close` | Notes kind |
| `review_mode_inert` | Notes/idea (apply does not write YAML) |
| `title_description_ctr` | Any remaining op on `meta.page_title` and/or `meta.description` — SERP harm scorecard (Query/Specifics/Claims). Stacks with other checklists; meta-only omits `verify_copy`. Playbook: `explain` topic `serp-title-description-proposals` |
| `internal_links` | Declared or inferred hub/internal-link body packs — facts/claims/links/force gates; apply if wooden; see `explain` topic `internal-links-proposals` |
| `funnel_persona_product_stage` | Declared or inferred `funnel.stage` / `funnel.products` packs — Persona → Product → Stage; funnel-only omits `verify_copy`. Playbook: `explain` topic `funnel-classification-proposals` |
| `verify_copy` | Edits with non–title/desc fields (or no SERP ops) when not link-only — proposed vs live; summary **why/scope** (not value paste-match) |
| `adjacent_findings` | Edits on existing live pages (`existing_metadata` / `existing_content` / `selling_page`) when apply is not blocked |
| `disposition` | Baseline edits — apply / reject / blocker / adjacent notes park; leave-live on SERP → revise_entries then apply |
| `existence_unknown` | Lookup could not confirm existence |
| `target_missing` | Open edits whose live target no longer exists — **apply is blocked** |

## Soft mix nudge

When title/description ops are mixed with other field updates, warning `mixed_serp_and_body` on create and on open: prefer separate proposals next time; create still succeeds. No hard split while competing-entry edits remain one-open-per-page.

## Create-time refuses

`propose_change` fails (does not create) with:

| Code | Meaning | What to do |
|---|---|---|
| `entry_not_found` | Edits target missing: live gone **and** (no variant, or named draft missing) | Create/draft first, or file `kind:"idea"` |
| `mixed_risk_bundle` | Edits entries **or** idea `related_entries` resolve to more than one risk bucket (selling / new-public / other) | Split into separate proposals |
| `competing_entry_edits` | Another open/partial **edits** proposal already targets the same type + slug + locale | Join that proposal, or reject the weaker one |
| `implements_required` | An accepted idea already reserved this type + slug + locale | Pass `implements_proposal_id` to that idea |
| `idea_already_in_progress` | Another open/partial edits already implements that idea | Join that edits proposal |
| `implements_entry_mismatch` | `implements_proposal_id` set but entries do not match the idea’s locked page | Target the locked contentType/slug/locale |

**Allowed:** live missing but the named draft **exists** — new-page-via-draft; classifies `new_public_content`.

Notes + edits on the same issue stay allowed. Shared issue alone does **not** refuse create.

## Apply block

If live classify reports `target_missing` (page deleted after filing), `update_proposal` **apply** fails with `target_missing`. Reject with `reject_kind: target_missing` (+ confirm + note) / withdraw / close still work. Restore the page and file fresh (optional `supersedes_proposal_id`) if the work is still wanted.

## Three disposition lanes

| Lane | Use | Blocks apply? |
|---|---|---|
| **`add_blocker`** | Proposed field is wrong, invents a claim, or summary **why/scope** is false (e.g. “content refresh” with meta-only ops) | Yes |
| **`adjacent_findings` → notes** | Live page is broken in ways the ops do not touch (same entry), or you noticed defects on another entry | No |
| **`reject`** | The change itself must not ship | Closes the proposal |

### Adjacent findings routing

- **`verify_copy`:** proposed `value` vs live for fields this proposal writes; summary why/scope vs ops (do not require summary to paste values).
- **`title_description_ctr`:** SERP fields only — ignore Titulo/Meta blurb; leave live ≠ reject; revise to drop SERP ops if body should still ship. When SERP ops or recent writes: prefer `get_entry_activity` first.
- **`adjacent_findings`:** live body/SEO vs approved facts when research tools were used.
- Same entry, ops do not touch → **notes** naming this page (content type / slug / locale). Prefer `related_entries`. Link `related_issue_ids` **only if** an issue already exists — do not invent tickets. Do **not** block apply.
- Other entry → **notes** naming that page — never a blocker on this proposal.
- Existing open notes covering it → **join/append** (same-issue notes refuse duplicates when `no_auto_retry`).
- Nothing to park → no empty notes; apply when in-scope is clean.
- Do not leave findings only in chat.
- Notes are **visible backlog** only: no YAML on close, no auto-assign / auto-retry. A later agent or staff files edits.
- **Proposal Reviewer** lacks `proposals_create`: do **not** convert park items into blockers; hand the list to a create-capable role (or join notes if already open). In-scope false proposed copy still uses `add_blocker`.

## Warnings on live context

- `situation_changed` — live class differs from filed snapshot
- `shared_issue_id` — related open proposals on the same issue
- `existence_unknown` — verify before inventing damage
- `target_missing` — apply blocked
- `mixed_serp_and_body` — title/description mixed with other field updates; prefer split next time
- `recent_entry_writes` — gate-filtered recent writes on one or more pending entries (lists each page + count); call `get_entry_activity` before apply

## Recent activity (priority on review)

When `list_proposals(proposal_id)` builds `discovery_path` for open|partial **edits**:

- **Elevate** `get_entry_activity` to the first discovery tool when there are pending `meta.page_title` / `meta.description` ops **or** gate-filtered write counts &gt; 0 (same filters as apply `confirm_recent_activity`: exclude this agent session when known; exclude this proposal’s already-applied entry writes).
- Warning `recent_entry_writes` lists **every pending entry with writes**. Tool `args_hint` targets the **hottest** pending entry.
- **Same-field churn:** only treat as title/description churn when recent writes overlap the fields this proposal touches. Unrelated body/CTA edits alone do **not** justify reject.
- **Disposition:** similar SERP fix already shipped and live not broken → **reject** `duplicate_weaker` if the proposal is title/description-only; if mixed with body/other ops → **revise_entries** to drop SERP ops, then apply the rest.
- Discovery remains optional (skip does not block). Apply still soft-gates with `confirm_recent_activity` — do not confirm when churn applies; reject or revise instead.

## Ideas

After mixed-risk refuse, a surviving idea has one class: worst of related targets (missing public → `new_public_content`; selling → `selling_page`; other existing → `existing_content`; no targets → `none`). `idea_opportunity_harm` + `idea_accept` always fire; `new_content_brand` / `selling_page_figures` do **not** attach on ideas.

## Partial proposals

On `partial`, only pending/failed entries count toward the situation; already-applied entries are history. `title_description_ctr` drops once no remaining title/description ops.
