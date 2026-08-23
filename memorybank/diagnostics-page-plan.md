# Diagnostics Page — Implementation Plan

> **Goal:** A private, self-service diagnostics page that scans all marketing content pages and reports SEO health, Schema.org correctness, content quality, and infrastructure integrity — eliminating the need for third-party audit tools.
>
> **Status:** IMPLEMENTED (all 6 steps complete)
> **Route:** `/private/diagnostics` (accessible via debug bubble)
> **Last Updated:** 2026-02-11

---

## 1. Existing Infrastructure (What We Build On)

### 1.1 Validation Framework (`scripts/validation/`)

A modular validation system with CLI and API support, built around a `ValidationService` singleton.

**Architecture:**
```
scripts/validation/
├── index.ts              # Re-exports all public APIs
├── service.ts            # ValidationService: context building, validator execution, result aggregation
├── cli.ts                # CLI entry point for batch scanning
├── shared/
│   ├── types.ts          # Core interfaces: ValidationIssue, ValidatorResult, ValidationContext, ContentFile
│   ├── contentLoader.ts  # Loads all YAML content files into ContentFile[]
│   ├── canonicalUrls.ts  # URL normalization and canonical URL generation
│   └── schemaRegistry.ts # Available Schema.org keys from schema-org.yml
└── validators/
    ├── index.ts           # Registry of all 11 validators + discovery utilities
    ├── meta.ts            # SEO meta: page_title, description, priority, change_frequency, robots
    ├── schema.ts          # Schema.org reference validation (checks refs exist in schema-org.yml)
    ├── redirects.ts       # Redirect conflicts, loops, self-redirects, content overwrites
    ├── sitemap.ts         # Sitemap-to-content coverage, orphaned entries, duplicates
    ├── components.ts      # Component registry: schema files, examples, versions
    ├── backgrounds.ts     # Theme compliance: background colors match theme.json
    ├── faqs.ts            # FAQ freshness: last_updated within 6 months
    ├── seo-depth.ts       # NEW: SEO title/description length, duplicates, OG image, canonical
    ├── schema-completeness.ts # NEW: Renders JSON-LD per page, validates fields, placeholders, FAQ coverage
    ├── images.ts          # NEW: Image registry integrity, missing files, orphaned entries
    └── content-quality.ts # NEW: Section structure, translations, empty fields
```

**Key Types:**
```typescript
interface ValidationIssue {
  type: "error" | "warning";
  code: string;
  message: string;
  file?: string;
  line?: number;
  suggestion?: string;
}

interface ValidatorResult {
  name: string;
  description: string;
  status: "passed" | "failed" | "warning";
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  duration: number;
  artifacts?: Record<string, unknown>;
}

interface Validator extends ValidatorMetadata {
  run(context: ValidationContext): Promise<ValidatorResult>;
}
```

**Validator Categories:**
| Category | Purpose |
|-----------|---------|
| `seo` | Search engine optimization checks |
| `integrity` | Data consistency and structural correctness |
| `content` | Content quality and compliance |
| `components` | Component registry integrity |

### 1.2 Existing API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/validation/validators` | List available validators with metadata |
| `POST` | `/api/validation/run` | Run all or specific validators |
| `POST` | `/api/validation/run/:name` | Run a single validator |
| `GET` | `/api/validation/context` | Get validation context info |
| `POST` | `/api/validation/clear-cache` | Clear validation cache |

### 1.3 Schema.org Infrastructure

- **`server/schema-org.ts`**: Loads `4geeks-com/schema-org.yml`, resolves locale-specific schemas, merges overrides
- **`server/ssr-schema.ts`**: Server-side JSON-LD injection into HTML responses
  - Parses routes to resolve content type, slug, locale
  - Loads raw YAML (merging `_common.yml` + locale file)
  - Generates JSON-LD `<script>` tags for Schema.org includes and auto-detected FAQ sections
  - `generateSsrSchemaHtml(url)` -> returns full JSON-LD HTML string

### 1.4 Content Index Singleton (`server/content-index.ts`)

- Indexes all `4geeks-com/` YAML on startup
- Tracks image usage via `imageUsage` Map (by image_id and src)
- `getImageUsage(imageId, imageSrc)` -> O(1) lookup returning files that use the image
- Auto-refreshes on file changes

---

## 2. New Validators (IMPLEMENTED)

### 2.1 SEO Depth Validator (`seo-depth`)

Goes beyond the existing `meta` validator with quantitative analysis.

**Checks:**
| Code | Severity | Rule |
|------|----------|------|
| `TITLE_TOO_SHORT` | warning | page_title < 30 chars |
| `TITLE_TOO_LONG` | warning | page_title > 60 chars |
| `DESCRIPTION_TOO_SHORT` | warning | description < 70 chars |
| `DESCRIPTION_TOO_LONG` | warning | description > 160 chars |
| `MISSING_OG_IMAGE` | warning | No og_image in meta |
| `MISSING_CANONICAL` | warning | No canonical_url in meta |
| `DUPLICATE_TITLE` | error | Same page_title used by multiple pages |
| `DUPLICATE_DESCRIPTION` | error | Same description used by multiple pages |

