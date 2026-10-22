# Review situations

Authors may declare **`review_situations`** on **edits** proposals so Proposal Reviewer runs the right checklist packs. Empty → the server **infers** from pending field ops (and summary keywords for hub links / locale translation). Multiple situations are allowed; each pack is reviewed independently.

**Ideas** always get default-on **`idea_opportunity_harm`**. Authors may declare **at most one** demand label: **`anticipated_demand`**, **`existing_demand`**, **`fast_decay_news`**, or **`broken_url`**. Do not file `idea_opportunity_harm` (it is injected). `set_review_situations` works on open edits **and** open ideas (demand labels only on ideas). Playbooks: `idea-opportunity-harm`, `existing-demand`, `broken-url`.

**Per-situation ship (edits):** Pass packs wait until failing packs’ ops are dropped or fixed via `revise_entries`, then **apply** (atomic — no partial-field apply).

## Tools

| Action | Who |
|---|---|
| `propose_change` → optional `review_situations[]` | authors on **edits** or **ideas** (`proposals_create`) |
| `update_proposal` → `set_review_situations` | proposer or staff on **edits** or **ideas** |
| `list_proposals(proposal_id)` → live `review_context.review_situations` + `situation_source` | reviewers |
| `get_runtime_issues` | metrics_view or proposals_review — required before filing `broken_url` |

Notes do **not** use situations.

## Catalog

| Id | When to use | Guide (`topic: "proposals"` + subtopic) |
|---|---|---|
| `internal_links` | Body adds same-locale hub/cluster links; keep facts; no SERP in the same packet | `internal-links` |
| `hub_split` | Original hub rewrite after a split: moved subtopic → paragraph linking the new hub; links to moved pages removed. **Declared only** (never inferred); chain with `applies_after_proposal_id` | `hub-split` (+ checklist `hub_split`) |
| `serp_title_description` | `meta.page_title` / `meta.description` only (or mixed — leave-live SERP then apply body) | `serp-title-description` (+ checklist `title_description_ctr`) |
| `funnel_classification` | `funnel.stage` / `funnel.products` — persona → product → stage, not topical breadth | `funnel-classification` (+ checklist `funnel_persona_product_stage`) |
| `body_copy_edit` | General body/field edits that are not link-only, SERP-only, or funnel-only | `situations` + `verify_copy` |
| `selling_figures` | Hire rates, salaries, tuition, or prices may move (**any** content type — claim-based, not landing-only) | `situations` + `selling_page_figures` |
| `new_public_content` | New or draft-backed public page (**edits** ship gate; any content type) | `situations` + `new_content_brand` |
| `promote_draft` | Promote named draft with empty/minimal updates (not a translation packet) | `situations` — summary = why draft should go live |
| `locale_translation` | Promote a **translated** locale variant (`variant` + `promote_on_apply`) | `translations` (+ checklist `locale_translation`) |
| `idea_opportunity_harm` | Every **idea** brief — opportunity vs harm before accept (default-on; not author-filed) | `idea-opportunity-harm` |
| `anticipated_demand` | Idea: launch → lasting queries after hype; empty volume OK | `idea-opportunity-harm` (+ checklist `anticipated_demand`) |
| `existing_demand` | Idea: current search rank/cite — author documents SERP maturity/weight class/asset | `existing-demand` (+ checklist `existing_demand`) |
| `fast_decay_news` | Idea: announcement only → quick reject; no keyword research | `idea-opportunity-harm` (+ checklist `fast_decay_news`) |
| `broken_url` | Idea: missing address still requested — redirect or one new attached entry | `broken-url` (+ checklist `broken_url`) |

Soft warning `situation_ops_mismatch` when the declared label and pending ops disagree — create still succeeds; live context **unions** declared ∪ inferred.

`locale_translation` without `promote_on_apply` + named `variant` → mismatch (soft-only polish is write tools, not this pack). Inferred from promote + variant + summary translation cues without a declaration → warning `locale_translation_undeclared` (prefer declaring).

Legacy / empty filed list on edits → infer (often `body_copy_edit`) with warning `situation_inferred_body`. Retag with `set_review_situations`.

## Author tips

- Prefer one situation per packet when possible; SERP rewrite = second proposal (`serp_title_description`).
- Hub links: `review_situations: ["internal_links"]` + content-only ops + summary that promises no figure/SERP changes. Linking a page that is not live yet → `applies_after_proposal_id` = that page's proposal.
- Hub split: `review_situations: ["hub_split"]` on the original hub's rewrite, chained after the new hub's proposal. Removing links to moved pages is expected there, not under `internal_links`.
- Funnel: `review_situations: ["funnel_classification"]` + `funnel.*` only (persona → product → stage; soft batch ≤10).
- Locale translation: polish with `translate_entry` / `update_fields` on the variant; file `review_situations: ["locale_translation"]` + `promote_on_apply` when ready to go live. Summary: “Translated from en → es …” (no pasted body). Do not reintroduce SEO topology packaging in the target locale.
- Reader body: never explain our content architecture to visitors (cluster membership, piece-count, companion-piece maps). Link by page job. Reviewers `add_blocker` — create still succeeds.
- After `revise_entries`, author-declared tags that no longer own remaining ops are dropped; inferred packs refresh on the next `list_proposals`.
- Ideas: put goal/evidence/kill line in summary/rationale. Demand labels: lasting launch queries → `anticipated_demand`; current search rank/cite → `existing_demand`; announcement only → `fast_decay_news`; 404 with `get_runtime_issues` proof → `broken_url` (only if you have that tool).

## Reviewer tips

- Open `list_proposals(proposal_id)` — use `review_situations`, checklists, and `discovery_path`.
- Edits: score each active pack on the ops it owns; do not reject a good link packet because SERP was weak — drop SERP ops first.
- Ideas: score Goal → Evidence → Fit → Brand → dilution; Evidence follows the demand label when present; incomplete brief → `add_blocker`; wrong vehicle → close/refile edits; discovery tools optional (unavailable ≠ block accept).
- Forced CTA for links → `add_blocker`, not reject-as-weaker-copy.
- SEO topology in body/H2 (series/cluster inventory talk) → `add_blocker` on body / new-page / link / translation packs; not create refuse; not reject for voice alone. Teaching “topic cluster” when that is the article topic is OK.
- Funnel breadth-only disagreement → `add_blocker` citing cascade step, not reject.
- Translation: fidelity to source locale, not punchier-than-live English; awkward forced phrasing or topology packaging → `add_blocker`.

Hub index: `explain_site` `topic: "proposals"` (omit subtopic). Legacy flat ids (e.g. `internal-links-proposals`) still resolve with a deprecation warning.
