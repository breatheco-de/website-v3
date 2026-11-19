# AGENTS.md

Entry point for coding agents (Cursor, Claude Code, Codex). Read this first, then the files it points to.

## What this repo is

A multi-site, content-driven marketing platform: Vite + React (SSR), Express, YAML content. Sites are listed in `sites.yml`; each has a content folder (`site_4geeks-com`, `site_4geeks-florida`, `site_business-4geeks`) that is gitignored here and synced to its own content GitHub repo. A site with `inherit_components_from` uses its parent's component registry and, when it has no `theme.json` of its own, its parent's theme.

## Where guidance lives

- Rules: `.cursor/rules/*.mdc` — start with `cursor-instructions.mdc` (architecture, content model) and `project-architecture.mdc` (aliases). Product personas: `product-audience.mdc` (1 persona → 1 product).
- Skills: `.agents/skills/` (also linked at `.claude/skills`). Building a section component or variant, including from a picture: `.agents/skills/internal-new-component/SKILL.md`.
- Design values: `design_guidelines.md` (pointer to the real sources).
- MCP server conventions: `mcp-server/agent-conventions.md`; append `mcp-server/agent-changelog.yml` when MCP docs or tools change.

## Hard rules

- **Content is YAML.** Pages, sections and copy live in `site_*` YAML; components render props and never hardcode content.
- **1 persona → 1 product.** Personas are product-owned; do not build shared/multi-product persona membership (`.cursor/rules/product-audience.mdc`, `mcp-server/explain/product.md`).
- **Colors are theme IDs** from the site's `site_<name>/theme.json` (or the parent's). No hex, no Tailwind palette colors, no raw CSS colors in YAML. Shared components use only the shared base palette (`SHARED_BASE_PALETTE` in `shared/theme-palette.ts`).
- **The section wrapper owns background and vertical spacing** (`background`, `paddingY`, `marginY` in section YAML). Components do not add outer `py-*` or paint `data.background`. Enforced by `npm run check:section-spacing` (pre-commit, `prebuild`, `npm test`); a variant that must pad itself carries `// section-spacing: self-padded`.
- **Icons are Lucide names** via `getIcon` (`client/src/lib/icons.ts`).
- **`site_*` edits are pushed to the content repo in the same task**, with a commit SHA (`.cursor/rules/site-content-github.mdc`). App-repo commits only when the user asks.
- **New API routes** use `api.*` with a rate policy (`.cursor/rules/api-rate-limits.mdc`).
- **One-off production data fixes** are numbered migrations (`.cursor/rules/production-migrations.mdc`).
- Do not start the dev server; ask the user to check the running app (`npm run dev`).

## Checks

```bash
npm run build
npm test
npm run check:section-spacing               # no outer vertical padding/margin in section variants
npm run schema:sync -- --component=<type>   # after registry schema changes
```
