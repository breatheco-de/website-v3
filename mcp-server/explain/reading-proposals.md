# Reading proposals (review context)

When you open a single open/partial proposal via `list_proposals(proposal_id)`, the response includes live **`review_context`** (situation classification) and often a **`discovery_path`** built from `agent_preview.think_items`. Terminal proposals (`finished` / `rejected` / `withdrawn`) have no live review context.

List rows may include a **`review_context_snapshot`** (filed-at-create or last shape-change hint). Prefer live `review_context` for decisions.

**Situations = checklists.** One `damage_class` badge (worst case); many `active_checklists` / think items can stack on the same proposal. On **edits**, author-declared **`review_situations`** (optional) plus inferred packs drive which checklists fire — see **`explain_site` `topic: "proposals"` `subtopic: "situations"`**. On **ideas**, classify always injects **`idea_opportunity_harm`**; authors may declare one demand label (`anticipated_demand` | `existing_demand` | `fast_decay_news` | `broken_url`) — see **`subtopic: "idea-opportunity-harm"`** / **`"existing-demand"`** / **`"broken-url"`**. Staff may store a decide-time **`decision_debug`** snapshot — it is **stripped from MCP** payloads (staff UI only); do not invent or require it.

**Role split:** proposers optimize opportunity (CTR / query fit) via create skills; reviewers use checklists to stop **harm** (invented claims, query drops, false scope, unjustified new URLs) — not to rewrite for punchier copy.

## Two axes

| Axis | Values | Meaning |
|---|---|---|
| **Damage class** | `none` · `existing_metadata` · `existing_content` · `selling_page` · `new_public_content` | What kind of public impact this open work has |
| **Undo cost** | `none` · `low` · `medium` · `high` | How hard apply is to undo (`none` = notes/idea; `low` = draft-only soft_variant; `medium` = soft live write; `high` = draft_backed / promote_on_apply) |

`selling_page` (staff badge **Outcome figures**) means this proposal **adds or changes** hire rates, salaries, tuition, or prices — **any** content type. It is **not** “this page is a landing/program.” Title-only / funnel-only / typo body without claim cues stay `existing_*`. Count-as-lead forms are a **soft hint** only (never alone attach figures). Gray-zone claim text may run an automated check; tags `used_jev` / `used_jev_unavailable` mark when that ran.

## Checklist module IDs

| ID | When it fires |
|---|---|
| `selling_page_figures` | Outcome-figure claims on **edits** (clear cues, declared `selling_figures`, promote-draft scan, or Jev yes on ambiguous) |
| `new_content_brand` | New public content on **edits** (ship gate — not on ideas; any type when creating/missing) |
| `dedup_coordinate` | Open notes (or non-edits) sibling shares an issue |
| `dedup_competing_edits` | Open edits sibling shares an issue |
| `dedup_fix_pending` | Reviewing **notes** while an edits sibling is open — check the fix before closing as wont_fix |
| `idea_opportunity_harm` | Always on ideas — opportunity vs site harm scorecard. Playbook: `idea-opportunity-harm` |
| `anticipated_demand` | Idea demand label — lasting queries after a launch; empty volume OK |
| `existing_demand` | Idea demand label — current search rank/cite vs SERP occupants. Playbook: `existing-demand` |
| `fast_decay_news` | Idea demand label — announcement only; quick reject |
| `broken_url` | Idea demand label — 404 proof + match vs create. Playbook: `broken-url` |
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
| `layout_structure` | Structural `sections` change (a section added / removed / moved per `sections_summary`, whoever edited the draft) or a created layout (new page / language / template language) on a `layout_owner: entry` or template entry. First line names the owner. Registry checks shape only — images, links, ecommerce scope are yours; wrong structure → `add_blocker`. A text edit inside one section does not fire it |
| `template_blast_radius` | Any pending entry is a template (`is_shared_template: true`) — open 2–3 `affected_entries.sample`, new `{{ entry.* }}` placeholders filled, all template languages covered, detached entries unchanged, apply needs `confirm_affected_entries`. Stacks with `layout_structure` |

