# Design (designing a page)

Call this topic before building or restructuring a page layout: which tools to call in what order, theme colors, layout traits, recipes learned from approved pages, render review, and the publish gate.

Component fields / variants → `get_component_schema`, `get_component_variant`. Section mechanics (SectionRenderer, CTA hashes) → topic `sections`. Shared layouts (blog, templates) → topic `shared-layout`.

## The loop (entry-owned pages: landing, downloadable, detached entries)

1. **`get_page_recipe`** `{ contentType, stage?, locale?, intent? }` — skeleton slots (presence, required, 2–3 `type:variant` + background + spacing options with example pages), top layouts, variant pairings, out-of-flow add-ons, learned rules. `fallback: "site_wide"` = fewer than 3 layouts in scope; treat as a start and lean on screenshots.
2. **`get_component_variant`** for each slot you pick — fields + worked example. Check the variant's `best_for` / `avoid_when` / `content_shape` (item counts, text lengths, image use measured on live pages) against your content. Shape mismatch → pick another option.
3. **`create_page_demo`** (optional) — throwaway multi-section page from ad-hoc YAML to compare options before writing a draft. Demos are not entries; nothing goes live.
4. Write the draft: `create_entry` / `replace_entry_sections` / `add_section`.
5. **`review_page_render`** `{ source: "entry", contentType, slug, locale, variant? }` → poll **`get_render_review`** (`include_images: true` for screenshots, `crop_section` to zoom). Fix findings (`fix_hint` per section) and re-review.
6. `run_entry_diagnostics` — the `design` validators (`backgrounds`, `rich-text-styles`, `design-layout`) and the render review write into the same issue list.
7. `publish_draft` / `promote_variant`.

## Template entries (`layout_owner: shared_template`)

`get_page_recipe` with `slug` returns `mode: "fields"`: the template owns the sections; you fill the bound fields (`fields[].field` → which template sections render it). Do not add or reorder sections on the entry. Changing the layout = edit `template.{locale}.yml` (affects every attached entry; `confirm_affected_entries`) or a staff-approved detach. A render review is still useful (long titles, missing images) but publishing is not gated by it.

## Theme colors (blocking for agents)

- Section `background` must be a **theme ID** from the site theme (e.g. `light-blue-5`), never CSS (`#fff`, `hsl(...)`, Tailwind classes).
- Site theme = the site's own `theme.json`; a site without one uses its `inherit_components_from` parent's file (whole file, no merge). Allowed IDs come from that file. Shared components (`shared/component-registry/`) only use the shared base palette (`SHARED_BASE_PALETTE`: background, muted, card, primary, secondary, accent, light-blue-5, light-blue-5-gradient, hero-orbit-gradient).
- Rich text must not hardcode inline `color`, `font-size`, `letter-spacing` outside the theme text palette / sizes.
- Agent writes or publishes that **add or change** an off-theme value fail with `theme_colors_required` (`property_path`, allowed IDs). Values already on the page (staff overrides) never block you. Staff edits only warn.

## Layout traits (facts in component `schema.yml` → `layout:`)

| Trait | Meaning | What to do |
|---|---|---|
| `flow: out` | Floats outside the page (schema_org, modal, sticky bar, contact bubble) | Ignore it for spacing/adjacency; never give it `background` / `paddingY` / `marginY` (paints an empty strip) |
| `self_padded` (true or variant list, matched ignoring `-`/`_`/case) | Variant paints its own vertical padding | No wrapper `paddingY` (double padding); use `marginY` for distance |
| `edge: top_of_page` | Designed to be the first visible section (heroes) | Put it first |

Section vertical padding is wrapper-owned: variants no longer add their own outer `py-*` (only `self_padded` variants do). A new section has 0 padding unless you set `paddingY` (or insert from a registry example, which carries it). Values: preset (`none` 0, `sm` 16, `md` 32, `lg` 64, `xl` 96), px, or `"top bottom"`; `mobile` inherits `desktop` when missing. The rule is enforced in code (`npm run check:section-spacing` on commit, build and tests): variant files that pad themselves carry `// section-spacing: self-padded`, overlays `// section-spacing: overlay`.

Spacing taste is **not** hardcoded: it is learned (below) and checked by screenshots.

## Recipes and weights (component insights)

One learning system: component insights scans live pages (default locale first; drafts, A/B variants and overlays excluded). A shared template counts as **one** layout (its attached pages are reach, not votes).

Weight per layout = manual `insights_weight` × approval × performance × relevance × locale:

- **Approval:** staff-approved ×2; trusted (staff-published, structure unchanged 30 days) ×1.2; "not a good example" ×0. Approval pauses when the section structure changes (copy edits keep it).
- **Performance:** GA4 export, last 90 days: (actual + 5) / (expected + 5), clamped 0.5–1.5. Expected = sessions per channel × that channel's site rate for the same content type and funnel stage (campaign rate when a campaign feeds 2+ pages). Actual = leads + checkouts on decision pages, engaged sessions otherwise.
- **Relevance (per request):** same content type 1.0 / other 0.3; same funnel stage 1.0, adjacent 0.5, other 0.25. **Locale:** requested language 1.0, others 0.2.

## Learned layout rules

Candidate rules (colored sections carry padding, no stacked same color, open with a top-of-page section, no back-to-back same component) become **active** when ≥5 approved/trusted pages follow them ≥80% of the time. Staff can pin (always enforce) or disable a rule (`design-rules.yml` at the site root; agents cannot pin). Active and pinned rules appear as warnings in `design-layout` diagnostics and render reviews, with evidence pages. Below the threshold they are suggestions in `get_page_recipe.learned_rules`.

## Render review and the publish gate

- Desktop + mobile full-page screenshots via Cloudflare Browser Rendering on a signed preview URL, plus measured findings per section (content touching a color edge, horizontal overflow, tight gaps, heading order / multiple H1, broken images, empty sections, learned-rule breaks).
- Horizontal overflow counts only content a visitor can scroll to: a carousel track clipped by its own container is not a finding. A page-level overflow (`section_path` null) means the whole page scrolls sideways and is always reported.
- The preview loads every section's code first (about 10 s cap). `section_not_loaded` = the code did not arrive in time (re-run the review; not a content problem). `section_unknown_type` = no component exists for the section `type` (fix the type; re-running will not help). Neither is reported as `empty_section`.
- Findings stay in the issue store until the page is reviewed again, so older reviews may still list carousel overflow or empty sections that newer reviews no longer report.
- **Gate (agents only):** publishing a new or detached entry-owned page, or one whose section structure changed vs live, requires a review of the exact draft structure → otherwise `action_required` `render_review_required`. Copy-only changes, template entries and staff publishes are not gated.
- Cloudflare or a public `SITE_URL` not configured → the gate only warns (`render_review_unavailable`) and you continue.
- Reviews are cached by page + structure; re-run after structural edits.
