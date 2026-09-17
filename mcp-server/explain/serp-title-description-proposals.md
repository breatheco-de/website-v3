# CTR title and description proposals

How to file and approve SERP snippet edits on `4geeks.com`.

**MCP:** Declare `review_situations: ["serp_title_description"]` on `propose_change` (edits). Checklist id: `title_description_ctr`. Catalog index: `explain_site` `topic: "proposals"` `subtopic: "situations"`.

Fields: `meta.page_title`, `meta.description`  
Roles: SEO Specialist or Copy Editor files; Proposal Reviewer applies, blocks, or rejects  
Compare **proposed ops vs the live snippet**. The proposal card Titulo/Meta blurb is staff paperwork. It is not a reason to block or reject.

Sister document: `explain_site` topic **`internal-links-proposals`**. Do not mix those jobs in one proposal.

---

## Purpose

A CTR proposal exists to ship a **denser public snippet** than live: same query, equal or better specifics, no new unsourced claims.

File only when you can name the live gap in one sentence (missing year, city, band, source, or a modifier the body already supports). If live already carries those tokens and you only want a catchier hook, do not file.

---

## House rule (paste into review checklists)

**`title_description_ctr`** (situation `serp_title_description`): Title/description ops → **apply** when the proposed snippet is at least as specific as live and adds a real SERP token live lacks (query-clear title, year, place, figure, source, or supported modifier) — or Query up offsets Specifics down with Claims ok. Same query + fewer specifics than live → `add_blocker` or leave live. Live not broken + recent same-field write → SERP-only: reject `duplicate_weaker`; mixed: `revise_entries` to drop SERP ops then apply body. Never mix `content` into the same proposal.

Leave live ≠ reject. Reject means the idea should die. A weaker draft should stay blocked for `revise_entries` unless churn already closed the case.

---

## What a SERP win is

Score ops against the live title and description, not against a theory of clicks.

| Dimension | Live is enough when | Proposed is better when |
|---|---|---|
| Query | Title already matches the head term the URL targets | Title names that term at least as clearly, or a closer variant the URL supports |
| Specifics | Year, city, country, salary band, employer, or source already sits in the snippet | Those tokens stay **and** you add one the body already supports |
| Claims | Numbers and sources in the snippet match the article | Same or better-sourced; no new unsourced “más demandada / $X / 200%” |
| Unique | Snippet is not a clone of a sibling locale or money page | Differentiator is real (locale, year, format, audience) |
| Length | Readable in SERP (title ~50–60 useful chars; description ~140–160) | Truncation does not cut the specific token you added |

Generic words that do not beat live on their own: Descubre, guía completa, todo lo que necesitas, aprende hoy, empieza ahora, transforma tu carrera, “definición, ejemplos y más.”

An old year in the proposed snippet is not a freshness win if live (or the body) already has a newer one.

**Offset:** Query up may offset Specifics down when Claims ok → apply (see checklist `title_description_ctr`). Do not use offset to excuse invented claims or a title that describes a different page.

---

## Good vs bad ops

| Do | Do not |
|---|---|
| `meta.page_title` and/or `meta.description` only | Touch `content` in the same proposal |
| Keep live year / city / salary / source | Swap a published figure for “salarios competitivos” |
| Add `2026` only if the article supports 2026 | Stamp a new year on a body that still only supports the old one |
| One locale, one slug | Bundle ES + EN, or blog + selling page |
| Situation note that quotes live snippet and names the gap | “Improve CTR” with no vs-live sentence |
| Title that still reads as this URL’s query | Keyword stuffing or a different intent than the slug |

### Keep live, add one token

Live title:

```text
Salario de programador en México: rangos 2025
```

Good:

```text
Salario de programador en México 2026: junior, mid y senior
```

Same query. Year updated. Seniority added. Apply if the body supports those bands.

Weak:

```text
Guía de salarios en programación | Empieza tu carrera
```

Query diluted. Year gone. Country gone. Block or leave live.

### Description can surface a figure the title cannot hold

If live description is generic and the body has `MXN 25.000–80.000` plus a source, the new description should carry the band, year, and that source.  
Do not invent a band that is not on the page.

---

## Author playbook

You have `proposals_create`. Reviewer cannot write the snippet for you.

### 1. Read live first

- `get_entry_seo` — current title, description, public path.
- `get_entry_content` — confirm year, place, and figures still exist in the body.
- `get_entry_activity` — if title/description were just written and live is already specific, do not file.
- Optional: `get_or_refresh_seo_research` `action: serp` — live SERP snapshot for context (cache-first; budgeted). Does not rewrite meta.

If live already has year + place + figure, the only legitimate CTR job is a tighter character budget or a missing modifier (junior/senior, remote, city) the article already states.

### 2. File SERP-only

- `site`: `4geeks.com`
- `review_situations`: `["serp_title_description"]`
- `title`: `SERP: {slug} title+description`
- `summary` (min 80, intent only): query, live tokens you keep, the one token you add, no body ops
- `situation_note`: paste live title and description, then `gap = …`
- `entries[]`: one type + slug + locale
- `updates[]`: only `meta.page_title` and/or `meta.description`
- `supersedes_proposal_id` only when this packet replaces an earlier one on the same entry

Ops are what get applied. Do not treat summary text as the new title.

### 3. Claims before submit

Every number, %, ranking, or employer in the new snippet must already appear on live. A new figure is a **body** proposal first, then a second SERP proposal.

### 4. After a blocker

