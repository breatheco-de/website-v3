# Images

All image content on the site goes through a centralized registry and a single `UniversalImage` component. Raw paths are never hardcoded in components or YAML files (with one documented exception).

## The image registry

`{content_folder}/image-registry.json` (from `sites.yml`) is the single source of truth for all images. Every image has a unique ID and metadata including:

- `src` — path relative to the project root
- `alt` — accessibility description
- `tags` — semantic categories (hero, logo, avatar, card, etc.)
- `preset` — which optimization preset to use

## Storage locations

<!-- @dynamic:image_storage -->
<!-- /dynamic -->

## How to reference an image in YAML

Always use the image ID:

```yaml
sections:
  - type: hero_twoColumn
    image_id: hero-ai-engineering-01
```

The `UniversalImage` component resolves the ID to the full registry entry and renders an optimized `<img>` with `srcset`.

## The UniversalImage component

`client/src/components/UniversalImage.tsx` is the **only** component that should render images. Never use:
- Raw `<img>` tags with hardcoded paths
- `<picture>` elements manually
- Any other image library

**Exception:** `HeroSingleColumn` uses `image: { src, alt }` object syntax (not `image_id`) and renders a direct `<img>` tag. It has a backward-compatible fallback to `UniversalImage` for legacy `image_id` data.

## Image presets

Presets define the optimization parameters applied to each image:

| Preset | Use case |
|---|---|
| `hero-wide` | Full-width hero images (16:9) |
| `hero-tall` | Vertical hero for mobile (9:16) |
| `card` | Card thumbnails (4:3) |
| `card-wide` | Wide card thumbnails (16:9) |
| `avatar` | Profile pictures (1:1) |
| `logo` | Company logos (variable ratio) |
| `icon` | Small icons (1:1) |
| `full` | Full-size, preserves ratio |

## Tag definitions

Images are tagged for semantic categorization. Tags include: `hero`, `logo`, `avatar`, `card`, `icon`, `photo`, `badge`, `partner`, `press`, `illustration`, `testimonial`, `team`, `award`.

## Adding a new image

1. Copy the file to `{content_folder}/images/` (new images) or `attached_assets/` (legacy only)
2. Add an entry to `image-registry.json` with a unique ID, `src`, `alt`, and appropriate tags
3. Reference the ID via `image_id` in YAML content files

## In-place replace

Staff can replace an existing gallery asset via Media Gallery → card menu → **Replace**, which calls `POST /api/image-registry/:id/replace`.

- Keeps the same registry **ID** (YAML `image_id` references do not change)
- Converts **images** to WebP before storage; rejects doctype switches (image/video/pdf)
- Returns **409** when the file bytes already belong to another ID — use that existing ID instead
- Regenerates srcsets in the background; does **not** cascade crop/resize children (`parentId`) — those must be re-cropped or replaced manually
- May rewrite YAML `src` paths only when the stored file path changes (e.g. `.png` → `.webp`)

## Agents (MCP)

Tool: **`get_or_set_media_to_gallery`** (formerly `get_or_set_image_to_gallery`). Pass **exactly one** of `media_id`, `url`, `prompt`, or `bytes_base64`.

| Source | Cap | Behavior |
|---|---|---|
| `media_id` | `content_view` | Returns the registry entry as `media` + `media_id`. No writes. |
| `url` (no `import`) | `content_view` | Lookup by `src` / `source_url`. Miss → `url_not_in_gallery` with next_actions to retry with `import: true`. |
| `url` + `import: true` | `media_upload` | Reuse if already in gallery; else fetch public URL (≤50 MB), strict type check, register (`origin=import`, stores `source_url`). No auth cookies — gated Drive/Dropbox fail. SSRF checked on every redirect hop. |
| `bytes_base64` + `filename` | `media_upload` | Decode and register (`origin=upload`). Decoded size ≤15 MB. Extension must be image/video/PDF. |
| `prompt` | `media_upload` | OpenRouter image gen with **n=1**, immediately registers as `origin=ai` (no confirm). Enqueues AI unused-image GC. |

Success payloads use **`media_id`** (not `image_id`) and nested **`media`**. Registry storage keys are unchanged.

**Non-effects:** does not set entry/section YAML (use `update_fields` after). Image schema fields may still be named `image_id` — pass the same id string. PDF/downloadable fields usually need the public **`src`**. Does not run `regenerate_entry_previews`. Does not touch Brand / schema-org.

**AI GC:** unused AI gallery assets may be removed after ~48h grace (last public impression, else `ai.generated_at`). Attach to live content soon if you need to keep the asset.

**Rate limits:** `prompt` calls `POST /api/media/generate-images` (`expensiveAi` policy). On limit the MCP tool returns `code: rate_limited` and `retry_after_sec` — do not retry in a loop. Failed generation (502/503) does not consume quota.

Optional: `alt`, `tags`, `aspect_ratio` (prompt), `site`, `import` (url), `filename` (bytes).
