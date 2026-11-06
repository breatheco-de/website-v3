# MCP response examples

What an agent actually receives from this MCP server, shown through six real situations. Read this next to [MCP Server Standards](blog/mcp-standards.md): the standard says *why* responses are shaped this way; this page shows *what they look like*.

Every JSON block below is generated from the server's own response helpers (see [Keeping this page honest](#keeping-this-page-honest)), so it matches what agents get today. The pages, slugs and proposals are made up.

## The four kinds of response

| Kind | How to spot it | What the agent should do |
|---|---|---|
| Success | `success: true` | Read `warnings` (what did **not** happen) and `side_effects` (what else changed), then run any `required` `next_actions` |
| Decision needed | `action_required: "<code>"` | Stop. Ask the human (or decide from the payload), then retry with the arguments in `next_actions[].args_hint` |
| Hard error | `success: false` with no `action_required` | Fix the inputs. Retrying the same call will fail the same way |
| Research menu | a `discovery_path` field on any response | Optional reading before a big decision. Not a to-do list; skipping it never blocks anything |

`warnings` and `next_actions` are always arrays on success and decision-needed responses, even when empty. An empty list means "nothing to report", not "the server forgot".

---

## Part 1 — One page edit, three responses

An agent wants to swap the order of two sections on the blog post `what-is-python`. Blog posts share one layout file per language (`template.en.yml`), so changing section order is not a single-page edit.

### 1. The server asks before writing

The agent calls `reorder_sections` without saying where the change should go. The server cannot tell whether the agent means "this post only" or "every blog post", so it writes nothing and asks.

<!-- mcp-example:layout_gate -->
```json
{
  "action_required": "confirm_layout_target",
  "message": "Content type 'blog' uses a shared layout. This edit may change template.en.yml (all entries) or only this entry overlay. Re-call with layout_target set.",
  "options": [
    "layout_target: \"type_template\" — write the shared template.en.yml (affects all attached entries in this locale)",
    "Detach the entry first if you need a custom section tree, then edit as a standalone page"
  ],
  "detected": {
    "contentType": "blog",
    "shared_layout": true,
    "slug": "what-is-python",
    "locale": "en"
  },
  "warnings": [],
  "next_actions": [
    {
      "tool": "reorder_sections",
      "priority": "required",
      "reason": "Re-call with layout_target: \"type_template\" or \"entry\".",
      "args_hint": {
        "contentType": "blog",
        "slug": "what-is-python",
        "locale": "en",
        "layout_target": "type_template",
        "confirm_layout_target": true
      }
    }
  ]
}
```
<!-- /mcp-example -->

**What to notice:** `action_required` names the decision, `options` explain each choice in plain words, and `next_actions` hands over the exact retry. Nothing was written.

**What the agent does next:** asks the human whether all blog posts should change. If yes, it retries with `layout_target: "type_template"`.

### 2. A wrong retry is a hard error

The agent retries with `confirm_layout_target: true` but forgets to set `layout_target`. Confirming without saying *what* you confirm is a mistake in the inputs, not a decision, so the server returns a hard error.

<!-- mcp-example:layout_fail -->
```json
{
  "success": false,
  "message": "layout_target must be \"entry\" or \"type_template\" when confirm_layout_target is set"
}
```
<!-- /mcp-example -->

**What to notice:** no `next_actions`. There is no safe call to suggest; the message says which input is wrong.

**What the agent does next:** retries with both `layout_target: "type_template"` and `confirm_layout_target: true`.

### 3. The write succeeds, and the response says what it did not do

