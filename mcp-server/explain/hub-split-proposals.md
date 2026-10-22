# Hub split proposals

How to split an overloaded hub into two hubs, and how Proposal Reviewer scores the rewrite of the original hub.

**MCP:** Situation id `hub_split` (declared only, never inferred). Catalog index: `explain_site` `topic: "proposals"` `subtopic: "situations"`. Chain field: `applies_after_proposal_id` (order only).

Audience: SEO Specialist, Copy Editor, Proposal Reviewer

---

## When to split

Diagnostics flag hubs two ways (validator `seo-cluster-links`, SEO category, warnings only):

| Code | Meaning | Fix |
|---|---|---|
| `HUB_THIN_LINK_DENSE` | Many links per 100 words and few members — the hub reads like a link list | **Expand** the hub (a sentence per linked page, subtopic headings). Do not split. |
| `HUB_OVERLOADED` | Many members (default 25+) | Look for a subtopic group (about 5+ pages with their own identity) and split it out. |

Thresholds live in `seo-config.yml` under `hub_load:` (`thin_links_per_100_words` 3, `thin_max_members` 15, `overloaded_min_members` 25 by default).

`HUB_OVERLOADED` lists split ideas already in flight for that hub. **Join or review them before filing another.** Accept refuses an idea whose members another accepted, not-yet-live idea already claims (`idea_seo_target_members_claimed`).

The two hubs stay independent clusters — there is no parent/child field. The link from the original hub to the new hub is what ties them, and it ships through a chained proposal.

---

## Sequence

1. **Idea** — `kind: "idea"`, `idea_seo_target.cluster: { mode: "hub", members: [...] }` naming the live pages that move. The brief says which subtopic they share and why it deserves its own hub. Accept greenlights it (no YAML).
2. **New hub page** — edits with `implements_proposal_id` = the idea (creates the hub page from its draft). Its body links every member.
3. **Original hub rewrite** — edits on the original hub with `review_situations: ["hub_split"]` and `applies_after_proposal_id` = step 2's proposal. The moved subtopic becomes a short paragraph that summarizes it and links the new hub; most links to the moved pages are removed (1–2 that matter to the original hub's main topic may stay).
4. **Member moves** — when step 2 goes live, apply returns `idea_seo_hub_members_follow_up` with one `propose_change` next_action per member. Each member proposal sets `seo.pillar_path` to the new hub **and** changes the member's in-body link back to its old hub so it points at the new hub (otherwise `MEMBER_MISSING_HUB_LINK`). Chain each with `applies_after_proposal_id` = step 2's proposal so they sort first in the reviewer queue (`predecessor_applied`).

Steps 2 and 3 are separate proposals (never one bundle). Step 3 cannot be applied before step 2 is fully live (`predecessor_not_applied`). Applying step 2 does **not** apply step 3 — it returns `dependents_ready` with an apply next_action.

Between step 2 going live and the member moves, the original hub may show temporary `HUB_MISSING_MEMBER_LINKS` warnings for pages that are leaving it. **Do not re-add those links** — the member moves clear the warning.

---

## Author playbook

- Read the original hub (`get_entry_content`) and the members (`list_seo_cluster_entries`).
- Step 3 ops: `content` (or the real section path) only. No SERP fields in the same packet.
- Keep every fact, figure, and source outside the moved section.
- Anchor for the new hub names its subtopic (e.g. "salarios de programador por país"), not "click here".
- No SEO topology for readers ("this hub now has a companion hub…"). Link by page job.
- If the original hub already has an open edits proposal (`competing_entry_edits`), wait for it to close, then file step 3.

Example summary (step 3):

```text
Hub split: the salaries section now summarizes and links the new salaries hub; links to the 7 moved salary posts are removed (2 kept). Content only. Chained after the new hub's proposal. Live figures elsewhere unchanged.
```

---

## Reviewer playbook

Score the `hub_split` checklist on ops vs live:

1. **Removed links** — only to pages in the split idea's `members`. Any other removed link → `add_blocker`.
2. **New hub link** — present, same locale, subtopic anchor.
3. **Summary paragraph** — honest about what the new hub covers; no invented claims; no topology talk.
4. **Facts** — live numbers, years, employers, sources outside the moved section still present.
5. **Chain** — `applies_after_proposal_id` points at the new hub's edits proposal. Missing → `add_blocker` (apply would link a page that is not live).

Removing links to moved pages is the intended change here — do not score it as lost content.

| Situation | Action |
|---|---|
| Only moved links removed, new hub linked, facts intact, chained | Claim → apply once the new hub is live |
| A non-moved link or a fact disappeared | `add_blocker` (what, fixed looks like, why) |
| No chain to the new hub's proposal | `add_blocker` — author runs `set_applies_after` |
| New hub idea rejected/withdrawn | This proposal gets `predecessor_closed`; author unlinks or withdraws |

---

## What this does not change

- Member pages are never moved automatically — one edits proposal each.
- Chains are order only: nothing is applied for you, and the first proposal can go live alone.
- A dependent still open 48 hours after its predecessor went live is flagged overdue (badge + event `proposal_dependent_overdue`). It never escalates and never closes by itself.
- Four-eyes still applies to every proposal in the chain.
