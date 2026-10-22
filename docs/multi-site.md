# Multi-site content repo separation

## Subdomain routing (single deployment, one or more sites)

One deployment serves one or more sites differentiated by subdomain or domain. Each
site gets its own content folder. The router reads **`sites.yml` at the repo root**
(required).

### sites.yml format

```yaml
# sites.yml (repo root) — required
bucket_name: my-gcs-bucket   # optional — shared GCS bucket for all sites

app.example.com:
  content_folder: site_example-com        # relative to project root
  github_repo_url: https://github.com/org/example-content

app.other.com:
  content_folder: site_other-com
  github_repo_url: https://github.com/org/other-content
```

A deployment with **one site** uses the same model — add a single domain block to
`sites.yml`. There is no separate single-site mode.

If `sites.yml` is missing or invalid, the server and `npm run check:sites` fail
with instructions and an example format. See [INSTALL.md](../INSTALL.md).

### Persistence (local vs GCS)

| Environment | Canonical source | Local file |
|---|---|---|
| Development | `sites.yml` at repo root (copy from `sites.yml.example`) | Same file |
| Production | GCS `multisite-global/sites.yml` | `sites.yml` is a cache (gitignored) |

Site Manager appends new domains to `sites.yml` and uploads to GCS in production.
Changes survive redeploy without committing to the platform git repo.

**Bootstrap:** production cold start requires `GCS_BUCKET_NAME` in env to fetch the
registry from GCS before site contexts are built. The `bucket_name` field inside
`sites.yml` should match that bucket once loaded.

### Development override

Append `?__site=app.example.com` to any URL to force a specific site without editing DNS.

### Environment variables

| Variable | Description |
|---|---|
| `GITHUB_REPO_URL` | Legacy global fallback only used by some admin tools; per-site repos are configured in `sites.yml` → `github_repo_url`. |

**Deprecated:** `CONTENT_FOLDER` is no longer used for site resolution. Set
`content_folder` per site in `sites.yml` instead.

---

This platform supports running the **same code** across multiple sites, each with its
own `4geeks-com/` stored in a dedicated GitHub repository.  The platform code
repo does **not** contain any content — `4geeks-com/` is gitignored (except for
`.gitkeep` and `README.md`).

---

## Architecture

```
platform-repo (shared across all sites)
└── 4geeks-com/   ← gitignored; populated at runtime from GITHUB_REPO_URL

site-a-content-repo      ← GITHUB_REPO_URL for site A
└── 4geeks-com/

site-b-content-repo      ← GITHUB_REPO_URL for site B
└── 4geeks-com/
```

---

## Setting up a new site

### 1. Fork (or copy) the platform repo

Create a new deployment (for example a VPS, see [vps.md](vps.md)) from the platform repo. No content files are included.

### 2. Create a content-only GitHub repository

Create a new GitHub repository that will hold only `4geeks-com/` for this site.
You can seed it from an existing folder — see **Seeding a new content repo** below.

### 3. Configure environment variables

Set the following environment variables in the new deployment:

| Variable | Value |
|---|---|
| `GITHUB_REPO_URL` | URL of the **content-only** repo (e.g. `https://github.com/org/site-a-content`) |
| `GITHUB_TOKEN` | Personal access token with `repo` and `admin:repo_hook` scopes |
| `GITHUB_BRANCH` | Branch to sync against (default: `main`) |
| `GITHUB_SYNC_ENABLED` | `true` |
| `GITHUB_AUTO_PULL_ENABLED` | `true` |
| `GITHUB_AUTO_COMMIT_ENABLED` | `true` _(optional — enables auto-commit of editor changes)_ |

### 4. Start the server

On the first start the server detects that `4geeks-com/` contains no YAML files
and automatically runs a **bootstrap pull** — downloading every file from the content
repo before the normal reconcile/auto-pull logic starts.  No manual step is required.

You can also trigger a bootstrap pull at any time via the CLI helper:

```bash
./scripts/content-bootstrap.sh
```

Or directly via the API:

```bash
curl -X POST http://localhost:5000/api/github/content/bootstrap
```

---

## Seeding a new content repo

If you have an existing `4geeks-com/` folder and want to copy it into a fresh
GitHub repo, run the push-all helper **while the server is running** with
`GITHUB_SYNC_ENABLED=true` pointing at the new (empty) repo:

```bash
./scripts/content-push-all.sh
```

This commits every local file to the remote one at a time.  For large content
collections this may take a few minutes.

---

## Ongoing sync

After the initial bootstrap the existing sync machinery takes over:

- **Auto-commit** — editor saves are automatically committed back to the content repo.
- **Webhook** — the server registers a GitHub webhook so push events from other
  instances (or direct repo edits) are pulled immediately.
- **Auto-pull** — on startup and via the webhook, non-conflicting remote changes are
  pulled automatically.

Refer to the GitHub Sync modal in the CMS for live status and manual controls.