`revise_entries` on pending/failed rows. Restore any dropped year or figure. Do not add `content` to “fix it in one shot.” That mix stalls apply.

---

## Reviewer playbook

You have `proposals_review`. You cannot `revise_entries`.

### When this checklist fires

Pending fields are `meta.page_title` and/or `meta.description` → `title_description_ctr`.

If `content` is also pending: mixed packet. Do not apply the mix as-is. Leave-live or block SERP (`revise_entries` to drop SERP ops) then apply body — or block “drop body ops” / split. Link inserts belong in `internal-links-proposals`.

### Scorecard (ops vs live)

1. **Claims.** New figure, %, ranking, or employer must be on live. Fail → block. Unsourced salary in the title → block; reject `harmful` only if that snippet must not ship.
2. **Query.** Proposed title still targets this URL’s head term. Fail → block, or reject `bad_idea` if it describes a different page.
3. **Specifics.** Proposed ≥ live on year, place, band, source — or Query up offsets Specifics down with Claims ok. Proposed weaker with no query win → block or leave live.
4. **Field freshness.** `get_entry_activity` when discovery warns `recent_entry_writes`. Same-field write in ~14 days + live not broken → SERP-only: reject `duplicate_weaker`; mixed: revise to drop SERP then apply body. Unrelated body/CTA writes alone ≠ reject.
5. **Locale.** ES snippet must not be a raw EN string. Do not copy another country’s salary into this snippet.

If 1–3 pass and the field is not mid-churn, apply.

### Disposition table

| Situation | Action |
|---|---|
| Proposed ≥ live on query + specifics (or Query-up offset), claim-safe, no recent same-field write | Claim → apply |
| Same query, fewer specifics | `add_blocker`. Default is not reject |
| Live already specific, recent title/description write, no new token (SERP-only) | Reject `duplicate_weaker` |
| Same churn but mixed with body ops | `revise_entries` to drop SERP ops, then apply body |
| Unsourced salary or % in the snippet | Block, or reject `harmful` if it cannot be made true from live |
| Title describes a different article than this slug | reject `bad_idea` or `target_missing` |
| Title + body rewrite in one packet | Block or leave-live the SERP half; split jobs |
| Open blocker already names the missing token and ops still omit it | Leave blocked |
| Unrelated body or heading issues | Adjacent note / handoff. Do not block a good snippet for an H2 you cannot edit |

### Apply sequence

1. `list_proposals(proposal_id)` — ops and live baselines, ignore Titulo/Meta prose.
2. `get_entry_seo` + `get_entry_content` — new tokens exist on the page.
3. `get_entry_activity` if warned.
4. Claim.
5. Resolve a blocker only after ops restored the missing token. Do not resolve-and-apply the old vague ops.
6. Apply.

### Report lines

Apply:

```text
Applied vs live: title/description keep {year, place, figure} and add {token}. Query unchanged. No body ops. No same-field write in the activity window.
```

Block:

```text
Proposed description drops live {token} for a generic hook. Fixed looks like: keep {token}, then add one modifier the body already supports (junior/senior, city, year). Why: snippet specificity is the asset; a vaguer hook is not an upgrade.
```

Reject (churn):

```text
duplicate_weaker: live title/description already include year + market + band; same fields written recently; proposed ops add no new true token.
```

---

## Examples

### Apply

- Live title: `Prompt engineer: qué es`. Proposed: `Prompt engineer 2026: qué es, salario y rol`. Body already has 2026 and a salary section.
- Live description has no city. Proposed adds `Madrid y remoto` because both appear in the article.
- Character trim that keeps every live specific and stops truncation on the salary number.

### Block

- Live: `Cursos de IA 2026: gratis vs de pago en España`. Proposed: `Mejores cursos de inteligencia artificial`.
- Live description cites a published growth figure. Proposed: “la demanda ha crecido mucho.”
- Title is fine; description invents a figure not on the page.

### Reject (rare)

- Repeat SERP-only rewrite on the same slug; live already has year + band; proposed adds no true token; recent same-field write (`duplicate_weaker`).
- Title claims a salary for a country this article does not cover.
- Target slug is missing and not draft-backed (`target_missing`).

---

## Summary templates

**Author, SERP only**

```text
Update title and description for this locale only. Keep live year, market, and salary tokens. Add {one missing token the body already supports}. No content field. Goal is a denser snippet than live.
```

**Author, replacement packet**

```text
Supersedes proposal {id}. Restores {tokens} in title and description. Does not touch body. SERP-only.
```

**Reviewer, leave-live / churn**

```text
Not applied. Live snippet already answers {query} with {tokens}. Proposed copy is the same intent with lower specificity. Reject duplicate_weaker when same-field churn already shipped; otherwise leave blocked for revise if a new true token exists.
```

---

## Split from body work

| Job | Fields | File as |
|---|---|---|
| Hub / internal links | `content` only | `review_situations: ["internal_links"]` — topic `internal-links-proposals` |
| CTR snippet | `meta.page_title`, `meta.description` | This guide — `review_situations: ["serp_title_description"]` |
| New figure on the page | `content` first, SERP second | Two proposals, in that order |

Two open edits proposals cannot share the same type + slug + locale. Finish one before filing the other, or join the open proposal.

---

## One-line test before apply

Would I keep this snippet if the only difference from live is one extra true token (year, place, band, source) and nothing true was removed?

If yes, apply.  
If the hook got catchier by deleting a fact, block.  
If live is already specific and this rewrite adds no true token (especially after a recent same-field write), reject `duplicate_weaker` or leave live.
