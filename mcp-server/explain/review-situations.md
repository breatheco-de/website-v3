# Review situations

Authors may declare **`review_situations`** on **edits** proposals so Proposal Reviewer runs the right checklist packs. Empty → the server **infers** from pending field ops (and summary keywords for hub links / locale translation). Multiple situations are allowed; each pack is reviewed independently.

**Ideas** use one default-on situation: **`idea_opportunity_harm`** (opportunity vs site harm before accept). Authors do not declare it; `set_review_situations` is edits-only. Playbook: `explain_site` `topic: "proposals"` `subtopic: "idea-opportunity-harm"`.

**Per-situation ship (edits):** Pass packs wait until failing packs’ ops are dropped or fixed via `revise_entries`, then **apply** (atomic — no partial-field apply).

## Tools

| Action | Who |
|---|---|
| `propose_change` → optional `review_situations[]` | authors on **edits** (`proposals_create`) |
| `update_proposal` → `set_review_situations` | proposer or staff on **edits** |
| `list_proposals(proposal_id)` → live `review_context.review_situations` + `situation_source` | reviewers |

Notes do **not** use situations. Ideas always show `idea_opportunity_harm` on live classify (filed list stays empty).

## Catalog

| Id | When to use | Guide (`topic: "proposals"` + subtopic) |
|---|---|---|
| `internal_links` | Body adds same-locale hub/cluster links; keep facts; no SERP in the same packet | `internal-links` |
| `serp_title_description` | `meta.page_title` / `meta.description` only (or mixed — leave-live SERP then apply body) | `serp-title-description` (+ checklist `title_description_ctr`) |
| `funnel_classification` | `funnel.stage` / `funnel.products` — persona → product → stage, not topical breadth | `funnel-classification` (+ checklist `funnel_persona_product_stage`) |
| `body_copy_edit` | General body/field edits that are not link-only, SERP-only, or funnel-only | `situations` + `verify_copy` |
| `selling_figures` | Program/landing where outcome figures may move | `situations` + `selling_page_figures` |
| `new_public_content` | New or draft-backed public page (**edits** ship gate) | `situations` + `new_content_brand` |
| `promote_draft` | Promote named draft with empty/minimal updates (not a translation packet) | `situations` — summary = why draft should go live |
| `locale_translation` | Promote a **translated** locale variant (`variant` + `promote_on_apply`) | `translations` (+ checklist `locale_translation`) |
| `idea_opportunity_harm` | Every **idea** brief — opportunity vs harm before accept (default-on) | `idea-opportunity-harm` (+ checklist `idea_opportunity_harm`); keep `idea_accept` for lock/next_step |

Soft warning `situation_ops_mismatch` when the declared label and pending ops disagree — create still succeeds; live context **unions** declared ∪ inferred.

`locale_translation` without `promote_on_apply` + named `variant` → mismatch (soft-only polish is write tools, not this pack). Inferred from promote + variant + summary translation cues without a declaration → warning `locale_translation_undeclared` (prefer declaring).

Legacy / empty filed list on edits → infer (often `body_copy_edit`) with warning `situation_inferred_body`. Retag with `set_review_situations`.

## Author tips

- Prefer one situation per packet when possible; SERP rewrite = second proposal (`serp_title_description`).
- Hub links: `review_situations: ["internal_links"]` + content-only ops + summary that promises no figure/SERP changes.
- Funnel: `review_situations: ["funnel_classification"]` + `funnel.*` only (persona → product → stage; soft batch ≤10).
- Locale translation: polish with `translate_entry` / `update_fields` on the variant; file `review_situations: ["locale_translation"]` + `promote_on_apply` when ready to go live. Summary: “Translated from en → es …” (no pasted body).
- After `revise_entries`, author-declared tags that no longer own remaining ops are dropped; inferred packs refresh on the next `list_proposals`.
- Ideas: put goal/evidence/kill line in summary/rationale; do not pass `review_situations`.

## Reviewer tips

- Open `list_proposals(proposal_id)` — use `review_situations`, checklists, and `discovery_path`.
- Edits: score each active pack on the ops it owns; do not reject a good link packet because SERP was weak — drop SERP ops first.
- Ideas: score Goal → Evidence → Fit → Brand → dilution; incomplete brief → `add_blocker`; wrong vehicle → close/refile edits; discovery tools optional (unavailable ≠ block accept).
- Forced CTA for links → `add_blocker`, not reject-as-weaker-copy.
- Funnel breadth-only disagreement → `add_blocker` citing cascade step, not reject.
- Translation: fidelity to source locale, not punchier-than-live English; awkward forced phrasing → `add_blocker`.

Hub index: `explain_site` `topic: "proposals"` (omit subtopic). Legacy flat ids (e.g. `internal-links-proposals`) still resolve with a deprecation warning.
