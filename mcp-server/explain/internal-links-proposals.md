# Internal links in content proposals

How 4Geeks authors file hub-visibility body edits, and how Proposal Reviewer applies them.

**MCP:** Declare `review_situations: ["internal_links"]` on `propose_change` (edits). Catalog index: `explain_site` `topic: "proposals"` `subtopic: "situations"`.

Site: `4geeks.com`  
Audience: Copy Editor, SEO Specialist, Proposal Reviewer  
Rule this guide protects: compare **proposed ops vs live**. Staff Titulo/Meta blurbs are not a reason to block or reject.

---

## Why this exists

We often change an article body only to add internal links to a hub or pillar.

That can feel slightly forced. It is still how we raise hub visibility: crawl paths, topical cluster weight, and in-article navigation to the page we actually want ranked.

Reviewers must not score these packets as “is every sentence punchier than live?”  
They must score: **does this add real hub URLs without deleting facts or inventing claims?**

Forced phrasing is polish (`add_blocker`).  
Deleted numbers, fake stats, or a dead/wrong-locale link is a real problem.  
Hub visibility by itself is not `harmful`.

---

## The house rule (paste into review checklists)

**`internal_links`:** Body ops whose summary is hub / internal linking → **apply** when live facts and locale targets stay intact. Forced phrasing → `add_blocker` (author `revise_entries`). Do **not** reject as weaker-than-live copy. Do **not** mix title/description into the same proposal.

---

## What “good” looks like

A shippable packet is small and honest.

| Do | Do not |
|---|---|
| `content` only (or the named article section you actually write) | Mix `meta.page_title` / `meta.description` in the same proposal |
| 1–3 links on sentences that already match the destination | A CTA or hub pitch under every H2 |
| Wrap an existing phrase (“ingeniero de prompts”, “salario en México”) | Invent a new promo clause just to hang the link |
| Keep every live number, year, employer, and source | Replace a sourced sentence with “ha crecido de forma notable” |
| Same-locale destinations that exist | `/en/...` links on an `/es/...` article (or the reverse) |
| Hub / pillar / cluster parent | Random money-page dump with no topical fit |
| Summary = intent + why | Paste the new HTML into `summary` |

If you also want a SERP rewrite, file a **second** proposal (`review_situations: ["serp_title_description"]` — see `explain_site` topic **`serp-title-description-proposals`**). Reviewer can apply the link packet and leave live on title/description.

---

## Author playbook (Copy Editor / SEO Specialist)

You have `proposals_create`. Reviewer does not. You file; they decide.

### 1. Confirm live and the hub

- Read live body (`get_entry_content`) so you know which sentences already exist.
- Confirm the hub/pillar URL and locale (`get_entry_seo` / cluster tools if you have them).
- If the live page already links that hub in a sane place, do not file.

### 2. Keep the diff surgical

Preferred pattern: wrap existing text.

Live:

```text
El ingeniero de prompts de IA se ha consolidado como una de las profesiones tecnológicas más demandadas.
```

Proposed (good):

```text
El [ingeniero de prompts de IA](/es/blog/herramientas-ia/ai-prompt-engineer) se ha consolidado como una de las profesiones tecnológicas más demandadas.
```

Same sentence. Same claims. One new path.

Bad:

```text
Descubre cómo destacar en esta profesión en auge con nuestro [curso de IA](/es/programas-de-carrera/ingenieria-ia) y empieza hoy.
```

That is a pitch, not a link insert. Expect a blocker.

### 3. File `propose_change` as edits

Required shape:

- `site`: `4geeks.com`
- `title`: short, e.g. `Hub links: ai-prompt-engineer → curso IA`
- `summary` (min 80, intent only): goal, which hub, promise not to touch figures or SERP fields
- `situation_note`: picture of live (“live body already has the facts; this only adds hub links”)
- `entries[]`: one content type + slug + locale
- `updates[]`: `field_path: content` (or the real section path) + the full new body value the CMS expects
- Optional `related_entries`: the hub page so the reviewer can open it in one hop
- If this replaces a rejected packet: `supersedes_proposal_id`

Example summary (authors may reuse this skeleton):

```text
Add two same-locale internal links from this article to the cluster hub. Scope is content only. Live salary figures, years, and sources stay as-is. No title or description changes. Links sit on existing phrases, not new CTAs.
```

### 4. Never bundle risk

Do not put selling-page + blog, or new-public-draft + live article, in one proposal (`mixed_risk_bundle` refuses create).  
Do not open a second edits proposal on the same type + slug + locale (`competing_entry_edits`). Join the open one or wait.

### 5. If reviewer blocks

Claim if needed, `revise_entries` on pending/failed rows only, then wait.  
`revise_entries` does not clear blockers. Reviewer `resolve_blocker` after the ops actually change.

---

## Reviewer playbook (Proposal Reviewer)