**Artifacts:**
- `pagesWithOptimalTitles`: count of titles in 50-60 char range
- `pagesWithOptimalDescriptions`: count of descriptions in 120-160 char range
- `titleLengthDistribution`: histogram of title lengths
- `duplicateTitles`: list of duplicated title values

**Implementation notes:**
- Operates on the same `ValidationContext.contentFiles` as the existing `meta` validator
- Complementary to `meta` (which checks existence), this checks quality/optimization
- Category: `seo`

### 2.2 Schema.org Completeness Validator (`schema-completeness`)

Collects JSON-LD via `server/page-schema-collect.ts` (`resolvePageSchemaDocuments`) and validates against the opt-in catalog in `shared/schema-org-jsonld-rules.ts`. Undeclared `@type` values are not field-checked.

**Per-type required fields (warnings):**

| `@type` | Required fields |
|---------|-----------------|
| `BlogPosting` | `headline`, `description`, `datePublished`, `author` |
| `Article` | `headline`, `description` |
| `Course` | `name`, `description` |
| `LocalBusiness` | `name`, `url` |
| `Person` | `name` and (`url` or `@id`) |

`image` on Article/BlogPosting is intentionally omitted (high volume).

**Checks:**
| Code | Severity | Rule |
|------|----------|------|
| `PAGE_NO_SCHEMA` | warning | Page has no schema.org section contributors |
| `SCHEMA_RENDER_ERROR` | error | `resolvePageSchemaDocuments()` failed for this page |
| `SCHEMA_INVALID_JSON` | error | JSON-LD document failed serialization |
| `SCHEMA_MISSING_HEADLINE` | warning | Declared type missing `headline` |
| `SCHEMA_MISSING_DESCRIPTION` | warning | Declared type missing `description` |
| `SCHEMA_MISSING_DATE_PUBLISHED` | warning | Declared type missing `datePublished` |
| `SCHEMA_MISSING_AUTHOR` | warning | Declared type missing `author` |
| `SCHEMA_MISSING_NAME` | warning | Declared type missing `name` |
| `SCHEMA_MISSING_URL` | warning | Declared type missing `url` (or Person `url`/`@id` group) |
| `SCHEMA_PLACEHOLDER_VALUE` | error | JSON-LD contains "TODO" or placeholder text |
| `FAQ_SECTION_NO_SCHEMA` | warning | Page has FAQ section but no FAQPage schema generated |

**Implementation notes:**
- Uses `ValidationContext.contentIndex` (site-scoped in diagnostics worker)
- Static + database-backed URLs share one collector (mirrors admin SSR)
- Source-aware suggestions (`article` vs `schema_org`) in warning text
- `INVALID_SCHEMA_TYPE` intentionally not implemented
- Category: `seo`

### 2.3 Image Integrity Validator (`images`)

Validates image references across the entire content system.

**Checks:**
| Code | Severity | Rule |
|------|----------|------|
| `IMAGE_REFERENCE_NOT_IN_REGISTRY` | error | YAML references an image id or src URL that does not match image-registry.json (no id key and no entry.src match) |
| `IMAGE_SRC_FILE_MISSING` | error | Registry entry points to file that doesn't exist on disk |
| `IMAGE_ALT_MISSING` | error | Registry entry has no alt text |
| `IMAGE_ALT_PLACEHOLDER` | warning | Alt text contains "TODO" or is auto-generated placeholder |
| `ORPHANED_REGISTRY_ENTRY` | warning | Image in registry but not referenced by any YAML content |
| `IMAGE_UNREFERENCED_FILE` | info | Image file exists on disk but is not in the registry |

**Implementation notes:**
- Uses `contentIndex.getImageUsage()` for usage lookups
- Loads `image-registry.json` directly for registry validation
- Scans disk for file existence checks
- Category: `content`

### 2.4 Content Quality Validator (`content-quality`)

Validates content completeness and cross-locale consistency.

**Checks:**
| Code | Severity | Rule |
|------|----------|------|
| `EMPTY_SECTIONS` | error | Page has empty or missing sections array |
| `SECTION_MISSING_TYPE` | error | A section in the array has no `type` field |
| `MISSING_TRANSLATION` | warning | EN page exists but ES counterpart missing (or vice versa) |
| `EMPTY_FIELD_VALUE` | warning | Critical field (title, heading, description) is empty string |
| `BROKEN_INTERNAL_LINK` | error | Link to `/en/...` or `/es/...` resolves to no content |

