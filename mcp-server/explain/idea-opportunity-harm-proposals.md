# Idea opportunity vs harm

Default-on review situation for every `kind: idea` proposal. Situation id: `idea_opportunity_harm`. Checklist id: same. Catalog index: `explain_site` topic `review-situations`.

**MCP:** Authors do **not** declare `review_situations` on ideas (create refuses non-empty). Classify always injects this pack. `set_review_situations` stays edits-only. Hub: `explain_site` `topic: "proposals"` `subtopic: "idea-opportunity-harm"`.

**Role split:** Authors optimize opportunity. Reviewers stop harm — they do not rewrite the brief to make it punchier. Accept greenlights a brief only (no YAML). Brand / selling-figure ship gates run on the later **edits** proposal that implements the idea.

If this page ships and gets almost no visits for 90 days, what did we break?  
If the honest answer is “hub links, crawl, freshness SLA, and another thin URL,” do not accept.

---

## Score order

Score **Goal → Evidence → Fit → Brand**, then the dilution question.

| Step | Pass | Fail |
|---|---|---|
| Goal | 90-day outcome is cite, rank, or assist a real program | Cluster poetry / “fill a hole” only |
| Evidence | Query, GSC sibling, SERP set, or traffic proof in the brief | “People will want this” |
| Fit | Not a dupe; locale justified; idea is the right vehicle | Third URL for the same angle; funnel/SERP/links-only work |
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

- **Dilution** — new slug with no retrieval evidence; unpaid hub links; dead inventory forever
- **Freshness** — `refresh_tier: fast` without owner + recrawl trigger
- **Cannibal** — same angle as an existing spoke; unjustified EN+ES doubling
- **False claims / endorsement** — named third parties without primary sources
- **Spam / brand** — generic listicle, padded FAQ, invented figures
- **Unachievable SERP** — official-domain queries a roundup cannot beat
- **Ops load** — competing locks; every later pass scores two more locales

---

## Worked examples

### Fail — marketplace spoke with no query proof

New EN/ES URLs, fast tier, pillar links, no volume/SERP. Reviewer: blocker (evidence, owner, link budget) or close.

### Pass — refresh existing news spoke

Facts on an existing slug; no third URL. Harm low. Accept as refresh brief.

### Fail — hub deletion “because spokes are dead” with no traffic proof

Dilution may improve, but short visit loss needs evidence the **hub** is low-value and a redirect/orphan plan. Missing proof → blocker. Dilution improvement alone ≠ accept.

### Fail — third article on the same product

Cannibal + retrieval split. Notes to merge, not a fourth idea.

---

## Author checklist (rationale)

- [ ] One-sentence 90-day goal (cite / rank / assist)
- [ ] Query evidence or three SERP URLs
- [ ] Named siblings and why this is not them
- [ ] One locale unless both have demand
- [ ] Kill criterion; link budget (default zero hub links)
- [ ] If this ships and gets ~0 visits, we have not broken the pillar

See also: `explain` topics **`proposals`**, **`reading-proposals`**, **`review-situations`**.
