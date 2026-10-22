# Existing search demand

Demand label for `kind: idea` when the pitch is **rank and/or cite** on a query that **already has demand**. Situation id: `existing_demand`. Checklist id: same. Hub: `explain_site` topic `proposals` `subtopic: "existing-demand"`.

**MCP:** Authors declare `review_situations: ["existing_demand"]` on create or `set_review_situations` (at most one demand label). `idea_opportunity_harm` stays default-on underneath. Do not file `idea_opportunity_harm`. Sister labels: `anticipated_demand` (volume later), `fast_decay_news`, `broken_url`.

**Role split:** Authors research and write the justification into the brief. Reviewers score the card and stop harm — they do **not** re-run keyword/SERP research to finish the author's homework. Accept greenlights only (no YAML).

---

## Author research (before propose)

1. Call `get_or_refresh_seo_research` `action: keyword_metrics` for the target query (cache-first).
2. Call `action: serp` for the same query.
3. Put the conclusion in summary/rationale (not invent later):
   - Named query; demand is **current**
   - Mature or not (AIO / stable institutional top set)
   - Who occupies 1–8; mega-brand vs peer weight class
   - Unique non-copyable asset or explicit none
   - Thinner sibling considered
   - Kill criterion; filler only with honest rationale + 90-day kill

KD is context only — never the sole pass/fail.

---

## Score order (reviewer)

Stop at the first no. Score from **what is already on the brief**.

| Step | Pass | Fail |
|---|---|---|
| Mature? | Brief states AIO / institutional top set (or clearly immature) | No SERP write-up on a search/cite pitch → `add_blocker` |
| Weight class? | Peer SERP (bootcamps, indie, niche) or immature | Mega-brands (Google, Microsoft, IBM, Coursera, AWS, Wikipedia…) for a generic explainer |
| Unique asset? | Owned data, tool, syllabus map, outcomes, demo — page is that slice | Copyable restatement (OECD/NIST “what is X”) with no unique slice |
| Thinner sibling? | Long-tail / career-switcher preferred when mega-SERP | Third generic URL on the same head term |
| Kill / honesty | Named kill; filler only if rationale says filler + 90-day kill | Sold as citation lottery against Google/IBM |

Then dilution: if this ships and gets ~0 visits, would we still pay crawl/inventory? If yes without a kill plan → do not accept. Accepted ideas get a hub link at go-live (see `subtopic: "idea-opportunity-harm"`), so a page not worth that link is not worth accepting.

---

## Disposition

| Situation | Action |
|---|---|
| Peer SERP or unique asset; brief complete | `accept` + `next_step` + `accepted_entry` |
| Research or kill line missing | `add_blocker` (what wrong / fixed looks like / why) |
| Mature mega + generic explainer | `reject` or `close` / tell author to recast |
| Better as thinner sibling | `close` `tracked_elsewhere` or blocker to refile |
| Assist-only (not rank/cite) | Wrong label — clear `existing_demand` or refile without it |

Open blockers block accept. Soft create warning `existing_demand_undeclared` when an unlabeled brief looks like search/cite — retag; do not auto-attach.

**New-URL ideas:** also set structured `idea_funnel` `{ stage, products }` before accept (`products: "all"` only with `awareness`). Soft warning `idea_funnel_missing` on create; reviewer `add_blocker` if missing; accept refuses until complete. See proposals hub / idea accept checklist.

**SEO target:** on SEO-monitored types also set `idea_seo_target` — `main_keyword` = the exact query this brief's SERP evidence is about; `cluster.mode: "join"` with a live same-locale hub, or `"hub"` with named live members. Standalone is **not** allowed for `existing_demand` (news / broken-URL only). Accept refuses when the keyword is already held by a live page or another accepted idea — refresh that page instead.

---

## Discovery (reviewer)

`list_proposals(proposal_id)` may attach:

- `explain_site` subtopic `existing-demand`
- When `related_entries` exist: SEO/cluster/organic (cannibal / sibling) — optional

**No** `keyword_metrics` / `serp` on the reviewer path as required research. Skip never blocks accept.

---

## Worked examples

### Fail — learn about AI vs Google/IBM/Coursera

Mature SERP, mega-brands, AIO cites others, brief is OECD/NIST explainer, goal “get cited.” Reject or recast to long-tail / unique asset. KD 50 is the symptom.

### Pass — peer bootcamp SERP + clear angle

Top results are similar academies; brief has educational angle, program CTA, kill line. Accept.

### Pass — unique slice only

Mature mega SERP but page is only our salary table / tool walkthrough nobody else ships — not a generic definition page.

---

## Author checklist

- [ ] `review_situations: ["existing_demand"]`
- [ ] keyword_metrics + serp run; conclusions in the brief
- [ ] Weight-class call and asset/none explicit
- [ ] Thinner sibling considered
- [ ] Kill / filler honesty
- [ ] 90-day goal is cite/rank (or drop this label for assist-only)

See also: `idea-opportunity-harm`, `situations`, `reading-proposals`.
