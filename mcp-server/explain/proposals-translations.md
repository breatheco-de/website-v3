# Locale translation proposals

How authors file draft→promote translation packets, and how Proposal Reviewer scores them.

**MCP:** Declare `review_situations: ["locale_translation"]` on `propose_change` (edits) with `variant` + `promote_on_apply`.  
Catalog: `explain_site` `topic: "proposals"` `subtopic: "situations"`. This playbook: `subtopic: "translations"`.

Site: `4geeks.com`  
Audience: Translator, Copy Editor, Proposal Reviewer  
Rule this guide protects: compare **draft locale vs source intent** before go-live — not punchier copy vs live English.

---

## Why this exists

`translate_entry` always writes a **non-public variant** (`{variant}.{locale}.yml`, default `draft`). Live `{locale}.yml` is untouched until promote.

Translators polish the draft with MCP write tools (`translate_entry`, `update_fields` on the variant). When ready to go public, they file a **proposal** so a different role applies. Reviewers must score **fidelity and readiness**, not “is Spanish punchier than English?”

---

## The house rule (paste into review checklists)

**`locale_translation`:** Promote (optional field ops) on a named variant for a target locale → **apply** when the draft matches source meaning/facts, required fields are ready, URL slug is locale-fitting, shared shell non-effects are honest, and reader copy does **not** expose SEO topology (series/cluster inventory talk). Forced awkward phrasing or topology packaging → `add_blocker`. Invented stats or wrong-locale links → block/reject. Apply promotes the variant — it does **not** run AI translation.

---

## What “good” looks like

| Do | Do not |
|---|---|
| Polish draft via `translate_entry` / `update_fields` **without** a proposal | Expect `propose_change` to create the locale file |
| `propose_change` with `variant`, `promote_on_apply: true`, `review_situations: ["locale_translation"]` | Soft-only proposal without promote labeled as translation |
| Summary: intent + **Translated from en → es** (no pasted body) | Dump full translated HTML into `summary` |
| Same facts, years, employers, sources as source locale | Invent salaries/rankings the source does not support |
| Link by page job; no series/cluster inventory talk for readers | Reintroduce “Nth piece in our cluster” / companion-piece maps when translating |
| Locale-fitting `url_slug` on the variant | Keep an English slug on `/es/` when a Spanish slug was intended |
| Attached entries: shell still from `template.{locale}.yml` | Detach only to “make translate work” |
| One entry + one target locale + named variant | Silent sibling-locale fan-out |

---

## Author playbook (Translator / Copy Editor)

You have `proposals_create` and (with MCP write) `content_edit_text`. Reviewer does not create proposals.

### 1. Write the draft locale

- `translate_entry` → `{variant}.{target_locale}.yml` (default `variant: draft`). Never live YAML.
- New language of a live page: pass `url_slug` (or `update_fields` `slug` on the variant) — a word in the target language. Without it, filing refuses `locale_url_slug_required` and go-live refuses it too; the folder name stays the page ID.
- Prefer `create_variant: true` for a new named layer when needed; merge only if that variant has **0%** traffic.
- Inspect with `get_entry_content` (`locale` + `variant`).

### 2. File the go-live proposal

```text
propose_change
  summary: "Translated from en → es. Promote draft.es for {slug} — facts match source; slug locale-fitting."
  review_situations: ["locale_translation"]
  promote_on_apply: true
  entries: [{ contentType, slug, locale: "es", variant: "draft", updates?: [...] }]
```

Optional field ops on that variant are fine in the same packet. Soft-only (no promote) is **not** this situation — keep polishing with write tools.

**New language of a `layout_owner: entry` page** (landing, downloadable, detached entry, or a new template language): the translated draft must carry the full translated `sections`, not only fields. When the proposal creates the draft (no variant), send one `{ field_path: "sections", value: [...] }` — start from `get_entry_content` on the source locale; otherwise `sections_required` (`details.new_locale`). A named draft that already has sections (e.g. from `translate_entry`) is accepted as-is. `layout_owner: shared_template` entries translate fields only.

### 3. After review

- Blockers → `revise_entries` / fix draft, then wait for apply.
- Do not call `promote_variant` yourself on agentic roles — four-eyes apply is the go-live path.

---

## Reviewer playbook (Proposal Reviewer / Publisher)

1. `list_proposals(proposal_id)` → `review_context` + optional `discovery_path`.
2. Confirm situation `locale_translation` (author-declared or inferred from promote+variant+summary cues).
3. Follow think items: fidelity · completeness · slug · shell · promote honesty.
4. Tools (optional): source `get_entry_content` (e.g. `en`) → target `get_entry_content` with `variant` → `list_variants` → this playbook.
5. Disposition: apply / `add_blocker` / reject / park adjacent notes — discovery is not a gate.

If you see `variant` + `promote_on_apply` without this situation and the summary does not look like a translation, you may still apply under `promote_draft` — but prefer asking the author to declare `locale_translation` or clarify the summary so the scorecard attaches.

---

## Non-effects

- Apply does **not** AI-translate or invent missing locales.
- `translate_entry` did **not** modify live `{locale}.yml`.
- Attached shared-layout shell still comes from `template.{locale}.yml` unless the entry was detached separately.
- No automatic sibling-locale fan-out.
- URL uniqueness is enforced at promote/publish time.