## Layout fields on entries

| Field | Meaning |
|---|---|
| `layout_owner` | `shared_template` = the draft holds fields only (layout comes from `template.{locale}.yml`); `entry` = the draft is the whole page (including detached entries). Per entry; wins over `body_model`. Table: conventions §7g |
| `detached: true` | Why a shared-layout type's entry reports `entry` |
| `is_shared_template: true` | The entry is slug `template` — the draft is the shared layout itself (reaches `affected_entries`) |
| `layout_owner_at_filing` | Owner stored when the proposal was filed / revised (review lookups). Absent on older rows |
| `sections_summary` | Per-section change rows (`added` / `removed` / `changed` + `changed_keys` / `moved` + `from_index`); max 30 rows, 8 keys, `truncated` |

## Soft mix nudge

When title/description ops are mixed with other field updates, warning `mixed_serp_and_body` on create and on open: prefer separate proposals next time; create still succeeds. No hard split while competing-entry edits remain one-open-per-page.

## Create-time refuses

`propose_change` fails (does not create) with:

| Code | Meaning | What to do |
|---|---|---|
| `entry_not_found` | Edits target missing and no accepted idea reserved it — or (with `implements_proposal_id`) the type cannot be created from a proposal | No idea: file one, get it accepted with this slug, then edits with `implements_proposal_id` and no variant (section-built types also need full `sections`). With an idea: a human must create the page (CMS / `create_entry`), then resubmit with the same `implements_proposal_id`. |
| `sections_required` | New `layout_owner: entry` page (downloadable, landing, program page, …) with no full `sections` update — including `sections[0].title`-style paths or `[]`. With `details.new_locale: true`: a new language of an entry page, of a detached entry (file-based or database-backed), or a new template language (`is_shared_template`) — also on `revise_entries`. `details.layout_owner` / `detached` name the case | Send one `{ field_path: "sections", value: [ …section objects ] }` (non-empty; translated for a new language — start from `get_entry_content` on the source locale). Read shapes with `get_component_schema`. A named draft that already has sections is not refused. |
| `invalid_sections` | A full `sections` array fails the component registry (unknown type/version, missing required prop, undeclared variant). Checked on every full `sections` update, new pages and new languages alike | Fix the section at `property_path` (`issues` lists up to 10). Nothing was saved — no draft, no folder. |
| `page_create_no_draft` | New section-built page and the packet sets `variant` or `promote_on_apply` | Resubmit with no variant. The proposal creates the page folder and its draft. |
| `attached_no_draft` | Attached post, no live file, and the packet sets `variant` or `promote_on_apply` | Resubmit with no variant. Apply creates the files. |
| `database_entry_required` | Database type with no row | This workflow cannot create the row. The accepted idea can stay. Overrides work once the row exists. |
| `required_fields_missing` | New attached post or new section-built page ops omit a required live field | Add the named fields. The idea still holds the slug. |
| `attached_sections_refused` | New attached post includes `sections[...]` | Field updates only. The shared template stays unchanged. |
| `mixed_risk_bundle` | Edits entries **or** idea `related_entries` resolve to more than one risk bucket (selling / new-public / other) | Split into separate proposals |
| `competing_entry_edits` | Another open/partial **edits** proposal already targets the same type + slug + locale | Join that proposal, or reject the weaker one |
| `implements_required` | An accepted idea already reserved this type + slug + locale | Pass `implements_proposal_id` to that idea |
| `idea_already_in_progress` | Another open/partial edits already implements that idea | Join that edits proposal |
| `implements_entry_mismatch` | `implements_proposal_id` set but entries do not match the idea’s locked page | Target the locked contentType/slug/locale |

**Allowed:** live missing but the named draft **exists** — new-page-via-draft; classifies `new_public_content`. Also allowed: a file-based slug reserved by an accepted idea, with **no** variant (`creates_entry`) — attached posts send field updates only (apply leaves the shared template alone); section-built pages must also send full `sections`. Apply publishes that one locale.

