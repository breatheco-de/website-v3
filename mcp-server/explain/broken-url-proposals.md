# Broken URL ideas

Review situation id: `broken_url`. Checklist id: same. Catalog: `explain_site` topic `proposals` `subtopic: "situations"`. This playbook: `subtopic: "broken-url"`.

**MCP:** Authors who can call `get_runtime_issues` (metrics_view or proposals_review — Swarm Orchestrator, Platform Steward, Proposal Reviewer) may declare `review_situations: ["broken_url"]` on `kind:"idea"`. Copy, SEO, layout, translator, and media roles do **not** have the tool — do not invent hit counts; do not file this label. `idea_opportunity_harm` stays default-on underneath. At most one demand label per idea.

Accept greenlights only. The site does not change until a later **edits** proposal is **applied**.

---

## Before you file

1. Call `get_runtime_issues` with `kind: "404"` (and path / window filters as needed).
2. Paste into the summary: **path**, windowed **count**, **firstSeen** / **lastSeen**, **sources**, **sampleReferrer**, **queryAttribution** (`utm_source` / `utm_medium` / `utm_campaign` and other params). If attribution is empty on the row, write **none**. Do not invent secrets or staff-preview params the log already dropped.
3. State whether any live page answers that address **and** matches funnel **product + persona**. Topical mention alone is not a match. A page with no product/persona is not a match.

Create still succeeds when the proof is thin. The reviewer blocks incomplete briefs.

---

## Reviewer score order

Confirm the brief against a fresh `get_runtime_issues` read when the tool is available (checklist, not `next_actions`). Path must match. A higher count is fine. Block when the story changes: different referrer, a campaign tag the fresh row now shows, or a count that fell to almost nothing.

Then:

| Situation | Disposition |
|---|---|
| Live page answers the address and fits product + persona | `accept` — `accepted_entry` is that **existing** page. `next_step`: follow-up edit adds a redirect only (no `creates_entry`). |
| Nothing matches, address is high-traffic | `accept` — one **new** attached slug (`accepted_entry` = new type/slug/locale, **not** the broken path). Brief must justify the entry like any new page (what it answers, product/persona, why no live page). The 404 row is **extra** justification — 404-only → `add_blocker`. Follow-up edit: `implements_proposal_id`, no variant, `review_situations: ["new_public_content"]`, required fields; apply creates files then adds the redirect. |
| Nothing matches, address is not high-traffic | `close` — do not invent a page. |
| Label/summary mismatch or missing hit proof | `add_blocker` |

"High-traffic" is reviewer judgment from count, sources, and attribution — no fixed numeric gate in this pack.

---

## Accept vs apply

- **Accept** never writes YAML, never adds a redirect, never publishes.
- **Apply** on the implementing edits proposal writes the redirect (same outcome as `update_redirect`). When the accept reserved a new slug, that edit is the `creates_entry` packet (see `new_public_content` and conventions §7g): `layout_owner: shared_template` (attached post) → field updates only, apply writes `sections: []` and leaves the shared template untouched; `layout_owner: entry` (landing, program page, downloadable, …) → the edit must carry one full `sections` update and apply publishes that layout. Redirect only after files exist. When the accept reserved an existing page, the edit does not create files — approve only adds the redirect.
- Database rows cannot be created via `creates_entry` (accept warns `accepted_entry_not_creatable`); a human creates the row first and the idea can stay accepted. Detached pages already exist, so they are never created this way.

---

## Discovery

`list_proposals(proposal_id)` may attach `discovery_path`: `explain_site` subtopic `broken-url`, `get_runtime_issues`, `test_redirect` (unavailable tools stay listed). Skip never blocks accept or close.

Do **not** push keyword volume research for this label.

See also: `idea-opportunity-harm`, `situations`, attached-entry conventions for new public content.