You have `proposals_review`. You cannot create or revise entries.

### When this checklist fires

Summary or ops say the point is internal links / hub / pillar / cluster visibility, and pending fields include `content` (or article HTML) without being a full factual rewrite.

If title/description are also pending: that is mixed SERP + body. Prefer leave-live on SERP (author must drop those ops) or block the mix. Do not reject the whole packet for the links.

### Score only these four gates

1. **Facts.** Live numbers, years, employers, and sources still present in the proposed body.
2. **Claims.** No new salary, ranking, “mejor”, or headcount the live article does not already support.
3. **Links.** Each new href exists, correct locale, topical hub/pillar (or an in-cluster sibling), not a broken `/es/blog/:category/...` placeholder.
4. **Force.** One link per idea is fine. A sales sentence minted only to carry the link → blocker: “put the link on the existing phrase; delete the new pitch.”

If 1–3 pass, **apply** even if the prose is a bit wooden.

### Disposition table

| Situation | Action |
|---|---|
| Links only, facts intact, targets live | Claim → apply |
| Links good, one forced pitch sentence | `add_blocker` (min 80: what is wrong, what fixed looks like, why). Do not reject |
| Links good, title/description also pending and weaker than live | Block or wait for author to `revise_entries` and drop SERP ops, then apply body |
| Proposed body deletes figures or sources to make room for links | `add_blocker`. Reject `harmful` only if the author refuses to restore facts or the packet cannot be fixed |
| Destinations missing / wrong locale / money-page spray | `add_blocker` or reject `not_implementable` / `target_missing` if the hub does not exist |
| Same SERP rewrite already shipped, live not broken, **no** link value left | `duplicate_weaker` — this is the rare reject. Link-only packets almost never qualify |
| Out-of-scope live defects this op does not touch | Notes / adjacent findings. Do not block apply. Reviewer cannot file notes; hand off to a create-capable role |

### Apply sequence

1. `list_proposals(proposal_id)` for live `review_context`.
2. `get_entry_activity` if the discovery path warns `recent_entry_writes`. Unrelated body/CTA writes alone are not a reject. Same-field churn that already added the same links → leave live or reject `duplicate_weaker`.
3. Diff proposed `content` vs live: list added hrefs; confirm no figure dropped.
4. Claim.
5. Resolve stale blockers only when they were paperwork (“summary ≠ ops”) or the author already fixed the text. Do not resolve a facts blocker and then apply the old ops.
6. Apply. Soft write to live unless the proposal is draft-backed.

Do not reject because the summary wording differs from the ops. Summary is staff paperwork.

---

## Examples

### Apply

- Live sentence unchanged except `[carrera de programación](/es/blog/carrera-de-programacion/carrera-de-programacion-es)` on the existing phrase.
- Two links: one to the locale pillar, one to a sibling city-salary article. Figures in the table untouched.
- Image alt fixed in the same `content` op, salary paragraph left as live.

### Block (author revises)

- New sentence: “Empieza hoy en 4Geeks y transforma tu futuro” + program URL. Rest of article fine.
- Link target is `/en/blog/...` inside an `es` article.
- Three consecutive paragraphs each end with the same hub CTA.

### Reject (rare)

- Body strips “€55,000” / “150.000 euros” / “LinkedIn 200%” and replaces them with hedges, even if two hub links were added.
- Hub slug does not exist on live or draft (`target_missing`).
- Second open edits proposal on the same entry — do not create; reject the weaker duplicate if it cannot join.

---

## Suggested summary templates

**Author, links only**

```text
Insert up to three same-locale internal links from this article to the cluster hub and one sibling. Content field only. Live figures, years, and sources are unchanged. No meta.page_title or meta.description ops. Anchors use phrases already in the article.
```

**Reviewer, apply report**

```text
Applied vs live: content-only hub links. Destinations exist in this locale. Live salary/year/source sentences unchanged. Forced-CTA risk accepted as low (anchors on existing phrases). Title and description left live.
```

**Reviewer, blocker body**

```text
The proposed body adds the hub URL by inventing a closing pitch paragraph the live article does not have. Fixed looks like: wrap the existing “ingeniero de prompts” phrase and delete the new “empieza hoy” sentence. Why it matters: hub links can ship; a new sales claim cannot ride along without review as a separate conversion edit.
```

---

## What this does not change

- Selling pages (`landing` / `program`) still classify as `selling_page`. Link inserts there need the selling-page figures checklist if any number moves.
- Reviewer still cannot `revise_entries`. If ops are wrong, block and stop.
- Four-eyes still applies: the human+role that files cannot be the one that applies.
- Escalated proposals stay frozen until a steward releases them.

---

## One-line test before apply

Would I still ship this body if the only difference from live is two honest, same-locale hub links?

If yes, apply.  
If the only reason to hesitate is tone, block.  
If facts disappeared, do not apply.