**Reservations are per page folder + locale.** A new language on a page whose folder already exists is a normal edit — no idea, no `implements_proposal_id`. Full `sections` in that edit are still registry-checked (`invalid_sections`).

**Accept warning `accepted_entry_not_creatable`:** accepting an idea for a database-backed type whose page does not exist succeeds, but edits cannot create it (`database_entry_required`). The slug stays reserved; a human must create the page first. `list_proposals` rows show `accepted_entry_create_mode: "manual"` (vs `attached` / `page` when the follow-up edit creates the page) and `accepted_entry_layout_owner`.

**Accept warning `accepted_entry_needs_layout`:** the reserved page will be `layout_owner: entry` (create mode `page`). Accept succeeds; the follow-up edits must send the whole layout as one full `sections` update (registry-checked). The `idea_accept` checklist asks whether the brief describes the page structure.

**Create / revise warning `template_locales_incomplete`:** a template proposal skips some live template languages (`details.changed_locales` / `template_locales` / `missing_locales`). Still created; the skipped languages keep the old layout.

## Publish refuse: `empty_page`

Apply (publish) of a section-built page whose locale has no `sections` and no content fails with `empty_page` (message starts with `EMPTY_PAGE`). Draft saves and micro edits are not blocked. Revise the proposal with a non-empty `sections` update, then apply again.

Notes + edits on the same issue stay allowed. Shared issue alone does **not** refuse create.

## Apply block

If live classify reports `target_missing` (page deleted after a normal edits filing — not a `creates_entry` packet), `update_proposal` **apply** fails with `target_missing`. A `creates_entry` packet does not block apply while the folder is still absent. Reject with `reject_kind: target_missing` (+ confirm + note) / withdraw / close still work. Restore the page and file fresh (optional `supersedes_proposal_id`) if the work is still wanted.

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
- `creates_page_entry` — applying publishes a new `layout_owner: entry` page (or language) from its draft, including its full layout (`creates_attached_entry` stays for `shared_template`)
- `layout_owner_changed` — the entry owned its layout at filing and now uses the shared template (reattached), and the draft changes `sections` (they would be ignored). Apply returns `context_stale` with `details.reason: "layout_owner_changed"` → attention `needs_author`; author revises to fields only or withdraws. Detach and older rows without an owner at filing are not flagged

## Apply warnings

- `template_placeholders_unfilled` — apply `dry_run` and apply of a template proposal: `details { contentType, locale, placeholders: [{ name, missing, total, sample (≤3 slugs) }] }` for new `{{ entry.* }}` placeholders some attached entries cannot fill (those pages render an empty spot). Never blocks; omitted when none are new or all are filled

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

## Who reviewed (list rows + detail)

| Field | Meaning |
|---|---|
| `reviewer_action_by` / `reviewer_action_by_actor` / `reviewer_action_at` | **Latest non-author feedback**: last blocker add, reopen, or resolve by someone other than the proposer (same username + role = author). Null when only the author has acted. **Not approval** — open blockers may still be pending. Only the latest reviewer is kept. |
| `closed_by` + `close_reason` | Terminal decision. `finished` with no reason = edits applied; `accepted` = idea accepted; `wont_fix` / `fixed_elsewhere` / `tracked_elsewhere` / `other` = closed without shipping; `rejected` + reject kind. Withdrawn is the author pulling back. |

**Author actions never count as review.** When the proposer adds, reopens, or resolves a blocker on their own proposal, neither `reviewer_action_at` nor `reviewer_action_by` moves. Attention effect: after an author rewrite, an author-added blocker no longer counts as "reviewer looked" — once blockers clear, the proposal still reads `awaiting_rereview`. Open blockers still read `blocked` regardless of who filed them.

**Filter `reviewer_username`** (`list_proposals`): exact case-insensitive username; matches `reviewer_action_by`, **or** `closed_by` when status is `finished` | `rejected`. Withdrawn closers and earlier reviewers replaced by a later one never match. Username only — agents acting as a staff subject match that subject. Omit `status` to include closed proposals.
