# Contributing to Caxton

Thanks for your interest in Caxton — the agentic CMS. Contributions that improve the CMS, components, docs, or deploy story are welcome.

## Development setup

**Requirements:** Node 20+, npm 10+.

```bash
git clone https://github.com/YOUR_ORG/caxton
cd caxton
npm install
cp sites.yml.example sites.yml
npm run dev
```

Open http://localhost:5000. See [INSTALL.md](INSTALL.md) for environment variables and content folder bootstrap.

## Before you open a PR

```bash
npm run check   # TypeScript
npm test        # vitest (same as CI pre-push)
```

Fix any failures. The Husky pre-push hook runs `npm test` — use `git push --no-verify` only when you know why.

## Where things live

| Path | Purpose |
|---|---|
| `client/src/` | React app, pages, components, hooks |
| `server/` | Express routes, content loading, GitHub sync |
| `shared/` | Zod schemas, locale helpers, shared component registry |
| `site_*/` | Per-site YAML content (gitignored; pulled from content repos) |
| `shared/component-registry/` | Platform default section components |
| `site_*/component-registry/` | Site-specific components |
| `mcp-server/` | MCP tools for AI agents |
| `scripts/validation/` | Content validation pipeline |
| `docs/` | Deployment and integration guides |

## Good first contributions

- **New section components** — add a type under `shared/component-registry/` with `schema.ts`, `schema.yml`, examples, and a React renderer. See [shared/component-registry/README.md](shared/component-registry/README.md).
- **Starter templates** — example `site_*` scaffolds for blog, portfolio, or SaaS landing pages.
- **Storage providers** — implement `StorageProvider` in `server/media/types.ts` for S3, Cloudflare R2, or Azure Blob.
- **Documentation** — fix gaps in `docs/`, `INSTALL.md`, or this README.
- **Tests** — vitest coverage for shared utilities, validation, or MCP response helpers.

## Component workflow

1. Define the Zod schema in `shared/component-registry/<type>/v1.0/schema.ts`.
2. Add example YAML under `examples/`.
3. Run `npm run schema:sync -- --component=<type>` if you need `schema.yml` in sync.
4. Register the React component in the client section renderer.
5. Add field editors in `field-editors.ts` when the generated UI is not enough.

## Content and site folders

Edits under `site_*/` are content-repo data. If you change YAML in a real site folder as part of a task, follow your team's content sync workflow (GitHub content repo). Do not commit `site_*` paths to the platform app repo — they are gitignored.

## Code style

- TypeScript strict mode, ESM only.
- Path aliases: `@/` → `client/src`, `@shared/` → `shared`.
- Use semantic design tokens — avoid hardcoded color utilities in UI code.
- Use `import type` for type-only imports.

See [.cursor/rules/code-style.mdc](.cursor/rules/code-style.mdc) for naming and file organization.

## Questions

Open a GitHub issue with the `question` label, or describe your use case in a discussion. For MCP tool behavior, start with [mcp-server/README.md](mcp-server/README.md).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
