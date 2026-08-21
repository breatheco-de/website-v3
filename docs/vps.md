# VPS (website-v3)

Canonical doc for the DigitalOcean origin: layout, atomic deploy, hybrid content, network trust boundaries, security, and cutover status.

Related runbooks (kept separate on purpose):

- sGTM prod cutover: [`sgtm-prod-cutover.md`](sgtm-prod-cutover.md)
- sGTM migration context: [`sgtm-self-host-migration-context.md`](sgtm-self-host-migration-context.md)

---

## 1. Status

| Piece | Today |
|-------|--------|
| App on droplet | Yes (`/opt/website-v3`, atomic releases) |
| sGTM Docker on droplet | Yes (`/opt/sgtm`, tagging + preview) |
| Public marketing | Still **Replit** |
| Public metrics / sGTM | Still **Stape** (`metrics.4geeks.com`) |
| Lab TLS | Let’s Encrypt on **sslip** hostnames only |
| Prod DNS cutover | Not done — see [§9 Cutover](#9-cutover-pending) |

Security model: **origin behind Cloudflare** (orange proxy, SSL Full or Full strict), not a site meant to be browsed only by raw IP.

Verify droplet IP / hostname in DigitalOcean; do not treat IPs in older notes as source of truth.

---

## 2. What the app is

Marketing site + YAML CMS (programs, blog, landings, checkout, staff).

| Layer | Tech |
|-------|------|
| Client | React + Vite |
| Server | Express (Node), one process serves API + production statics |
| Content | YAML in a **separate** GitHub repo (`site_*`). App code repo is not the marketing source of truth. |
| Users / sessions | PostgreSQL (Drizzle). Public content is not in that DB. |
| Auth | Breathecode API + session cookies (`SESSION_SECRET`) |
| Forms | Cloudflare Turnstile |
| Media | Local and/or GCS |
| Search | Qdrant (loopback) |
| Agents | MCP via Express (`/mcp`); OAuth + Breathecode token |

**Two channels:**

1. **Code deploy** — GitHub Actions → SSH → VPS (`deploy-vps.yml` + `scripts/deploy.sh`).
2. **Content sync** — GitHub content token at runtime. An app deploy does **not** publish YAML.

---

## 3. Disk layout

```text
/opt/website-v3/
  persistent/          # mutable: sites.yml, site_*, data, .cache, .local, sync state…
  releases/<sha>/      # immutable tree for that commit + .env for that deploy
  current → releases/<sha>
  .git/                # fetch/archive object store (not the live cwd)

/opt/sgtm/             # Docker tagging (:8080) + preview (:8081)
```

Live process must use `current` (systemd). Mutable content stays in `persistent/`.

`.env` is **per release** under `releases/<sha>/.env` (written by `deploy.sh` from packed `_WEBSITE_*` secrets, or copied from the previous release if the pack is empty). systemd `EnvironmentFile` should be `/opt/website-v3/current/.env`.

### 3.1 Per-site hybrid (symlinks vs copy)

`shared/schema.ts` imports Zod schemas from `site_*/component-registry/**/*.ts` via relative paths. If the whole `site_*` directory were a symlink into `persistent/`, Node resolves those `../` against the **realpath** and looks for `persistent/shared/…`, which breaks the build.

So each release gets:

| Path under `site_*` | Treatment |
|---------------------|-----------|
| Everything except `component-registry/` | Symlink → `persistent/site_*/…` (YAML, blog, images, sync state, …) |
| `component-registry/` (if present in persistent) | **Copied** into the release (real files next to `shared/`) |
| No `component-registry/` in persistent | Left absent (do not mkdir empty — required for `inherit_components_from`) |

YAML/content via symlink is live immediately.

**Registry sync:** GitHub pull/delete still writes under `cwd` (the release copy). After a change under `component-registry/`, the server mirrors **release → `persistent/`** (`server/component-registry-persistent.ts`) so the next deploy’s `cp -a` does not resurrect deleted or stale registry files. Without a `persistent/` sibling of cwd (local dev), the mirror is a no-op.

### 3.2 Site adopt (new `site_*` at runtime)

The app writes to `cwd/site_…` and does not know about `persistent/`. On each deploy, before building the new release, `deploy.sh`:

1. Finds real (non-symlink) `site_*` dirs under `current/` (and legacy app root)
2. `mv` them into `persistent/`
3. Puts an absolute symlink back at the old path so the live process keeps working
4. Materializes each site into the new release (hybrid link/copy above)

If `persistent/site_…` already exists, adopt skips (does not overwrite). Empty `persistent` folders are still created for new `content_folder` entries in `sites.yml` when nothing exists yet.

---

## 4. Atomic deploy

### 4.1 GitHub Actions

Workflow: [`.github/workflows/deploy-vps.yml`](../.github/workflows/deploy-vps.yml)

- Triggers: push to `main`, `workflow_dispatch`
- Concurrency group `deploy-vps` with **`cancel-in-progress: true`** — a newer push cancels an in-flight deploy. Partial `releases/<sha>/` dirs from cancelled runs are fine; only `current` serves traffic.
- Packs GitHub secrets/vars whose names start with `_WEBSITE_` → `WEBSITE_RUNTIME_B64`, then registers `::add-mask::` on that blob (base64 is not an exact match for individual secrets, so Actions would not mask it otherwise). Avoid `set -x` in the SSH step; do not add env-dumping steps after packing.
- Skips if the workflow SHA is no longer tip of `main`
- SSH as deploy user (not root): remote lock `/tmp/website-v3-deploy.lock` with **pid + stale recovery** (cancel can kill SSH before `trap` cleanup)
- Fetches `DEPLOY_SHA`, extracts `scripts/deploy.sh` **from that commit**, runs it

Actions secrets for SSH: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_SSH_KNOWN_HOSTS`.

### 4.2 `scripts/deploy.sh`

1. Adopt real `site_*` dirs into `persistent/` (symlink back on live tree)
2. `git archive` → `releases/<sha>/`
3. Symlinks for `data` / `.cache` / `sites.yml` / …
4. Per site: content symlinks + **copy** `component-registry/`
5. Writes `.env`
6. `npm ci` + build
7. Flips `current`, restarts, health-checks (**rollback `current`** on failure)
8. Prunes old releases (keeps active + 5 others; never deletes `readlink current`)

### 4.3 Manual rollback

```bash
ln -sfn releases/<old-sha> /opt/website-v3/current
sudo systemctl restart website
```

Prefer a normal Actions deploy to an older SHA if you also need a fresh `.env` from secrets.

---

## 5. systemd

One-time (requires root/sudo). After the first successful atomic deploy:

```bash
# /etc/systemd/system/website.service
WorkingDirectory=/opt/website-v3/current
EnvironmentFile=/opt/website-v3/current/.env
ExecStart=/opt/website-v3/current/scripts/start-production.sh
```

Keep `ReadWritePaths=/opt/website-v3` so `persistent/` remains writable.

```bash
sudo systemctl daemon-reload
sudo systemctl restart website
curl -fsS http://127.0.0.1:5000/health
```

Until this flip, `deploy.sh` still builds releases and updates `current`, but the running service may keep using the legacy root tree — the script prints a WARNING if `WorkingDirectory` ≠ `…/current`.

---

## 6. Network / trust boundaries

### Target traffic

```text
Internet
  → Cloudflare (WAF, TLS to visitor)
  → Droplet Nginx :443
       → 127.0.0.1:5000  Express (pages, API, /ipn/, /mcp proxy, …)
       → sGTM Docker     (metrics host; /gtm/ → preview)
            → 127.0.0.1:8080 tagging
            → 127.0.0.1:8081 preview
```

Canonical public URL in prod: **`https://4geeks.com`** (`SITE_URL`).

### Must be public

- TCP **22** SSH (keys only)
- TCP **80 / 443** Nginx

### Must not be public (loopback / Docker bind `127.0.0.1`)

- Express `:5000`
- Qdrant `:6333`
- MCP `:3001` (public only as Nginx → Express → loopback `/mcp`)
- sGTM `:8080`, `:8081`

DigitalOcean Cloud Firewall: inbound 22/80/443 only. Outbound open for apt, git, Let’s Encrypt, APIs.

### sGTM routing rules (short)

Full runbook: [`sgtm-prod-cutover.md`](sgtm-prod-cutover.md).

- `metrics.*` → Docker only. **Never** proxy metrics to Node `:5000` (loop).
- Preview: `location ^~ /gtm/` → `8081`. Tagging: everything else → `8080`.
- `/gtm.js` is **not** under `/gtm/` (dot vs slash).
- `/ipn/` stays on Node.
- Prod `PREVIEW_SERVER_URL` = `https://metrics.4geeks.com` (**no** `/sgtm`). Change only after metrics HTTPS is on this VPS.
- Tagging compose: `extra_hosts: metrics.4geeks.com:host-gateway`.
- Do not publish lab sslip URLs in prod GTM.

---

## 7. Security

No secret values in this doc.

### 7.1 Checklist (must)

**Network**

- Only public: 22, 80, 443.
- Do not open 5000, 6333, 3001, 8080, 8081.
- sGTM Docker: bind `127.0.0.1`, never `0.0.0.0`.

**Access**

- SSH with keys, not passwords (`PermitRootLogin no`, `PasswordAuthentication no`).
- Deploy user (`website-deployer`): limited sudo (`systemctl` website/nginx, `nginx -t`) — not `NOPASSWD: ALL`.
- Runtime user without interactive login where applicable.
- Emergency access: DigitalOcean Droplet Console (not SSH), not root over port 22.

**Secrets**

- Per-release `.env` mode `600`, owned by deploy/runtime user.
- sGTM `.env`: `chmod 600`.
- Never commit tokens or paste them into chat/logs.
- Do not leave permanent `127.0.0.1 metrics.4geeks.com` in `/etc/hosts`.

**TLS / Cloudflare**

- Certbot per hostname only when that DNS already points at the droplet.
- Cloudflare SSL: Full or Full (strict) once origin has a real cert. Avoid Flexible.

### 7.2 Controls already applied (summary)

- Fail2ban jail `sshd` (journal backend on Ubuntu 24.04).
- Node / MCP / Qdrant listen on loopback on the VPS (`LISTEN_HOST=127.0.0.1` on droplet; Replit may still need `0.0.0.0`).
- Turnstile required in production start.
- Staff `/private` and edit APIs are not anonymous.
- MCP: `MCP_SERVER_SECRET` is a **loopback** credential (MCP → capability check), not a public API key for browsers.

### 7.3 SSH key diagram (do not mix)

| Pair | Direction | Role |
|------|-----------|------|
| Operator keys | Laptop → Droplet deploy user | Human ops |
| GHA deploy key | GitHub Actions → Droplet deploy user | Deploy |
| Git deploy key | Droplet → GitHub **code** repo | Fetch / archive |
| `GITHUB_TOKEN` (content) | App → GitHub **content** repo | YAML sync |

Actions deploy key must not live in root `authorized_keys`.

### 7.4 Env / secrets plan

Operational source of runtime secrets: **GitHub Actions** (`_WEBSITE_*` → pack → materialize into release `.env`). Day-to-day env changes should not require hand-editing on the box.

1. Never commit `.env`.
2. Deploy materializes env with restrictive umask; rotate by changing the GitHub secret and redeploying.
3. Workflow must not print secret values.
4. Code/runtime secrets vs content-repo token stay out of git; Replit secrets stay on Replit if a parallel env still exists.
5. `sites.yml` is not an app secret but is gitignored in the code repo.

Typical names (not values): `DATABASE_URL`, `SESSION_SECRET`, `SITE_URL`, `PORT`, `LISTEN_HOST`, `TURNSTILE_*`, `MCP_*`, `GITHUB_*` (content), `GCS_*`, `OPENROUTER_API_KEY`, `VITE_BREATHECODE_HOST`, `QDRANT_URL`, `IPN_SECRET`, …

### 7.5 Headers, rate limit, fail2ban nginx

Priority: **(1)** Cloudflare WAF + headers + API rate limits, **(2)** Cloudflare real IP on Nginx, **(3)** optional fail2ban nginx jail only after real IP is correct (otherwise you ban Cloudflare edges).

Suggested headers at origin and/or CF: `X-Content-Type-Options`, strict `Referrer-Policy`, frame policy / CSP as needed, HSTS only when visitors use prod HTTPS hostnames (not long HSTS on lab sslip).

Rate limit APIs/forms/`/mcp`, not a blunt global RPS on all static assets.

### 7.6 Open questions for security review

1. Is “Actions writes `.env` each deploy” acceptable vs a secret store + systemd `EnvironmentFile` only?
2. Port 22 open to the world + fail2ban vs self-hosted runner / GitHub IP allowlists (IPs change)?
3. Same user for deploy and Node vs separate runtime user that cannot SSH?
4. Extra WAF / rate limit for public `/mcp`?
5. Managed Postgres off-box with TLS and SG locked to the droplet?
6. Headers / rate limit / nginx jail — see §7.5.

### 7.7 Residual assumptions

- 2FA on DigitalOcean and GitHub org is account hygiene, not Droplet config.
- Kernel upgrades may need a maintenance reboot window.
- Compromising GitHub org secrets ≈ compromising future deploys and `.env`.
- This doc is not an app pentest (XSS/CSRF/IDOR in the CMS are separate).

---

## 8. Infra snapshot (verify live)

| Item | Expected |
|------|----------|
| OS | Ubuntu 24.04 |
| App root | `/opt/website-v3` |
| Process | `website.service` → `current/scripts/start-production.sh` |
| Reverse proxy | Nginx 80/443 |
| Health | `http://127.0.0.1:5000/health` |
| sGTM | `/opt/sgtm` Docker compose |

IP, hostname, and which DNS records already point here: check DigitalOcean + Cloudflare, not this file.

---

## 9. Cutover (pending)

**Done in lab:** app on droplet, sGTM Docker, Nginx metrics `/gtm/` → 8081, Preview on sslip.

**Public today:** Replit + Stape. Detail: [`sgtm-prod-cutover.md`](sgtm-prod-cutover.md).

### A — sGTM first (metrics only)

1. Cloudflare: `metrics.4geeks.com` → droplet A record (leave Stape until flip).
2. Cloudflare SSL: Full or Full (strict).
3. VPS: `certbot --nginx -d metrics.4geeks.com`.
4. Confirm 443 still has `location ^~ /gtm/` → 8081.
5. Tagging `.env`: `PREVIEW_SERVER_URL=https://metrics.4geeks.com`.
6. Tagging: `extra_hosts: metrics.4geeks.com:host-gateway`.
7. `cd /opt/sgtm && docker compose down && docker compose up -d`.
8. GTM: Server container URL `https://4geeks.com/sgtm` (no sslip). New preview session.
9. Check `https://metrics.4geeks.com/healthy` → `ok` (not Stape).
10. Check `https://4geeks.com/sgtm/healthy`. `/ipn/` must not 502.
11. Turn off Stape.

Do **not** advance `PREVIEW_SERVER_URL` while metrics still points at Stape.

### B — App after (4geeks + Florida)

1. Cloudflare: `4geeks.com`, `www`, `fl.4geeksacademy.com` (and anything still on Replit) → same droplet IP.
2. Certbot for those hostnames (not the sslip cert).
3. Nginx HTTPS `server_name` for those hosts.
4. Smoke: sites, `/sgtm`, `/ipn`, GitHub Actions deploy.
5. Turn off Replit.

**Order:** A first (easy rollback: metrics CNAME back to Stape). B after metrics is healthy. Same day is fine; two DNS flips.

---

## 10. Code pointers

| Path | Role |
|------|------|
| `.github/workflows/deploy-vps.yml` | Actions deploy + cancel-in-progress + lock |
| `scripts/deploy.sh` | Atomic release build / flip / prune |
| `server/component-registry-persistent.ts` | Registry mirror release → persistent |
| `docs/sgtm-prod-cutover.md` | sGTM cutover runbook |
