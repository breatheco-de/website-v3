# Funnel classification proposals

How to file and approve `funnel.stage` / `funnel.products` edits.

**MCP:** Declare `review_situations: ["funnel_classification"]` on `propose_change` (edits). Checklist id: `funnel_persona_product_stage`. Catalog index: `explain_site` `topic: "proposals"` `subtopic: "situations"`.

Fields: `funnel.stage`, `funnel.products` (on `_common.yml`; locale-agnostic)  
Roles: content / SEO / product-aware authors file; Proposal Reviewer applies, blocks, or rejects  
Compare **proposed ops vs live funnel + product audience** (`list_products` → `get_product`). Staff Titulo/Meta blurbs are not a reason to block or reject.

Sister documents: topics **`funnel`**, **`product`**, **`serp-title-description-proposals`**, **`internal-links-proposals`**. Prefer funnel-only packets — do not mix body or SERP in the same proposal.

---

## Purpose

A funnel classification proposal exists to put a page in the right **buyer journey**: who it is for → which product owns that buyer → how ready they are.

It is **not** a judgment of whether the article “feels broad” or “sounds like a brand report.” Topical breadth alone is not a reason to use `products: all` or to move career-outcomes content onto a product whose personas are not career buyers.

---

## House rule (paste into review checklists)

**`funnel_persona_product_stage`** (situation `funnel_classification`): Funnel ops → **apply** when Persona → Product → Stage all pass (or Persona warns for incomplete audience with honest product-only bind). Any cascade step fail → `add_blocker` citing the step and what correct binding looks like. Breadth-only disagreement → block or leave live, **not** reject. Prefer funnel-only packets; mixed → score packs independently and `revise_entries` before apply.

Leave live ≠ reject. Reject means the idea should die. A wrong cascade should stay blocked for `revise_entries` unless churn already closed the case.

---

## Scorecard (persona → product → stage)

Score **each entry row** in the proposal. Soft prefer ≤10 related posts per packet; larger batches are allowed — still score every row.

| Dimension | Pass when | Fail when | Warn when |
|---|---|---|---|
| **Persona** | Content intent matches a real persona id on a product (`get_product`) | Invented persona id, or persona from the wrong product’s story | Product has no usable personas — product-only bind OK; do not invent ids |
| **Product** | Bindings follow that fit; **multiple** `{ product, persona? }` OK when two+ personas truly fit | Bound to a product whose buyers do not match; or `all` used only because the topic feels company-wide | — |
| **Stage** | `awareness` / `consideration` / `decision` / `post-enrollment` matches readiness | Money-page (`decision`) for top-of-funnel education; or awareness on a buy-now page | — |

**`products: all`:** only when **no single product’s personas are a better fit** (true site/brand story). `"all"` **never** carries personas.

**Partial edits:** if only `funnel.stage` or only `funnel.products` moves, still re-check the **full** cascade against live + proposed — the untouched half must still fit.

---

## Good vs bad ops

| Do | Do not |
|---|---|
| `funnel.stage` and/or `funnel.products` only | Mix `content` or `meta.page_title` / `meta.description` in the same proposal |
| `{ product, persona? }` when a persona fits | Invent a persona id that is not on `_product.yml` |
| Multiple product rows when two real personas fit | Default to `all` because the title says “report” or “outcomes” |
| Soft batch ≤10 related posts | Megabatch without per-row rationale |
| Summary names intent + cascade rationale | “Improve funnel” with no buyer story |
| Product-only bind when audience is empty (state the warn) | Force `all` because personas are missing |

### Career-outcomes post (apply)

Intent: career transition / hiring outcomes.  
Product audience: AI Engineering has career-changer personas; Flex/Fluency do not sell that story.

Good:

```yaml
funnel:
  stage: awareness   # or consideration — not decision unless ready to buy
  products:
    - product: ai-engineering
      persona: the-career-changer   # when audience exists
```

Bad (breadth heuristic):

```yaml
funnel:
  stage: awareness
  products: all   # or ai-flex — “feels brand-wide”
```

---

## Author playbook

You have `proposals_create`. Reviewer cannot write funnel values for you.

### 1. Pre-flight

1. `get_entry_content` — what buyer story does this page speak to?
2. `list_products` — which SKUs exist; persona ids / audience status.
3. `get_product` on candidates — match persona → product, then pick stage.
4. `get_entry_activity` if you suspect recent `funnel.*` churn on the same slug.

