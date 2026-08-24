# Caxton on Replit

Caxton runs on Replit with no special fork. Replit-specific Vite plugins load only when `REPL_ID` is set ([`vite.config.ts`](vite.config.ts)); local and VPS deploys never see them.

## Quick start

1. Import or clone this repository into a Replit project.
2. Set **Node 20+** as the runtime.
3. Copy `sites.yml.example` to `sites.yml` and configure at least one domain → `content_folder` pair.
4. Add secrets Replit needs (see [INSTALL.md](INSTALL.md)): at minimum `GITHUB_TOKEN` if content pulls from GitHub.
5. Run:

```bash
npm install
npm run dev
```

The app serves on the Replit webview port (map `PORT` if Replit assigns one).

## Production on Replit

```bash
npm run build
npm start
```

Set `NODE_ENV=production` and `SITE_URL` to your Replit app URL (or custom domain).

## Where things live

| Path | Purpose |
|---|---|
| `/client/` | React frontend |
| `/server/` | Express backend |
| `/site_*/` | Per-site YAML content (gitignored; pulled from content repos) |
| `/shared/` | Shared schemas and platform component registry |
| `sites.yml` | Domain → content folder map (copy from `sites.yml.example`) |

Each site folder contains:

- `content-types.yml` — content type definitions and URL patterns
- `settings.yml` — site-wide settings (locales, branding)
- `image-registry.json` — centralized image metadata
- `component-registry/` — site-specific section components
- `pages/`, `menus/`, `images/` — content and assets

## Architecture (short)

- **Content-driven:** YAML under `site_*/` rendered by `SectionRenderer`.
- **Dynamic routing:** `content-types.yml` drives routes, APIs, and sitemap entries.
- **Git sync:** Editor changes can commit back to your content GitHub repo.
- **Multi-site:** One Replit deployment can serve multiple domains via `sites.yml`. See [docs/multi-site.md](docs/multi-site.md).

## Docs

- Full install and env vars: [INSTALL.md](INSTALL.md)
- VPS-style deploy (if you outgrow Replit): [docs/vps.md](docs/vps.md)
- MCP for AI agents: [mcp-server/README.md](mcp-server/README.md)

## Notes

- Content folders are **not** in the platform git repo. Bootstrap via `GITHUB_TOKEN` + `github_repo_url` in `sites.yml`, or scaffold locally on first `npm run dev`.
- For media in the cloud, see [docs/media-storage.md](docs/media-storage.md).
