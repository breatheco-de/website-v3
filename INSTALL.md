# Installation Manual

This document explains how to set up and run the AI Reskilling Platform locally and in production, and provides a complete reference for every environment variable the platform reads.

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 20 or later |
| npm | 10 or later (bundled with Node 20) |

No other runtime or containerisation tool is required. The website runs with `npm run dev`. Background jobs need a second terminal: `npm run sidequest`.

---

## Local Setup

```
git clone <repository-url>
cd <repository-folder>
npm install
```

Copy or create a `.env` file at the project root (see the environment variable reference below) and then start the development server:

```
npm run dev
```

In a second terminal, start the Sidequest job worker (required for index refresh / on-save validation after content edits):

```
npm run sidequest
```

Worker health: `curl -fsS http://127.0.0.1:8679/health`

### Site content folders

Site YAML content is **not** in this repository. Each domain in `sites.yml` maps to a gitignored folder under the project root.

**Local development:** copy the template to create your registry:

```
cp sites.yml.example sites.yml
```

Edit `sites.yml` with your domain(s) and content folder names. The file is gitignored — it is local runtime config, not platform source code.

**Production:** the canonical `sites.yml` is stored in GCS at `multisite-global/sites.yml` (requires `GCS_BUCKET_NAME`). Site Manager updates are persisted there automatically. On first deploy with GCS enabled, the server seeds GCS from a local/git copy if the bucket object does not exist yet.

Before the dev server starts, `npm run dev` runs `check:sites`, which:

1. Verifies each configured folder exists and has the required scaffold (`settings.yml`, `content-types.yml`, `image-registry.json`, `custom-redirects.yml`, plus `images/`, `menus/`, and `pages/`).
2. If a folder is missing or incomplete **and** the site has a `github_repo_url` in `sites.yml`, automatically downloads content from GitHub when `GITHUB_TOKEN` is set in `.env` (does not require `GITHUB_SYNC_ENABLED`).
3. If the remote repo has no content for that site folder, prompts interactively to create a simple local scaffold (syncs via GitHub sync when enabled).
4. Exits with an error if folders are still invalid — for example when `GITHUB_TOKEN` is absent and content has not been populated manually.

You can run the check alone with `npm run check:sites`.

### Component registry vs app code

Tracked [`shared/schema.ts`](shared/schema.ts) re-exports Zod schemas from gitignored `site_*/component-registry/**/schema.ts`. If the app repo moves ahead of your local content (missing named export), boot and build fail **before** the Sync UI or startup auto-pull can run.

- **`npm run check:registry`** — verify those imports; prints recovery steps on failure.
- **`npm run content:pull`** — hash-diff pull all sites from GitHub without starting the server (`--force` for a full re-download). Needs `GITHUB_TOKEN` and `github_repo_url` in `sites.yml` (does **not** require `GITHUB_SYNC_ENABLED`).
- **`npm run ensure:registry`** — check first; on failure, pull content then re-check. Wired into `predev` and `prebuild`.
- **`npm run ensure:schema-yml`** — check `schema.ts` ↔ `schema.yml` variant drift and shared/site type collisions; on failure, run `schema:sync` then re-check. Wired into `predev` and `prebuild`. Does **not** push to the content GitHub.

Once the server is up, GitHub Sync in the Debug bubble still works for day-to-day content sync.

The command starts two processes in parallel:

- **Express backend** — handles API routes, content serving, and GitHub/GCS integrations.
- **Vite frontend** — serves the React client with hot module replacement.

Both are reachable on the same port (default `5000`). Open `http://localhost:5000` in a browser.

---

## Running in Production

Set `NODE_ENV=production` before starting. The Vite frontend is compiled to static files and served by the Express backend — no separate Vite process runs.

```
NODE_ENV=production npm run build
NODE_ENV=production npm start
```

Key variables you must configure for a production deployment:

