# Idea opportunity vs harm

Default-on review situation for every `kind: idea` proposal. Situation id: `idea_opportunity_harm`. Checklist id: same. Catalog index: `explain_site` topic `review-situations`.

**MCP:** Classify always injects `idea_opportunity_harm`. Authors may declare **one** demand label on create or `set_review_situations`: `anticipated_demand` | `existing_demand` | `fast_decay_news` | `broken_url` (do not file `idea_opportunity_harm`). Edit-only packs stay refused on ideas. Hub: `explain_site` `topic: "proposals"` `subtopic: "idea-opportunity-harm"` (current search demand: `subtopic: "existing-demand"`; broken URL: `subtopic: "broken-url"`).

**Role split:** Authors optimize opportunity. Reviewers stop harm — they do not rewrite the brief to make it punchier. Accept greenlights a brief only (no YAML). Brand / selling-figure ship gates run on the later **edits** proposal that implements the idea.

**New-URL ideas:** set structured `idea_funnel` `{ stage, products }` before accept (`products: "all"` only with stage `awareness`). Soft warning on create; `add_blocker` if reviewing without it; accept refuses until complete; funnel freezes at accept and seeds/matches on create.

**SEO target (SEO-monitored types):** also set `idea_seo_target` `{ main_keyword, cluster: join | hub | standalone }` before accept (`set_idea_seo_target`). Score it: keyword matches the brief's search claim (not a broader head term); join hub is live, same locale, and on-topic (`list_seo_clusters` / `list_seo_cluster_entries`); hub-mode members are real live posts; standalone only for `fast_decay_news` / `broken_url` with a credible reason. Weak fit → `add_blocker` naming the better hub. Freezes at accept; seeded into the new draft. Refusal codes: proposals hub (`explain_site` topic `proposals`, no subtopic).

If this page ships and gets almost no visits for 90 days, what did we break?  
If the honest answer is “crawl, freshness SLA, and another thin URL,” do not accept.

**Hub link at go-live:** every accepted idea gets a link from its hub when the page goes live — that link is how the page gets discovered and indexed fast. A page that does not deserve a hub link does not deserve accept. The implementing author files a second edits proposal on the hub (`review_situations: ["internal_links"]`, `applies_after_proposal_id` = the page's proposal); apply is refused until the page is live. The kill criterion says what happens to that link: if the page is retired, remove it from the hub.

---

## Score order

Score **Goal → Evidence → Fit → Brand**, then the dilution question.

| Step | Pass | Fail |
|---|---|---|
| Goal | 90-day outcome is cite, rank, or assist a real program | Cluster poetry / “fill a hole” only |
| Evidence | Follow demand label when present. No label: score the summary — keyword/GSC/SERP only when the brief claims search win; launch or 404 cues without a label → `add_blocker` naming the label | Invented volume; “people will want this” with no label and no non-search reason |
| Fit | Not a dupe; locale justified; idea is the right vehicle; brief matches the target page type's `strategy` purpose/constraints (think item `content_type_fit`) | Third URL for the same angle; funnel/SERP/links-only work; brief fights its page type (e.g. deep tutorial pitched as a landing) |
| Brand | Educational angle, checkable facts, real program CTA | Invented cards, “best of” with no source |

Then: if the page can be mediocre and still tax the site, do not accept. Dilution *improvement* alone (e.g. delete a hub) is not a pass without visit/redirect evidence.

---

## Disposition

| Situation | Action |
|---|---|
| Harm is low and the brief is complete | `accept` + `next_step` (min 20) + `accepted_entry`. Do not say the page is live. |
| Idea might be fine; research or kill line missing | `add_blocker`: what is wrong, what fixed looks like, why it matters (min 80). |
| Idea itself is the harm (spam, dupe, official-catalog clone we will lose) | `reject` or `close` park. Reject is rare and terminal. |
| Better as a refresh of an existing slug | `close` `tracked_elsewhere` naming that slug. |
| Wrong vehicle (funnel / SERP / hub-links-only on live pages) | `close` and tell author to refile as **edits** with the right situation. |

Open blockers block accept. Reviewer cannot `revise_entries` on an idea (no ops). Incomplete briefs still **create** — fix via blocker, not create refuse.

---

## Wrong vehicle

Use `kind: idea` for a new URL, net-new public page, or structural brief (including cluster reshape / hub deletion). Do not use notes for new-spoke pitches.

| Real job | File this instead |
|---|---|
| Change funnel on live pages | edits + `funnel_classification` |
| Change title / description | edits + `serp_title_description` |
| Add hub links only | edits + `internal_links` |
| Refresh facts on an existing slug | idea or edits **on that slug**, not a third URL |
| “We noticed dupes” | notes naming the slugs |

---

## Discovery (optional)

`list_proposals(proposal_id)` may attach `discovery_path`:

- Always: `explain_site` topic `idea-opportunity-harm-proposals`
- When `related_entries` exist: `get_entry_seo`, `list_seo_cluster_entries`, `get_organic_traffic` (paths) — visit / cannibal / sibling checks

Skip is allowed. Unavailable tools stay listed with `available: false`. **Skip never blocks accept or close.**

---

## Harm types (short)

- **Dilution** — new slug with no retrieval evidence; dead inventory forever (no kill criterion)
- **Freshness** — `refresh_tier: fast` without owner + recrawl trigger
- **Cannibal** — same angle as an existing spoke; unjustified EN+ES doubling
- **False claims / endorsement** — named third parties without primary sources
- **Spam / brand** — generic listicle, padded FAQ, invented figures
- **Unachievable SERP** — official-domain queries a roundup cannot beat
- **Ops load** — competing locks; every later pass scores two more locales

---

## Worked examples

### Fail — marketplace spoke with no query proof

New EN/ES URLs, fast tier, no volume/SERP. Reviewer: blocker (evidence, owner, kill criterion) or close. The pillar link is not the problem — the missing evidence is.

### Pass — refresh existing news spoke

Facts on an existing slug; no third URL. Harm low. Accept as refresh brief.

### Fail — hub deletion “because spokes are dead” with no traffic proof

Dilution may improve, but short visit loss needs evidence the **hub** is low-value and a redirect/orphan plan. Missing proof → blocker. Dilution improvement alone ≠ accept.

### Fail — third article on the same product

Cannibal + retrieval split. Notes to merge, not a fourth idea.

---

## Author checklist (rationale)

- [ ] Target page type named in `related_entries` (content type key, not a tag); its `get_content_type_info` strategy read and the brief fits it
- [ ] One-sentence 90-day goal (cite / rank / assist)
- [ ] Evidence for the job (search proof, or demand label + its proof, or non-search reason in the summary)
- [ ] Named siblings and why this is not them
- [ ] One locale unless both have demand
- [ ] Kill criterion, including removing the hub link if the page is retired
- [ ] Hub link plan: which hub links the page at go-live (chained `internal_links` proposal)
- [ ] If this ships and gets ~0 visits, we have not broken the pillar
- [ ] Demand label when needed: `anticipated_demand` | `fast_decay_news` | `broken_url`

See also: `explain` topics **`proposals`**, **`reading-proposals`**, **`review-situations`**, **`broken-url`**.
