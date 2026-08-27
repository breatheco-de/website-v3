# Sections

Every page on the site is built from a list of section objects. Sections are authored in YAML, stored in content files, and rendered dynamically by `SectionRenderer`.

## How sections work

A page's YAML file contains a top-level `sections` array:

```yaml
sections:
  - type: hero_twoColumn
    variant: default
    title: Learn AI Engineering
    subtitle: Build real-world skills
    image_id: hero-ai-01

  - type: features_quad
    variant: grid
    title: What you'll learn
    items:
      - title: Python
        description: Industry-standard language for AI
```

Each section object must have a `type` field that maps to a registered React component. The `variant` field selects which visual variant of the component to render (defaults to `default` if omitted).

## SectionRenderer

`client/src/components/SectionRenderer.tsx` maps section types to React components. When the `type` field matches a registered key, it renders the corresponding component with the YAML object as props.

To add a new section type you must:
1. Create the React component in `client/src/components/sections/`
2. Register the component type in `SectionRenderer`
3. Add a schema entry in `shared/component-registry/<type>/v1.0/schema.yml` (platform default) or `{content_folder}/component-registry/<type>/v1.0/schema.yml` (site-only)
4. Add example YAML next to that schema

## Component registry

Two trees that must not share a `type` name: `shared/component-registry/` (platform defaults) and `{content_folder}/component-registry/` (site-only; folder from `sites.yml`). Resolve for a site = shared ∪ that site. Each component has:

```
component-registry/
  <component-type>/
    v1/
      schema.yml    # component description, props, variants
      example.yml   # example YAML usage
```

The schema defines:
- `name` — human-readable component name
- `description` — what the component does
- `when_to_use` — guidance for content editors
- `variants` — map of variant names to descriptions and `best_for` text
- `variant_props` — per-variant prop definitions

## Variants

A single component can have multiple visual layouts controlled by the `variant` field in YAML. For example, `features_quad` might have `grid`, `list`, and `carousel` variants. Always consult the component schema (via the `get_component_schema` MCP tool) before writing a section to understand which variants are available.

## Split articles (always one reading experience)

Long-form pages often insert a CTA between two halves of an article. Use **two (or more) `article` sections** on the same page rather than one oversized block.

**Invariant:** 2+ `article` sections on a page **always** continue one piece. There is no “keep separate TOC” option and no user-facing share property.

| Concern | First article (page order) | Later articles |
|--------|----------------------------|----------------|
| Reading time + meta (tags/category) | Combined reading time over all article bodies | Never shown |
| TOC on/off | Only this article’s `show_toc` controls the shared TOC | `show_toc` is a non-effect |
| Mobile / top TOC | Shown when TOC enabled | Never |
| Desktop side TOC | Shown when TOC enabled | Still shown when TOC enabled |
| OG / preview reading time | Combined article bodies | — |

- Put the **lead** article first in `sections` order.
- Prefer `show_toc: true` and `toc_position: side` on the first article only.
- `toc_group` may still appear in YAML for heading-id stability — agents should not treat it as a share decision.
- See `get_component_variant` → article example `article_split_toc_group`.
- `add_section` / replace may return `article_split_always_share`, `article_lead_toc_misconfigured`, or `article_lead_order_suspicious` with `next_actions`.

## Shared-layout content types

Types with `database.slug` **or** `single_template: true` (e.g. static `blog`) render sections from shared `template.{locale}.yml` (plus optional per-entry overlays when detached; legacy `single.*` still loads). Changes to the shared template affect **all attached** entries. Per-entry YAML **does** exist for static shared-layout types (`_common.yml` + `{locale}.yml`) and holds locale fields such as `title` / `content` — not a full page shell. See `explain_site` topic `shared-layout`.

## In-page CTA / link URLs

CTA and link `url` fields accept more than page paths. Runtime: `client/src/hooks/useInternalNav.ts`. Modals: `client/src/components/modal/variants/ModalDefault.tsx` (opens when `location.hash` equals the modal’s `section_id`).

| `url` value | Effect |
|---|---|
| `#section_id` | If target section `type: modal` → open overlay; else smooth-scroll to that section |
| `#top` / `#bottom` | Scroll to top or bottom of the page (built-ins — not YAML `section_id`s) |
| `inline#section_id` | Render that section inline (no navigation) |
| `/en/…` or `/es/…` | Internal page navigation |
| `https://…` | External link |
| `#section_id?key=val` | Hash target + merge query params into the current URL |