- `SITE_URL` — the canonical base URL (e.g. `https://www.example.com`). Used for sitemaps, hreflang tags, canonical URLs, and GitHub webhook registration.
- `PORT` — the port the server listens on (default `5000`).
- `GITHUB_SYNC_ENABLED=true` and the full GitHub variable group if you want content edits committed back to the repository.
- `GCS_BUCKET_NAME` and the full GCS variable group if media should be stored in Google Cloud Storage instead of the local filesystem.
- `OPENROUTER_API_KEY` if AI-powered features such as field mapping, content adaptation, or the chat assistant should be available.

---

## Environment Variable Reference

Variables are listed by category. "Required" means the feature that depends on the variable will be unavailable or will exit fatally if the variable is missing.

### Server

| Variable | Required | Default | Description | Features enabled | Extra config needed |
|---|---|---|---|---|---|
| `PORT` | No | `5000` | TCP port the Express server listens on. | Core server | None |
| `NODE_ENV` | No | `development` | Set to `production` to serve compiled static assets, enable secure cookies, and suppress development-only behaviour. | All production hardening | None |
| `SITE_URL` | No | `http://localhost:5000` (dev) | Canonical base URL with no trailing slash (e.g. `https://www.example.com`). Falls back to `https://<REPLIT_DEV_DOMAIN>` when that variable is set, and to `http://localhost:5000` otherwise. Used for sitemaps, hreflang, canonical meta tags, and GitHub webhook registration. | Sitemap, SEO canonical URLs, GitHub webhook auto-registration | None |
| `REPLIT_DEV_DOMAIN` | No | — | Set automatically by the Replit platform. Used as a fallback base URL when `SITE_URL` is not set. Has no effect outside the Replit environment. | Dev-environment URL resolution | None (platform-managed) |
| `REPL_ID` | No | — | Set automatically by the Replit platform when the project runs inside Replit. When present in non-production mode, Vite loads the `@replit/vite-plugin-cartographer` and `@replit/vite-plugin-dev-banner` plugins. Has no effect outside the Replit environment. | Replit-specific dev tooling in Vite | None (platform-managed) |

### API Integrations

| Variable | Required | Default | Description | Features enabled | Extra config needed |
|---|---|---|---|---|---|
| `VITE_BREATHECODE_HOST` | No | `https://breathecode.herokuapp.com` | Base URL for the 4Geeks Breathecode REST API. Available on both server and client because of the `VITE_` prefix. | Breathecode data fetching (programs, users) | None |
| `BREATHECODE_HOST` | No | `https://breathecode.herokuapp.com` | Same as above but read by the MCP server process only. | MCP OAuth — Breathecode token validation | None |
| `IPAPI_PRO_KEY` | No | — | API key for ipapi.pro, used to geo-locate visitors and redirect them to a locale-appropriate page. | IP-based locale detection | Register at ipapi.pro |
| `TURNSTILE_SITE_KEY` | No | — | Cloudflare Turnstile public site key, embedded in the lead-capture form. | Bot-protection on lead forms | Must also set `TURNSTILE_SECRET_KEY` |
| `TURNSTILE_SECRET_KEY` | No | — | Cloudflare Turnstile secret key, validated server-side. | Bot-protection on lead forms | Must also set `TURNSTILE_SITE_KEY` |
| `CLOUDFLARE_ACCOUNT_ID` | No* | — | Cloudflare account id for Browser Run `/screenshot` (entry-preview OG images). Env only — never stored in `settings.yml`. SEO/GEO → OG Image shows configured status. | Server-side OG / entry-preview capture | `CLOUDFLARE_API_TOKEN`, public `SITE_URL` |
| `CLOUDFLARE_API_TOKEN` | No* | — | API token with **Browser Rendering - Edit**. Env only — never stored in `settings.yml`. | Server-side OG / entry-preview capture | `CLOUDFLARE_ACCOUNT_ID`, public `SITE_URL` |
| `ENTRY_PREVIEW_CAPTURE_SECRET` | No | `SESSION_SECRET` | HMAC secret for signed capture frame URLs opened by Cloudflare. Env only (then `SESSION_SECRET`). Prefer a dedicated secret in production. | Entry-preview capture auth | Public `SITE_URL`; staff status UI at SEO/GEO → OG Image |
| `IPN_SECRET` | No* | — | Shared secret for the IP Normalization proxy (`X-IPN-Token`). Env only — never stored in `settings.yml`. Tracking → IP Normalization shows configured status and can Generate & copy (does not save). | `/ipn/{id}/*` egress proxy | Enable + destinations in settings; same value as GTM server Constant |
| `GOOGLE_PSI_API_KEY` | No | — | Deprecated for in-app diagnostics (Lighthouse/PSI UI removed). Use external Lighthouse/PageSpeed tools. | — | — |