**Implementation notes:**
- Loads raw YAML to check section structure (not just meta)
- Uses `validUrls` set from ValidationContext for link checking
- Compares EN/ES folder pairs for translation coverage
- Category: `content`

---

## 3. Per-Page Diagnostics API (IMPLEMENTED)

### 3.1 Endpoint: `GET /api/diagnostics/page?url=/en/some-page`

Returns a comprehensive diagnostic report for a single page.

**Actual response shape (as implemented):**
```typescript
{
  url: string;
  contentType: string;
  slug: string;
  locale: string;
  filePath: string;
  title: string;
  meta: {
    page_title: string | null;
    titleLength: number;
    description: string | null;
    descriptionLength: number;
    og_image: string | null;
    canonical_url: string | null;
    robots: string | null;
  };
  schema: {
    configured: boolean;
    includes: string[];
    renderedJsonLd: object[];
    htmlPreview: string;
  };
  sections: {
    count: number;
    types: string[];
    hasFaq: boolean;
  };
  images: {
    referencedIds: string[];
    missingFromRegistry: string[];
    missingFromDisk: string[];
  };
  translations: {
    hasEnglish: boolean;
    hasSpanish: boolean;
    counterpartUrl: string | null;
  };
  redirects: {
    incomingRedirects: string[];
  };
  emptyFields: string[];
  score: {
    total: number;   // 0-100
    seo: number;     // 0-100
    schema: number;  // 0-100
    content: number; // 0-100
  };
}
```

**Deviation from original plan:** The `score.breakdown` detail array was omitted from the response for simplicity. The three category scores and total score are sufficient for the UI. Inline issue lists per section were also omitted — the Global Health tab serves as the detailed issue viewer.

### 3.2 Scoring System

Each check has a weight. Score = (sum of passed weights) / (sum of all weights) * 100.

**SEO Score (max 100):**
| Check | Weight | Criteria |
|-------|--------|----------|
| Has page_title | 20 | Present and non-empty |
| Title length optimal | 10 | 30-60 chars |
| Has description | 20 | Present and non-empty |
| Description length optimal | 10 | 70-160 chars |
| Has og_image | 10 | Present |
| Has canonical_url | 10 | Present |
| No duplicate title | 10 | Unique across all pages |
| No duplicate description | 10 | Unique across all pages |

**Schema Score (max 100):**
| Check | Weight | Criteria |
|-------|--------|----------|
| Schema configured | 30 | Has schema.include |
| Renders successfully | 20 | No render errors |
| Has name field | 15 | JSON-LD includes name |
| Has description field | 15 | JSON-LD includes description |
| No placeholders | 10 | No TODO values |
| FAQ schema if needed | 10 | FAQ section -> FAQPage schema |

**Content Score (max 100):**
| Check | Weight | Criteria |
|-------|--------|----------|
| Has sections | 25 | Non-empty sections array |
| All sections typed | 20 | Every section has type |
| Has translation | 20 | Both EN and ES exist |
| No empty fields | 15 | No empty critical values |
| Images valid | 20 | All image refs resolve |

### 3.3 Endpoint: `GET /api/diagnostics/pages`

Returns a summary list of all pages for the page selector.

**Actual response (as implemented):**
```typescript
{
  pages: Array<{
    url: string;
    title: string;
    locale: string;
    contentType: string;
    slug: string;
    filePath: string;
    hasMeta: boolean;
    hasSchema: boolean;
  }>;
  total: number;
}
```

**Deviation from original plan:** The pages list endpoint returns lightweight metadata only (no scores) since calculating scores for 127+ pages on every request would be expensive. Scores are calculated on-demand when a specific page is selected.

---

## 4. Frontend: Diagnostics Page (IMPLEMENTED)

### 4.1 Page Structure

**Route:** `/private/diagnostics` (lazy-loaded via PrivateRouter)
**File:** `client/src/pages/DiagnosticsPage.tsx` (~890 lines, self-contained)

**Two-tab layout:**

#### Tab 1: Global Health
- **Health Summary Bar**: 4 stat cards — Total Validators, Passed (chart-3 color), Warnings (chart-2 color), Failed (destructive color)
- **Filter bar**: Search input, severity filter (All/Errors/Warnings), category filter buttons (all, seo, integrity, content, components)
- **Validator Cards Grid**: Responsive (1 col mobile, 2 col md, 3 col lg)
  - Status badge (passed/warning/failed)
  - Error count, warning count, duration
  - Accordion expand to show individual issues with severity icon, code badge, message, file path, suggestion
  - Individual "Run" button per card
- **"Run All"** button at top with last-run timestamp