If live cascade is already correct, do not file.

### 2. File funnel-only

- `review_situations`: `["funnel_classification"]`
- `title`: e.g. `Funnel: {slug} → ai-engineering / awareness`
- `summary` (min 80, intent only): buyer intent, persona/product/stage rationale, funnel-only scope
- `situation_note`: live funnel vs proposed cascade in one short picture
- `entries[]`: prefer ≤10 related posts; score each mentally before submit
- `updates[]`: only `funnel.stage` and/or `funnel.products`
- Body or SERP changes → **second** proposal

### 3. After a blocker

`revise_entries` on pending/failed rows. Fix the cited cascade step. Do not add body ops to “fix it in one shot.”

---

## Reviewer playbook

You have `proposals_review`. You cannot `revise_entries`.

### When this checklist fires

Pending fields include `funnel.stage` and/or `funnel.products` → `funnel_persona_product_stage` (situation `funnel_classification`).

If body or SERP is also pending: mixed packet. Score each pack; do not apply the mix as-is when funnel fails — author drops or fixes via `revise_entries`.

### Disposition table

| Situation | Action |
|---|---|
| Cascade pass on every row; no same-field funnel churn | Claim → apply |
| Wrong persona / product / stage | `add_blocker` (cite step + fixed binding). Default is not reject |
| Breadth-only “should be all / Flex” with cascade otherwise sound | Leave live or block; do **not** reject |
| Incomplete audience; honest product-only bind | Apply with warn — do not invent persona |
| Two real persona fits; multi-bind proposed | Apply if both fits hold |
| `products: all` with a clearer single-product persona fit | `add_blocker` |
| Same-field funnel churn; live already correct; no real change | Leave live or reject `duplicate_weaker` |
| Body/SERP also pending and weak | Revise/drop failing pack; then apply (atomic) |
| Out-of-scope live body defects | Adjacent notes; do not block funnel apply |
| Target slug missing | reject `target_missing` |

### Apply sequence

1. `list_proposals(proposal_id)` — ops, situations, `discovery_path`.
2. `list_products` + `get_product` for proposed product slug(s).
3. `get_entry_content` — intent vs personas.
4. `get_entry_activity` if warned (`recent_entry_writes` / funnel churn).
5. Score each row Persona → Product → Stage.
6. Claim → resolve blocker only after ops match the fix → apply.

### Report lines

Apply:

```text
Applied vs audience: intent matches {persona} on {product}; stage {stage}. Not products:all. Funnel-only ops. No same-field churn in the activity window.
```

Block:

```text
Product step fails: career-outcomes intent bound to {wrong_product} / all. Fixed looks like: product {right_product} with persona {id} (or product-only if audience empty), stage {stage}. Why: cascade is buyer fit, not topical breadth.
```

Reject (rare):

```text
duplicate_weaker: live funnel already matches persona → product → stage; same fields written recently; proposed ops add no real cascade change.
```

---

## Summary templates

**Author, funnel only**

```text
Classify funnel for this locale-agnostic page. Intent is {buyer story}. Bind product {slug} (persona {id} when audience exists). Stage {awareness|consideration|decision}. Funnel fields only — no body or SERP. Soft batch ≤10 related posts.
```

**Author, incomplete audience**

```text
Product {slug} has no usable personas yet. Bind product-only (no invented persona id). Stage {stage}. Will revisit when audience is filled. Funnel-only.
```

---

## Split from other work

| Job | Fields | File as |
|---|---|---|
| Funnel targeting | `funnel.stage` / `funnel.products` | This guide — `review_situations: ["funnel_classification"]` |
| Hub / internal links | `content` only | `internal_links` — topic `internal-links-proposals` |
| CTR snippet | `meta.page_title` / `meta.description` | `serp_title_description` — topic `serp-title-description-proposals` |

Two open edits proposals cannot share the same type + slug + locale. Finish one before filing the other, or join the open proposal.

---

## Enforcement note

Even when site funnel enforcement is **off** and persona is optional in YAML, still **evaluate** buyer fit. Product-only binding is OK when audience is empty (warn). `"all"` never carries personas.

---

## One-line test before apply

Would I keep this binding if the only question is **buyer story → product → readiness** — not whether the article feels broad?

If yes, apply.  
If breadth was the only argument for `all` or a different product, block.  
If live cascade is already correct and this rewrite adds no real change (especially after recent same-field writes), leave live or reject `duplicate_weaker`.