### AI / LLM

The platform uses an OpenAI-compatible API client pointed at OpenRouter. Which API key and base URL it reads is controlled by `site_*/llm.yml` via the `provider.api_key_env` and `provider.base_url_env` fields. Set `OPENROUTER_API_KEY` (and optionally `OPENROUTER_BASE_URL`) in the environment.

```yaml
# site_*/llm.yml (current defaults)
provider:
  api_key_env: OPENROUTER_API_KEY
  base_url_env: OPENROUTER_BASE_URL
model:
  default: openai/gpt-4o-mini
  chat: openai/gpt-4o
  vision: openai/gpt-4o
```

Choose the completion model in **Debug Bubble → AI & Agents → AI Settings** (`/private/settings/ai/llms`); saving writes `model.default` in `llm.yml`. Chat and vision models are configured separately (`model.chat` / `model.vision`, or the Knowledge Editor for chat).

If you change `api_key_env` or `base_url_env` in `llm.yml`, the server reads the named environment variables instead. The table below covers all variable names the code can read.

| Variable | Required | Default | Description | Features enabled | Extra config needed |
|---|---|---|---|---|---|
| `OPENROUTER_API_KEY` | No* | — | API key for OpenRouter. This is the variable currently named in `llm.yml` under `provider.api_key_env`. | Field mapping, content adaptation, chat assistant, vision tagging | OpenRouter account at openrouter.ai |
| `OPENROUTER_BASE_URL` | No | `https://openrouter.ai/api/v1` | Base URL for the OpenRouter API. Soft-defaulted in code when unset and `llm.yml` names this env var. | Routing LLM calls to OpenRouter | None |
| `LLM_MODEL` | No | Value from `llm.yml` (`model.default`), currently `openai/gpt-4o-mini` | Overrides the default LLM model for all non-chat completions. Env var takes precedence over `llm.yml`. Prefer AI Settings over this env var. | Model selection for field mapping, meta generation, and content adaptation | None |
| `LLM_CHAT_MODEL` | No | Falls back to `LLM_MODEL` | Overrides the LLM model used specifically for the chat assistant. Env var takes precedence over `llm.yml` (`model.chat`). | Model selection for the chat assistant | None |

*A valid API key must be set for the LLM provider named in `llm.yml`. With the default configuration that means `OPENROUTER_API_KEY`.

Environment variables always take precedence over `llm.yml` for model overrides. Changing the provider, model, temperature, or token limit in `llm.yml` does not require a server restart — the file is reloaded on the next request when its modification time changes.

### GitHub Sync

GitHub sync lets content editors commit YAML edits back to the repository automatically and pull remote changes into the running server. All five variables must be set together for the feature to work.