<!-- mcp-example:template_write_ok -->
```json
{
  "success": true,
  "message": "Sections reordered in blog/template.en.yml",
  "wrote": {
    "layer": "type_template",
    "contentType": "blog",
    "path": "blog/template.en.yml",
    "locale": "en",
    "slug": "what-is-python"
  },
  "warnings": [
    {
      "code": "reorder_sections_no_binding_fanout",
      "message": "reorder_sections only changed order on this page. Bound siblings keep their own section order; bindings sync content fields, not topology order."
    },
    {
      "code": "shared_template_html_cache_async",
      "message": "Shared-template write: path-scoped HTML bust for this entry (+ bound_updates if any). Other URLs that share template.*.yml may keep previous anonymous HTML until TTL (~5 min). Slow content-index scan is async/coalesced; redirect writes still sync-slow. Non-effect: does not invalidate all DB/template entry URLs. See server/content-write-flush.ts, server/html-page-cache.ts, server/content-index.ts."
    }
  ],
  "next_actions": [
    {
      "tool": "reorder_sections",
      "priority": "required",
      "reason": "Shared layout section order changed. Replicate allowlisted structure only to template.es.yml — do NOT copy marketing copy. Blast radius: every blog entry uses this template.",
      "args_hint": {
        "order": [
          1,
          0,
          2
        ],
        "confirm_live_edit": true,
        "contentType": "blog",
        "slug": "template",
        "locale": "es",
        "layout_target": "type_template",
        "confirm_layout_target": true
      }
    }
  ],
  "side_effects": [
    {
      "kind": "shared_template_blast_radius",
      "summary": "This is the shared layout for content type 'blog'. All blog entries in locale 'en' render sections from template.en.yml — not a single post."
    },
    {
      "kind": "locale_sibling_sync",
      "summary": "Allowlisted structure must also be applied to sibling shells (template.es.yml). Do not copy marketing copy."
    }
  ]
}
```
<!-- /mcp-example -->

**What to notice:**

- `wrote` names the exact file that changed (the shared English layout, not the post).
- `side_effects` spells out the blast radius: every English blog post now renders the new order, and the Spanish layout still has the old one.
- `warnings` carry the non-effects with stable codes: other pages that bind the same sections keep their own order, and some cached pages may show the old order for a few minutes.
- `next_actions` is `required`: repeat the same reorder on `template.es.yml`, structure only, no copy. The server does not do that silently; the agent does it in the open.

**What the agent does next:** runs the Spanish follow-up from `next_actions`, then tells the human both languages changed.

---

## Part 2 — Reviewing a proposal: the research menu

When an agent opens one proposal that is still open (`list_proposals` with `proposal_id`), the response includes a `discovery_path`: things worth thinking about and tools worth calling before deciding to apply, block or reject. Which items appear depends on what the proposal changes.

In these examples the proposal replaces a hardcoded price and hire rate on a live landing page with site variables (`global.price_fullstack`, `global.hire_rate`). Numbers like these can cost real leads if they are wrong, so the server turns on the **outcome figures** review.

To keep the blocks readable, each `look_for` list is cut to its first two lines; the `… +N more` line marks how many were left out and is not part of the real response.

### 4. A full research menu

