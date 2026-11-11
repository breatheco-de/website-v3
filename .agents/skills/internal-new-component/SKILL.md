---
name: internal-new-component
description: "Workflow for adding a section component or variant to this multi-site marketing platform: reuse check, written spec approved in chat, registry + variant TSX build, verification. Use when asked to build, add or create a section/component/variant, or to build one from a picture, screenshot, mockup or Figma frame."
---

# New section component

Four steps, in order. Do not write code before step 2 is approved.

1. **Reuse check** — can existing types already do this?
2. **Shape** — written spec in chat; the user approves it.
3. **Build** — registry files, variant TSX, examples.
4. **Verify** — schema sync, build, tests, preview.

---

## 1. Reuse check

Read what exists before proposing anything new:

- Registry metadata: `shared/component-registry/<type>/v1.0/schema.yml` and `site_<name>/component-registry/<type>/v1.0/schema.yml` (`when_to_use`, `variants.*.best_for` / `avoid_when` / `content_shape`).
- Or MCP: `list_components`, `get_component_schema`, `get_component_variant`.

Decide one of:

| Outcome | When |
|---|---|
| **YAML only** | An existing type + variant already renders the picture with the right props. Write the section YAML; no code. |
| **New variant of an existing type** | The layout family exists (hero, features grid, testimonials, pricing…) but the arrangement differs. Preferred over a new type. |
| **New type** | No existing family fits. |

### Shared library or site library

| | Shared (`shared/component-registry/`, app repo) | Site (`site_<name>/component-registry/`, content repo) |
|---|---|---|
| Who sees it | Every site's picker | That site, plus sites with `inherit_components_from: <that site>` in `sites.yml` |
| Use for | Simple platform components every site needs (spacer, breadcrumb, faq, text_block, article…) | Anything brand- or site-specific |
| Colors | **Base palette IDs only** (see Design system) | Any ID in the target site's theme |
| Examples | Must render on any site (no single-site image without fallback) | Site content |

- Never both: the same type in both trees fails at boot (`assertNoRegistryCollisions`).
- A new variant of a shared type appears on every site.
- TSX lives in `client/src/components/<type>/variants/` for both.
- **Hero exception:** the shared `hero` holds many 4geeks-specific variants today. Do **not** add new variants to the shared hero; in the spec, propose them as site variants (pending the hero extension plan).

---

## 2. Shape (written spec, approved before code)

Post this in chat and wait for approval. For a picture, map everything to tokens; never copy pixel colors.

1. **Type and variant** — `type: snake_case`, `variant: camelCase`; shared or site (which site); reuse decision from step 1.
2. **Props table** — field, type, required, example. Every visible string, image, icon, URL comes from a prop.
3. **Media and actions** — image fields (`image-picker` / `image-with-style-picker`), CTAs (`cta-picker`, tracking if ecommerce), icons (Lucide names).
4. **Colors** — each color in the picture mapped to an ID in the target site's `theme.json` (`backgrounds`, `text`, `accents`, `courses`). If the site has no `theme.json`, use its `inherit_components_from` parent's file. Section background is a section setting, not a component prop.
5. **Typography** — headings to `text-h1` / `text-h2`, body to `text-body` / `text-base`, metadata to `text-sm` / `text-xs`.
6. **Spacing** — outer spacing via the section's `paddingY` / `marginY` (presets `none` 0, `sm` 16, `md` 32, `lg` 64, `xl` 96 px); only inner gaps live in the component.
7. **Mismatches** — anything in the picture that cannot match the brand (off-palette colors, custom fonts, effects) and what you will use instead.

---

## 3. Build

### Files