| Variable | Required | Default | Description | Features enabled | Extra config needed |
|---|---|---|---|---|---|
| `GITHUB_SYNC_ENABLED` | No | `false` | Set to `true` to activate the GitHub sync subsystem. Acts as a master switch — other GitHub variables are ignored when this is `false`. | GitHub content sync (commit & pull) | All other `GITHUB_*` variables |
| `GITHUB_TOKEN` | No* | — | **Service** token for pulls, webhooks, bootstrap, and local/dev commits. Prefer a fine-grained PAT with Contents read/write on the content repo. In production, **staff commits use GitHub Connect** (below), not this token. | Pulls / system / local commits | `GITHUB_SYNC_ENABLED=true`, `GITHUB_REPO_URL` |
| `GITHUB_REPO_URL` | No* | — | Full URL of the GitHub repository (e.g. `https://github.com/owner/repo`). `.git` suffix is optional. | Repository targeting for all sync operations | `GITHUB_SYNC_ENABLED=true`, `GITHUB_TOKEN` |
| `GITHUB_BRANCH` | No | `main` | Branch to read from and commit to. | Branch targeting for sync operations | `GITHUB_SYNC_ENABLED=true` |
| `GITHUB_AUTO_COMMIT_ENABLED` | No | `false` | Set to `true` to automatically commit local content changes to GitHub when files are saved. Requires `GITHUB_SYNC_ENABLED=true`. | Automatic commit on save | `GITHUB_SYNC_ENABLED=true` |
| `GITHUB_AUTO_PULL_ENABLED` | No | `false` | Set to `true` to automatically pull remote changes from GitHub into the running server (triggered by a GitHub webhook). Requires `GITHUB_SYNC_ENABLED=true` and a registered webhook (auto-registered when `SITE_URL` is set). | Webhook-driven content pull | `GITHUB_SYNC_ENABLED=true`, `SITE_URL` |
| `GITHUB_APP_CLIENT_ID` | No* | — | GitHub App **client ID** for staff Connect OAuth. Required in production when sync is enabled. | Per-user content commits | `GITHUB_SYNC_ENABLED=true`, production |
| `GITHUB_APP_CLIENT_SECRET` | No* | — | GitHub App client secret. | OAuth code exchange | `GITHUB_APP_CLIENT_ID` |
| `GITHUB_APP_SLUG` | No* | — | GitHub App slug (for install/docs URLs). | Connect setup | `GITHUB_APP_CLIENT_ID` |
| `GITHUB_CONNECT_REQUIRED` | No | `false` | Set to `true` to force Connect for user commits even outside production (local testing). Still requires `GITHUB_SYNC_ENABLED=true`. | Dev Connect UI / commit gate | `GITHUB_SYNC_ENABLED=true`, App env |