#### Tab 2: Page Analysis
- **Page selector**: Searchable dropdown of all pages, grouped by contentType, with click-outside handler
- **Score dashboard**: 4 circular progress indicators (Total, SEO, Schema, Content) using CSS `conic-gradient` with semantic CSS variables (`--chart-3`, `--chart-2`, `--destructive`)
- **Meta section Card**: Table of meta fields with title/description length bars
- **Schema section Card**: Configured status, includes list, JSON-LD preview in scrollable `<pre>` with `bg-muted`
- **Sections Card**: Count, types list, FAQ status
- **Images Card**: Referenced IDs with found/missing badges
- **Translations Card**: EN/ES badges with counterpart link
- **Redirects Card**: Incoming redirect list
- **Empty Fields Card**: List of fields with empty values

### 4.2 Technical Conventions

- Icons: `@tabler/icons-react` only (IconStethoscope, IconCheck, IconAlertTriangle, IconX, IconSearch, IconRefresh, IconArrowLeft, IconWorld, IconPhoto, IconCode, IconFileText, IconLayoutGrid)
- Colors: Semantic tokens only (`text-chart-3`, `text-chart-2`, `text-destructive`, `bg-muted`, `text-foreground`, `text-muted-foreground`)
- Score circle colors: CSS custom properties via `conic-gradient(hsl(var(--chart-3)) ...)` etc.
- Components: shadcn Card, Badge, Button, Tabs, ScrollArea, Accordion, Input
- Data fetching: TanStack Query with default fetcher (no queryFn), mutations via `apiRequest`
- Routing: wouter Link component
- `data-testid` on all interactive/meaningful elements
- Card border radius: 0.8rem
- No emojis

### 4.3 State Management

- TanStack Query keys:
  - `['/api/validation/validators']` — validator list
  - `['/api/diagnostics/pages']` — page list for selector
  - `['/api/diagnostics/page', selectedUrl]` — per-page deep dive (enabled only when URL selected)
- Mutations:
  - Run all: `POST /api/validation/run` with `{ includeArtifacts: true }`
  - Run single: `POST /api/validation/run/:name`
- Local state: selected tab, search term, severity filter, category filter, selected page URL, dropdown open state

---

## 5. Debug Bubble Integration (IMPLEMENTED)

Added a "Diagnostics" link with `IconStethoscope` to the debug bubble's navigation menu, alongside the Media Gallery link. Uses an `<a>` tag pointing to `/private/diagnostics`.

---

## 6. Implementation Order (ALL COMPLETE)

| Step | Task | Status |
|------|------|--------|
| 1 | Add 4 new validators (seo-depth, schema-completeness, images, content-quality) | DONE |
| 2 | Register new validators in `scripts/validation/validators/index.ts` | DONE |
| 3 | Create per-page diagnostics API (`/api/diagnostics/page`, `/api/diagnostics/pages`) | DONE |
| 4 | Build DiagnosticsPage.tsx (Global Health + Page Analysis tabs) | DONE |
| 5 | Register route in PrivateRouter.tsx | DONE |
| 6 | Add debug bubble link | DONE |

---

## 7. Files Created/Modified

**New files:**
- `memorybank/diagnostics-page-plan.md` -- this document
- `scripts/validation/validators/seo-depth.ts` -- SEO depth validator
- `scripts/validation/validators/schema-completeness.ts` -- Schema.org completeness validator
- `scripts/validation/validators/images.ts` -- Image integrity validator
- `scripts/validation/validators/content-quality.ts` -- Content quality validator
- `client/src/pages/DiagnosticsPage.tsx` -- Diagnostics page component

**Modified files:**
- `scripts/validation/validators/index.ts` -- Registered 4 new validators (11 total)
- `server/routes.ts` -- Added 2 diagnostics API endpoints
- `client/src/pages/PrivateRouter.tsx` -- Added lazy-loaded `/private/diagnostics` route
- `client/src/components/DebugBubble.tsx` -- Added diagnostics link with IconStethoscope

---

## 8. Known Limitations / Implementation Notes

- **Map/Set iteration**: TypeScript `downlevelIteration` is disabled in this project. All Map/Set iteration must use `.forEach()` or `Array.from()` instead of `for...of`.
- **ESM compliance**: `schema-completeness.ts` uses `await import()` (dynamic import) for `server/ssr-schema.ts` to maintain ESM compatibility.
- **Performance**: The `/api/diagnostics/pages` endpoint returns lightweight metadata without scores. Full scoring is only computed on-demand per page via `/api/diagnostics/page?url=X`.
- **No export button**: The original plan mentioned an "Export as JSON" button on the Global Health tab. This was not implemented in the MVP but could be easily added.

---

## 9. Non-Goals (Explicitly Out of Scope)

- Lighthouse-style performance auditing (requires headless browser)
- Accessibility (a11y) scanning (would need DOM rendering)
- External link checking (would need HTTP requests, too slow)
- Historical trend tracking (no database needed for MVP)
- Automated fix application (show suggestions only, let users fix manually)