| File | Notes |
|---|---|
| `<registry>/<type>/v1.0/schema.ts` | Zod. One schema per variant, unified with `z.union` / `z.discriminatedUnion`. Include `type: z.literal(...)`, `version: z.string().optional()`, `variant`. Source of truth for fields. Shared schemas may import only `shared/component-registry/_common`. |
| `<registry>/<type>/v1.0/schema.yml` | Metadata for MCP, picker and validators. Synced from `schema.ts`; hand-written docs are preserved. |
| `<registry>/<type>/v1.0/field-editors.ts` | A file (not a folder). `fieldEditors: Record<string, EditorType>`. |
| `<registry>/<type>/v1.0/examples/*.yml` | `name`, `description`, `yaml` (a `sections:` string). At least one per variant; set `paddingY` here, not in the TSX. |
| `client/src/components/<type>/variants/<PascalType><Variant>.tsx` | One file per variant. Default variant = `<PascalType>Default.tsx`. |

`<registry>` is `shared/component-registry` or `site_<name>/component-registry`.

**Registration is automatic.** `client/src/components/sectionRegistry.ts` globs `./*/variants/*.tsx` and maps `HeroCourse.tsx` → `type: hero`, `variant: course` (variant matching ignores case, `-` and `_`). Do not edit `SectionRenderer.tsx` to register sections. The "Add component" picker reads `/api/component-registry`, so a valid `schema.yml` is enough to appear there.

**New type only:**

- `client/src/components/DebugBubble/utils/componentCatalog.ts` — add `{ type, label, icon, description }` (lucide icon import).
- `client/src/components/editing/ComponentPickerModal.tsx` — add the type to `iconMap` (lucide import; falls back to `Blocks`).
- Types for the TSX: shared types re-export from `shared/schema.ts`. Site types declare their prop interfaces locally in the TSX (as `VerticalBarsCardsDefault.tsx` does); do not add new re-exports to `shared/schema.ts` / `shared/site-component-schemas.ts` (legacy bridge, see `.cursor/rules/registry-content-sync.mdc`). Never import `site_*` paths from client code.

### schema.yml shape

Template: `shared/component-registry/spacer/v1.0/schema.yml`.

```yaml
name: My Component
version: "1.0"
component: MyComponentDefault
file: client/src/components/my_component/variants/MyComponentDefault.tsx
description: One sentence.
when_to_use: |
  When to pick it, and when a sibling type is better.
layout:
  # flow: out          # only for fixed/floating sections (modal, sticky bar)
  # self_padded: true  # only if the component must paint its own vertical padding (true | [variant names])
  # edge: top_of_page  # only for sections that must sit first on the page
# behaviors:           # when applicable, see "Behaviors" below
variants:
  default:
    description: Short layout description
    content_shape:
      image: required   # required | optional | unused
      icon: unused
      items:
        cards: { min: 3, max: 6 }
    best_for: The job this variant does best.
    avoid_when: When another type/variant fits better.
    metadata_status: draft
props:
  title:
    type: string
    required: true
    description: Main heading
    example: "Why choose us"
```

### Section wrapper owns background and vertical spacing

`getSectionWrapperStyles` in `client/src/components/SectionRenderer.tsx` applies the section's `background`, `paddingY` and `marginY` (default 0) around every component.

- Do **not** put section-level `py-*` / `pt-*` / `pb-*` / `my-*` / `mt-*` / `mb-*` on the component root (or on its first child unless that child is a card), and do not paint `data.background` in the TSX. Inner spacing (gaps, card padding) is fine.
- `npm run check:section-spacing` enforces this on commit, build and `npm test`. If the design truly needs its own vertical padding, add `// section-spacing: self-padded` to the variant file and list the variant under `layout.self_padded` in schema.yml (overlays use `// section-spacing: overlay` with `layout.flow: out`).
- Examples and page YAML carry `paddingY` (preset or px, `"lg xl"` = top/bottom, or `{ mobile, desktop }` switching at 768px).
- Leave `layout.self_padded` unset unless the component truly paints its own vertical padding.
- Reference: `client/src/components/vertical_bars_cards/variants/VerticalBarsCardsDefault.tsx` (no outer padding; spacing comes from the section).

### TSX rules