**GitHub Connect (production):** Create a GitHub App with Repository permission **Contents: Read and write**, install it on the content org/repo, set callback URL to `${SITE_URL}/api/github/oauth/callback`, and set `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, and `GITHUB_APP_SLUG`. Staff click **Connect** on the DebugBubble GitHub sync chip. Local/dev normally keeps using `GITHUB_TOKEN` for commits; set `GITHUB_CONNECT_REQUIRED=true` to exercise Connect locally. Tokens live in `data/github-user-tokens.json` (+ GCS when encryption is enabled).

### Google Cloud Storage

When GCS is configured, uploaded media is stored in a GCS bucket instead of the local `4geeks-com/images/` directory. `GCS_BUCKET_NAME` is the only variable that activates GCS; the rest refine how the client authenticates.

| Variable | Required | Default | Description | Features enabled | Extra config needed |
|---|---|---|---|---|---|
| `GCS_BUCKET_NAME` | No* | — | Name of the GCS bucket (e.g. `my-project-media`). Setting this variable activates GCS for all media operations. | GCS media storage | Service-account credentials via `GCS_KEY_FILENAME` or `GCS_CREDENTIALS_JSON` |
| `GCS_PROJECT_ID` | No | Auto-detected by the GCS SDK | Google Cloud project ID. Required only when the SDK cannot determine the project from the service-account credentials. | GCS authentication | `GCS_BUCKET_NAME` |
| `GCS_KEY_FILENAME` | No | — | Filesystem path to a service-account JSON key file. Use this or `GCS_CREDENTIALS_JSON`, not both. | GCS authentication via key file | `GCS_BUCKET_NAME` |
| `GCS_CREDENTIALS_JSON` | No | — | Inline JSON string of the service-account credentials object. Use this or `GCS_KEY_FILENAME`, not both. Useful in environments where writing key files to disk is not practical. | GCS authentication via inline credentials | `GCS_BUCKET_NAME` |
| `GCS_BASE_PATH` | No | `media` | Key prefix (folder path) inside the bucket where media files are stored. | GCS path organisation | `GCS_BUCKET_NAME` |
| `MEDIA_DEFAULT_PROVIDER` | No | `local` | Set to `gcs` to route all new media uploads to GCS by default. Set to `local` to keep files on the local filesystem even when GCS is available. | Media provider routing | `GCS_BUCKET_NAME` when set to `gcs` |

### MCP Server

The MCP (Model Context Protocol) server is a separate process that exposes content tools to AI coding assistants. It runs on its own port and is proxied through the main Express server so that it is reachable without opening an additional firewall port. The MCP server is optional — the main application works without it.

| Variable | Required | Default | Description | Features enabled | Extra config needed |
|---|---|---|---|---|---|
| `MCP_PORT` | No | `3001` | Port the MCP server listens on internally. Requests are proxied from the main server's port, so this port does not need to be public. | MCP server internal port | None |
| `MCP_API_KEY` | Yes (for MCP) | — | Secret key that MCP clients must supply as a Bearer token to access the MCP endpoints. The MCP server exits immediately at startup if this is not set. | MCP tool access control | None |
| `OAUTH_CLIENT_ID` | No | — | Static OAuth client ID used for pre-registered MCP clients. When set, MCP clients can use this known ID without registering dynamically. | Static OAuth client support | Must also set `OAUTH_CLIENT_SECRET` |
| `OAUTH_CLIENT_SECRET` | No | — | Static OAuth client secret corresponding to `OAUTH_CLIENT_ID`. | Static OAuth client support | Must also set `OAUTH_CLIENT_ID` |

### Debug / Utilities

| Variable | Required | Default | Description | Features enabled | Extra config needed |
|---|---|---|---|---|---|
| `DEBUG_CROP_RESIZE` | No | — | Set to any non-empty value to enable verbose logging for image crop and resize operations in the image processing pipeline. | Debug output for image processing | None |

### Client-side (VITE_*)

These variables are embedded into the frontend bundle at build time by Vite. They must be prefixed with `VITE_` to be accessible in browser code via `import.meta.env`.

| Variable | Required | Default | Description | Features enabled | Extra config needed |
|---|---|---|---|---|---|
| `VITE_BREATHECODE_HOST` | No | `https://breathecode.herokuapp.com` | Base URL for the Breathecode API as seen by the browser. Overrides the default endpoint for client-side Breathecode requests. | Client-side Breathecode API calls | None |
| `VITE_BREATHECODE_TOKEN` | No | — | A Breathecode token pre-loaded into the browser for local development. Activates the debug toolbar and inline content editor without requiring a manual login. Do not set this in production. | Debug/edit mode in development | None |

---

## MCP Server

The MCP server exposes the platform's content management tools to AI coding assistants (such as Cursor or Claude) via the Model Context Protocol. It must be started separately from the main application:

```
npm run mcp
```

The server starts on `MCP_PORT` (default `3001`) and is accessible through the main server at `/mcp/*` — the main Express process proxies those paths automatically, so clients only need to reach the main port.

**Authentication:** Every MCP request must include an `Authorization: Bearer <MCP_API_KEY>` header. The server exits at startup if `MCP_API_KEY` is not set.

**OAuth:** The MCP server implements an OAuth 2.0 authorisation-code flow backed by Breathecode token validation. This allows AI coding assistants that support OAuth to authenticate on behalf of a human editor. Pre-registered static clients can be configured with `OAUTH_CLIENT_ID` and `OAUTH_CLIENT_SECRET`; additional clients can register dynamically at `/oauth/register`.

**Public URL:** For OAuth redirects to work correctly in production, `SITE_URL` must be set to the base URL of the deployment. In development on Replit, `REPLIT_DEV_DOMAIN` is used automatically.