**Rules for agents:**

- A `type: modal` section **must** have an explicit `section_id`. Without it, `#…` cannot open the modal. `add_section` / `replace_entry_sections` may return `modal_missing_section_id`.
- Prefer an explicit `section_id` on scroll targets too. Runtime falls back to `{type}-{index}` (e.g. `hero-0`), but the `broken-anchors` validator only accepts anchors that match a YAML `section_id`.
- Wire CTAs with `url: "#that-exact-id"` (hash, not a path). Hyphens in the id are fine (`apply-modal`).

```yaml
sections:
  - type: hero
    # …
    data:
      cta_button:
        text: Apply now
        url: "#apply-modal"
        tracking: none

  - type: modal
    section_id: apply-modal
    heading: Apply
    form: { … }
```

Staff LinkPicker (Modal / Section / inline) writes the same schemes. Schema discovery: `get_component_schema` → `modal`; CTA `url` describe on shared CTA button schema.

## Images in sections

Always reference images by `image_id` (registry ID), never by raw path. The `UniversalImage` component resolves the ID at render time. See the `images` topic for details.

## Safe YAML loading

Sections may contain template variables like `{{ entry.title }}` (legacy `{{ single.title }}` still resolves on delivery; saves require `entry.*`). Always load section YAML through the safe loader (`safeYamlLoad` / `safeLoad`) — never raw `yaml.load()`. The `entry` namespace is the current entry’s field bag — not the shared shell filename `template.{locale}.yml`.

## Lead form submit routes

Lead forms (`lead_form` / embedded `form:` on hero, cta_banner, etc.) may include a top-level `routes` array on the form settings.

- **Trigger:** presence of `routes` (no `advanced` flag).
- **Match:** first route whose `conditions` all match (AND). Each condition is `field_property_slug` (form field name, e.g. `program`) + `value` (must equal the submitted value, e.g. program `bc_slug`).
- **Outcome:** may override `conversion_name`, `success` (`url` / `message`), `tags`, `automations`, `webhook`.
- **Fallback:** if nothing matches, root form props apply.
- **Precedence:** route match > form root > conversion event defaults (`resolveFormDefaults`).
- **Root `conversion_name`:** optional. Routes may set it per match; if neither root nor a matching route provides one, tracking is skipped (runtime console warning). Validators only reject *invalid* names when a name is set (root or route), not missing root.
- **Non-effects:** does not change field visibility or consents; does not add arbitrary payload keys beyond those overrides.
- **Side effects:** changes conversion tracking, webhook event resolution, and success redirect/message for that submit only.
- **Resolver:** `shared/resolveLeadFormRoute.ts`. Example: `site_4geeks-com/component-registry/lead_form/v1.0/examples/stacked_with_routes.yml`.
- **Next actions for agents:** add `routes` with `conditions`, ensure `value` matches submitted field values (`source.value_path`, typically program `bc_slug`). See topic `lead-forms`.

### Lead form Fields card (Conversion tab)

Staff UI lists keys already under form `fields` in YAML and edits `visible`, `required`, `default`, and `component_renderer` — no add/remove of field keys. Component: `client/src/components/editing/FormFieldsCard.tsx`.

**How it works:** Leave `component_renderer` unset to use LeadForm runtime defaults (`email`/`first_name`/… → `text`, `phone` → `phone`, `client_comments` → `textarea`, `program`/`plan`/`location`/`region` → `select`). Enum: `text` | `phone` | `textarea` | `select` | `cards` | `simple-list` | `grouped-list`. Rich layouts open a modal using the same menu dropdown components (`client/src/components/menus/Dropdown.tsx` with `onSelect`). Optional YAML `fields.*.options[]` (require `value`) merge over form-options/source pools for marketing label/description — programs have no content `description`. (`columns` is navbar-only — not a form renderer.)

**Non-effects:** does not add arbitrary field names to the runtime form; does not edit consents or routes; does not provide a UI editor for `options[]`. `options[]` does not filter the catalog. Which programs appear is `fields.*.source` + `query` — see `explain_site` topic `lead-forms`. `mergeLeadFormOptions` only overlays YAML labels.

**Agents:** field widgets live in `LeadFormFieldControl.tsx`. Catalog vs relation playbook: topic `lead-forms`. Example: `site_4geeks-com/component-registry/lead_form/v1.0/examples/stacked_with_routes.yml`. Schema: `leadFormFieldConfigSchema` in `site_4geeks-com/component-registry/_common/schema.ts`.