- One `data` prop typed to the section schema. **No hardcoded content** — all visible text, images, icons, URLs come from props.
- Semantic Tailwind tokens only (`bg-card`, `text-foreground`, `text-muted-foreground`, `bg-primary`…). No `bg-blue-500`, no hex.
- Icons: Lucide via `getIcon(name)` from `@/lib/icons` for YAML-driven icons (`"rocket"`, `"brain"`); `lucide-react` imports for fixed UI chrome (chevrons, close). Legacy `IconRocket`-style YAML names still render, but write Lucide names in new content. No emoji.
- Images: `UniversalImage` (registry `image_id`). Video: `UniversalVideo`. No raw `<img>` / `<video>`.
- Buttons: shadcn `<Button>` (`default`, `secondary`, `outline`, `ghost`, `destructive`; YAML `primary` maps to `default`), default `rounded-md`. Badges `rounded-full`.
- Hover: `hover-elevate` / `active-elevate-2` on non-Button elements; no custom hover on Button/Badge.
- Any box with a visual background has inner padding (`p-card-padding` 24px or `p-4`/`p-6`).
- `data-testid` on interactive and meaningful display elements.

### Field editors

Common `EditorType` values (reuse; only add a new editor when the user asks):

| EditorType | Purpose |
|---|---|
| `icon-picker` | Lucide icon (saves the slug) |
| `color-picker` | Theme ID from the site theme (`color-picker:text`, `:courses`, `:accent`) |
| `image-picker` / `image-picker:logo` | Image from the registry |
| `image-with-style-picker` | Image plus position/style |
| `link-picker`, `video-picker`, `text-input` | URL, video, plain text |
| `rich-text-editor`, `markdown` | Formatted text |
| `boolean-toggle`, `string-picker:a,b,c` | Flags and fixed options |
| `cta-picker`, `cta-tracking` | CTA button; ecommerce CTA intent |
| `font-size-picker`, `form-settings` | Theme font size; lead form config |
| `form-appearance:<role>` | How a form looks and what it says, grouped in one Props tab Form box |

Components with a form tag their look-and-copy keys with `form-appearance:<role>` instead of loose pickers. Roles (catalog: `shared/form-appearance.ts`): content `title`, `subtitle`, `disclaimer`, `image`, `submit-label`, `login-link`, `cta-text`, `cta-url`, `cta-style`, `cta-icon`; style `background`, `text-color`, `terms-color`, `button-style`, `layout`, `vertical-align`. Example: `"form_background": "form-appearance:background"`, `"form.button_variant": "form-appearance:button-style"`. Conversion config stays on `form-settings` (Forms tab); never tag it with a role. Skip `layout` when one `form.variant` key drives more than one placement, or when `variant` is the section variant (lead_form).

Key paths: bare key for top-level (`layout`), `"items[].icon"` for array children, `"variant:items[].icon"` or `"variant:title"` to scope to one variant. Dot-star (`items.*.icon`) and plain dots into arrays are silently ignored; array-of-array is unsupported.

### Behaviors

- `form-settings` editor → `behaviors.conversion`. `dynamic_entries` listing → `behaviors.listing`. SSR schema.org → `behaviors.schema_org`. Ecommerce funnel/catalog or `cta-tracking` → `behaviors.ecommerce`.
- Duplicating a page/section clears `conversion_name`, `ecommerce_products` and CTA `tracking`; staff re-set them.
- See `docs/component-behaviors.md` and `.cursor/rules/component-behaviors.mdc`.

---

## 4. Verify

1. `npm run schema:sync -- --component=<type>` (then fill `best_for` / `avoid_when` / `content_shape` if sync left gaps). `npm run ensure:schema-yml` also runs on `predev` / `prebuild`.
2. `npm run build` (its `prebuild` runs `check:section-spacing`); related vitest (`npx vitest run <path>`).
3. Ask the user to check the example in the running app (`npm run dev`); do not start the dev server yourself.
4. MCP, when the server runs the new code: `create_component_section_demo` for a demo page; `review_page_render` needs a public `SITE_URL`.
5. Site-registry files (`site_*`) must be pushed to the content repo with a commit SHA (`.cursor/rules/site-content-github.mdc`). Shared-registry and TSX files are app-repo changes (commit only when asked).

