# Migrating from `npm run build` / `start-production.sh` to `npx weblify`

Operators who today deploy a full release with [`scripts/deploy.sh`](../scripts/deploy.sh) and [`scripts/start-production.sh`](../scripts/start-production.sh) (see [`docs/vps.md`](vps.md)) can move to a **pinned** `npx weblify --production` without a big-bang rewrite.

Greenfield sites can use `npx weblify` from day one. 4Geeks-style VPS stays on the release tree until optional Stage C.

## What stays the same

- `sites.yml` and `site_*` content (content GitHub, GCS sync)
- Cloudflare orange-cloud in front of origin
- Durable `SITE_URL` in project `.env` / host env
- OAuth MCP at `https://<SITE_URL>/mcp` on the same process (no tunnel in production)
- Sidequest as a separate unit if you already run it separately
- Secrets: Turnstile, session, MCP, GitHub tokens, etc.

## What changes

- Process command name: prefer `weblify --production` (or `node dist/cli.js --production`) instead of calling `start-production.sh` directly
- npm package name: `weblify` (engine version printed on start)
- Later (Stage C only): engine may live in the npm install path while the project folder holds only config/content/state

## Stage A — Same machine, new entrypoint (no layout change)

Still build and ship a full release (`npm ci` → content pull → `npm run build` → flip `current`). Only change **how the process is started**.

| Today | After Stage A |
|---|---|
| systemd `ExecStart` → `bash scripts/start-production.sh` | `ExecStart` → `npx weblify@<pinned> --production` **from `current/`**, or `node /path/to/current/dist/cli.js --production` |
| Turnstile checks, MCP child, Qdrant in start script | `weblify --production` **wraps the same** `scripts/start-production.sh` when present |

**Env checklist**

- `NODE_ENV=production` and/or `--production` / `WEBLIFY_MODE=production`
- `SITE_URL` (required; fail hard if missing)
- Existing Turnstile and other secrets — no agentic or tunnel prompts

**Pinning:** use `npx weblify@1.x.y` or the release’s own `dist/cli.js`. Do **not** use unpinned `@latest` on the droplet. Record the engine version in deploy logs.

**Exit criteria:** One successful deploy where health, staff login, public pages, and `/mcp` work. Rollback = point systemd back at `start-production.sh`.

## Stage B — This document

Use this file as the operator mapping. Link from the root README.

## Stage C — Optional thin project + npm engine (later)

Only after Stage A is proven:

1. `PROJECT_ROOT` = durable site dir (`sites.yml`, `site_*`, `.env`, `data` / `.cache` from today’s `persistent/`)
2. Engine = pinned `weblify` from npm (`PACKAGE_ROOT` under npx cache / `node_modules`)
3. Content pull / GitHub sync still against `PROJECT_ROOT`
4. Deploy publishes the **weblify version** separately from content updates

Stage C is **out of the critical path** for the first cutover.

## Rollback

1. Restore previous release symlink (`current` → previous)
2. Restore previous `ExecStart` (`start-production.sh`)
3. Restart the unit

## Not in this migration

- Creating sites on the production server
- Cloudflare tunnel or agentic prompts in production
- Forcing Stage C in the first cutover