<!-- mcp-example:discovery_figures -->
```json
{
  "discovery_path": {
    "goal": "Optional context before apply | reject | add_blocker. Not next_actions — you choose; skip does not block apply.",
    "items": [
      {
        "kind": "think",
        "id": "selling_page_figures",
        "title": "Verify every outcome figure",
        "why": "This edit touches hire rates, salaries, tuition, or prices. A wrong number is not cosmetic — any content type.",
        "look_for": [
          "proposed number vs approved source — the approved source is list_variables (site facts)",
          "figure as a variable token → confirm it is the right variable for the claim (e.g. monthly vs full price) with list_variables",
          "… +7 more"
        ]
      },
      {
        "kind": "think",
        "id": "verify_copy",
        "title": "Check proposed fields against live",
        "why": "Catch breakage and invented claims on the fields this proposal writes — not a rewrite coach.",
        "look_for": [
          "proposed value vs live for fields this proposal writes",
          "summary why/scope justified by ops (e.g. content refresh with meta-only → add_blocker)",
          "… +6 more"
        ]
      },
      {
        "kind": "think",
        "id": "adjacent_findings",
        "title": "Park out-of-scope live-page defects",
        "why": "Real live defects this proposal does not write must not become default apply-blockers or chat-only.",
        "look_for": [
          "invented or stale figures on the live page even if ops do not change them",
          "dead links, duplicate blocks, locale-mismatched related links",
          "… +8 more"
        ]
      },
      {
        "kind": "think",
        "id": "disposition",
        "title": "Choose a disposition",
        "why": "After optional research, decide apply, reject, add_blocker, or park adjacent notes.",
        "look_for": [
          "apply only when every in-scope gate is clean and you would ship this yourself",
          "multi-situation: review each pack independently; pass packs wait until failing packs' ops are dropped or fixed via revise_entries, then apply (atomic)",
          "… +5 more"
        ]
      },
      {
        "kind": "tool",
        "id": "preview_content",
        "tool": "get_entry_content",
        "why": "See the page body the proposal would change.",
        "look_for": [
          "proposed fields vs live copy",
          "broken CTAs or missing sections ops do not touch → adjacent_findings / notes, not default add_blocker"
        ],
        "available": true,
        "args_hint": {
          "contentType": "landing",
          "slug": "full-stack-miami",
          "locale": "en"
        }
      },
      {
        "kind": "tool",
        "id": "recent_writes",
        "tool": "get_entry_activity",
        "why": "Check recent writes on the same fields before applying — stop title/description churn loops.",
        "look_for": [
          "overlapping writers on the same fields this proposal touches (title/description / same paths)",
          "similar SERP fix already shipped and live not broken → SERP-only: reject duplicate_weaker; mixed: revise_entries to drop title/description ops then apply body",
          "… +2 more"
        ],
        "available": true,
        "args_hint": {
          "contentType": "landing",
          "slug": "full-stack-miami",
          "locale": "en"
        }
      },
      {
        "kind": "tool",
        "id": "seo_context",
        "tool": "get_entry_seo",
        "why": "Review SEO/meta context for the entry.",
        "look_for": [
          "title/description fit",
          "keyword or schema gaps",
          "… +1 more"
        ],
        "available": true,
        "args_hint": {
          "contentType": "landing",
          "slug": "full-stack-miami",
          "locale": "en"
        }
      },
      {
        "kind": "tool",
        "id": "diagnostics",
        "tool": "run_entry_diagnostics",
        "why": "Surface open validation issues on the entry.",
        "look_for": [
          "issues the proposal claims to fix",
          "open issues ops do not touch → adjacent_findings / notes (same or other page), not default add_blocker"
        ],
        "available": true,
        "args_hint": {
          "contentType": "landing",
          "slug": "full-stack-miami",
          "locale": "en"
        }
      },
      {
        "kind": "tool",
        "id": "figure_facts",
        "tool": "list_variables",
        "why": "Outcome figures are on — check proposed prices, hire rates and ratings against the site facts catalog (the approved source).",
        "look_for": [
          "token → is it the right variable for the claim (monthly vs full price, region vs sitewide)",
          "hardcoded figure that varies by region → add_blocker asking for the token, unless it equals literal_ok for this page",
          "… +2 more"
        ],
        "available": true,
        "args_hint": {
          "names": [
            "global.price_fullstack",
            "global.hire_rate"
          ],
          "context": {
            "entry": {
              "contentType": "landing",
              "slug": "full-stack-miami",
              "locale": "en"
            }
          }
        }
      },
      {
        "kind": "tool",
        "id": "traffic_risk",
        "tool": "get_organic_traffic",
        "why": "Gauge Search Console traffic risk before a go-live or high-visibility change.",
        "look_for": [
          "high-traffic paths",
          "sudden drops after similar changes"
        ],
        "available": true
      },
      {
        "kind": "tool",
        "id": "journey_metrics",
        "tool": "get_product_funnel_analytics",
        "why": "Optional: product journey page performance (GA4) before applying selling/funnel changes.",
        "look_for": [
          "weak journey stages",
          "path sessions vs conversions"
        ],
        "available": true,
        "args_hint": {
          "slug": "full-stack-miami"
        }
      }
    ],
    "non_effects": [
      "Following discovery_path is optional; skip does not unlock or block update_proposal.",
      "discovery_path is not next_actions — do not treat items as required tool calls."
    ]
  },
  "warnings": [
    {
      "code": "figure_variable_tokens",
      "message": "Outcome figures turned on by variable tokens: global.price_fullstack, global.hire_rate. Check each is the right fact with list_variables."
    }
  ]
}
```
<!-- /mcp-example -->

**What to notice:**

- **Think items come first.** They are judgment checklists, not tool calls. "Verify every outcome figure" leads because this proposal changes numbers.
- **Tool items come second**, each with `why` (reason to call it), `look_for` (what would change the decision) and `args_hint` (arguments already filled in for this page).
- **`figure_facts` is the outcome-figures step.** It points `list_variables` at the two variables the proposal uses, so the agent can check they are the right facts for this page's audience. When a proposal types numbers by hand instead of using variables, the hint is `{ "figures_only": true }` and the agent checks the whole figures catalog.
- **Traffic tools follow the risk.** A page that sells gets Search Console risk and product funnel analytics; a plain article would get general analytics instead.
- `non_effects` says it twice on purpose: following the menu is optional, and it is not `next_actions`.