---

## Design system

Colors are per site; type, spacing and radius are app-wide.

### Colors — from the site theme

- Source: the target site's `site_<name>/theme.json` (`backgrounds`, `text`, `accents`, `courses`, `colors.light` / `colors.dark`). A site without its own file uses its `inherit_components_from` parent's. Do not assume universal hex values; `client/src/index.css` holds fallback defaults only.
- In code, use semantic token classes. In YAML, use theme IDs (`background: light-blue-5`); the agent theme gate rejects raw CSS colors.
- **Shared base palette** (shared components and shared examples may only use these background IDs; every theme keeps them): `background`, `muted`, `card`, `primary`, `secondary`, `accent`, `light-blue-5`, `light-blue-5-gradient`, `hero-orbit-gradient`. Source: `SHARED_BASE_PALETTE` in `shared/theme-palette.ts`.
- Never use a text color (`foreground`) as a background. No opacity / `rgba` on text; use `muted-foreground` for softer text. Background transparency only via existing theme entries (e.g. `light-blue-5`); do not invent new levels.

### Color philosophy (4geeks sites)

- Formal, near-monochromatic: backgrounds `background` / `muted` / `card` / `light-blue-5`; text `foreground` / `muted-foreground`; `primary` for interactive elements, icons and thin highlights.
- Prefer a subtle tint (`light-blue-5`) over bold or dark backgrounds to differentiate.
- `accent` (yellow) at most once per component.
- Exception: when several programs/courses render side by side, each may take one identity color from the theme's `courses` list (icon, thin bar, link text — not full card backgrounds), consistently across components.

### Typography (app-wide)

- Fonts: `font-heading` (headings) and `font-sans` (body), set by CSS variables in `client/src/index.css`.
- Scale: `text-h1` (50px), `text-h2`, `text-body` (16px) in `tailwind.config.cjs` (the `.text-h2` utility in `index.css` is 40px; the Tailwind token is 30px — use the one the sibling components use).
- `text-base` for descriptions (do not shrink meaningful copy to `text-sm`), `text-sm` for supporting metadata, `text-xs` for fine-print labels. Data values (numbers, salaries) are sized up.

### Spacing and radius (app-wide)

- Section spacing presets (`SPACING_PRESETS` in `SectionRenderer.tsx`): `none` 0, `sm` 16, `md` 32, `lg` 64, `xl` 96 px.
- Tailwind: `section` 64px, `card-padding` 24px.
- Radius: `rounded-card` 12px for cards, `rounded-lg` 9px, `rounded-md` 6px (buttons), `rounded-sm` 3px. `shadow-card` for cards.

### Icons and accents in layouts

- Icons without a background wrapper by default, max `w-8 h-8` in cards/lists. Exception: sparse items (icon + one line) may use a subtle tinted wrapper.
- Accent bars stay thin: `w-0.5` / `w-1` vertical, `h-px` / `h-0.5` horizontal.

---

## Naming

- YAML `type` and registry folder: `snake_case` (`graduates_stats`).
- Variant: `camelCase` in YAML (`fullBleed`); file suffix `PascalCase` (`GraduatesStatsFullBleed.tsx`).
- Schema exports: `camelCase` + `Schema` (`graduatesStatsSectionSchema`); types `PascalCase` + `Section`.

## Common pitfalls

- Adding outer `py-*` or painting `data.background` in the component (double padding with the section wrapper).
- Hex / Tailwind palette colors, or color IDs that are not in the target site's theme.
- Writing code before the spec is approved.
- Adding a variant to the shared hero.
- Importing `site_*` registry files from client code, or adding new site re-exports to `shared/schema.ts`.
- Editing `site_*` files without pushing them to the content repo.
