# Caxton CLI

Thin orchestrator for create / resume / agentic install. CMS logic stays in `server/`, `mcp-server/`, and `shared/`.

## Local link

From the monorepo root (PACKAGE_ROOT = PROJECT_ROOT):

```bash
npm run caxton
# or
npx tsx cli/src/index.ts
```

After `npm run build`, the published entry is `dist/cli.js` (`bin`: `caxton-cms`). From the repo root, `npm link` then run `caxton-cms` from any folder.

**Site path:** default is cwd. To point at another folder without `cd`:

```bash
WEBLIFY_PROJECT_ROOT=/path/to/my-site npx caxton-cms
```

See `.env.example` and [INSTALL.md](../INSTALL.md) (Caxton CLI / package paths). There is no `--path` flag.

**Existing `site_*` without `sites.yml`:** Caxton detects content folders and asks which hostnames to register, then writes a minimal `sites.yml`. Non-interactive:

```bash
# one site_* folder
caxton-cms --yes
# several — pick one for localhost
caxton-cms --yes --slug my-site
```

**Quiet by default.** After start you get plain-English steps for the agent you chose. Full engine / Vite logs:

```bash
DEBUG=true npm run caxton
# or
npx caxton-cms --debug
```

**Interactive prompts** use arrow keys (yes/no, Local vs Cloud). `NO_COLOR=1` disables ANSI. Non-TTY / `--yes` / flags skip menus.

## Flags

See `npx caxton-cms --help`.

## Agentic (dev only)

You pick an agent first; then Caxton prints **only** that agent’s instructions:

- **Local (Cursor / Claude Code):** site URL (`http://127.0.0.1:<port>`), `…/mcp`, and a connection secret. Caxton starts the MCP process for you.
- **Cloud (Claude.ai / ChatGPT):** opens a Cloudflare quick tunnel, starts MCP with `SITE_URL` / `MCP_PUBLIC_URL` set to **that** tunnel origin (so OAuth matches the rotating hostname), prints the connector URL **and** connection token (paste both in the wizard). If the public link fails, falls back to Local instructions.

After the agent successfully connects (first MCP `initialize`), Caxton prints a tip to start chatting (e.g. “Help me configure my site”).

Mint or rotate the connection token anytime with `npx caxton-cms token` (from the project folder, with Caxton stopped). The same token unlocks staff sign-in in the Debug bubble and MCP auth.

New projects default to `PORT=5050` (macOS AirPlay often owns `:5000`). Always open `http://127.0.0.1:<port>` — not `localhost` — when testing on a Mac.

Do not put trycloudflare URLs into `.env` — they change every restart; Caxton sets them for the MCP session only.

## Production

`caxton-cms --production` wraps `scripts/start-production.sh` when present. Pin the package version in deploys. See [docs/migrate-to-npx-caxton.md](../docs/migrate-to-npx-caxton.md).