**What the agent does next:** usually reads the page and checks the variables, then decides. If a number disagrees with the site facts catalog, it adds a blocker instead of applying.

### 5. The agent's role is missing a tool

Same proposal, but the agent connects with a role that cannot call `list_variables`. The step does not disappear. It stays in the menu, marked unavailable, with a hint for the human. Only the changed item is shown; the `"…"` entries stand for the rest of the menu, which is unchanged.

<!-- mcp-example:discovery_capped -->
```json
{
  "discovery_path": {
    "items": [
      "…",
      {
        "kind": "tool",
        "id": "figure_facts",
        "tool": "list_variables",
        "why": "Outcome figures are on — check proposed prices, hire rates and ratings against the site facts catalog (the approved source).",
        "look_for": [
          "token → is it the right variable for the claim (monthly vs full price, region vs sitewide)",
          "hardcoded figure that varies by region → add_blocker asking for the token, unless it equals literal_ok for this page",
          "… +2 more"
        ],
        "available": false,
        "hint": "This tool is not on your MCP role. Ask a human to enable the needed access, then refresh/reconnect the MCP connector.",
        "args_hint": {
          "names": [
            "global.price_fullstack",
            "global.hire_rate"
          ],
          "context": {
            "entry": {
              "contentType": "landing",
              "slug": "full-stack-miami",
              "locale": "en"
            }
          }
        }
      },
      "…"
    ]
  },
  "warnings": [
    {
      "code": "figure_variable_tokens",
      "message": "Outcome figures turned on by variable tokens: global.price_fullstack, global.hire_rate. Check each is the right fact with list_variables."
    },
    {
      "code": "discovery_tool_capped",
      "message": "One or more discovery research tools are not available on this role. See discovery_path items with available:false — ask a human to enable access, then refresh MCP."
    }
  ]
}
```
<!-- /mcp-example -->

**What to notice:** `available: false` plus `hint`, and an extra `discovery_tool_capped` warning. Hiding the tool would let the agent believe the check does not exist.

**What the agent does next:** either asks the human for access and reconnects, or reviews the other items and says which check it could not run. Skipping it still does not block apply.

### 6. A steward has paused the proposal

A Platform Steward put the proposal on hold. The menu collapses to a single think item that tells the agent to keep its hands off.

<!-- mcp-example:steward_hold -->
```json
{
  "discovery_path": {
    "goal": "Steward hold — agents must not mutate this proposal. Skip discovery tools until released.",
    "items": [
      {
        "kind": "think",
        "id": "steward_hold",
        "title": "Respect the steward hold",
        "why": "Escalate freezes all MCP update_proposal actions until a Platform Steward releases it in the staff UI.",
        "look_for": [
          "steward note: Price change is waiting on finance sign-off. Do not touch until released.",
          "do not claim, add_blocker, apply, reject, or revise"
        ]
      }
    ],
    "non_effects": [
      "Following discovery_path is optional; skip does not unlock or block update_proposal.",
      "discovery_path is not next_actions — do not treat items as required tool calls."
    ]
  },
  "warnings": [
    {
      "code": "proposal_escalated",
      "message": "A steward paused agent work on this proposal. Do not call update_proposal until they release the hold. Note: Price change is waiting on finance sign-off. Do not touch until released."
    }
  ]
}
```
<!-- /mcp-example -->

**What to notice:** no tool items at all, the steward's note is quoted, and the `proposal_escalated` warning repeats the rule in structured form.

**What the agent does next:** nothing on this proposal. It reports the hold to the human and moves on.

---

## Keeping this page honest

The JSON blocks are generated by `scripts/docs/mcp-response-examples.ts`, which calls the same helpers the MCP tools use (`resolveLayoutTargetGate`, `sharedStructuralEnvelope`, `buildProposalDiscoveryPath`, and the envelope helpers in `mcp-server/lib/respond.ts`).

- After changing any of those responses, run `npm run docs:mcp-examples` to rewrite the blocks.
- `npm test` fails when a block no longer matches what the server produces.
- Edit the prose freely. Do not hand-edit inside `<!-- mcp-example:… -->` markers; the next run overwrites it.
