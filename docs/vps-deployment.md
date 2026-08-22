# VPS Deployment

This document describes the current VPS deployment for `website-v3`. It is an
operational reference for how the app runs today, not a migration plan.

## Overview

- Host: DigitalOcean Droplet `4geeks-website`
- OS: Ubuntu 24.04
- App path: `/opt/website-v3`
- Public entrypoint: Nginx on `:80` / `:443`
- App process: `website.service`
- Internal health check: `http://127.0.0.1:5000/health`

Production traffic is intended to flow through Cloudflare to Nginx, then to the
Node app on loopback.

## Network layout

The public internet should only reach Nginx. Internal services stay on
loopback:

```text
Internet
  -> Cloudflare
  -> Nginx :80/:443
  -> website.service
       -> 127.0.0.1:5000 Express
       -> 127.0.0.1:6333 Qdrant
       -> 127.0.0.1:3001 MCP
```

Current firewall intent:

- TCP 22 open for SSH deploy/access
- TCP 80 and 443 open for web traffic
- App ports `5000`, `6333`, and `3001` are not exposed publicly

## Service users

Two Linux users are involved:

### `website-deployer`

Used for:

- operator SSH access
- GitHub Actions SSH deploys
- `git pull`, dependency install, build, and service restart

This user keeps the limited sudo rights used by deploy:

- `systemctl restart website`
- `systemctl reload website`
- `systemctl reload nginx`
- `nginx -t`

### `website-runtime`

Used for:

- the running `website.service` process

This account is a system user with:

- no SSH login
- no sudo
- shell set to `nologin`

## Systemd service

`website.service` runs with:

- `User=website-runtime`
- `Group=website-runtime`
- `WorkingDirectory=/opt/website-v3`
- `EnvironmentFile=/opt/website-v3/.env`
- `ExecStart=/opt/website-v3/scripts/start-production.sh`

The service also has a hardening drop-in at
`/etc/systemd/system/website.service.d/hardening.conf`:

```ini
[Service]
NoNewPrivileges=true
ProtectHome=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/website-v3
```

This limits what the process can touch on the host while still allowing the app
to write to its runtime files under `/opt/website-v3`.

## Runtime file ownership

Current important ownership/mode expectations:

- `/opt/website-v3/.env`
  - owner: `website-deployer`
  - group: `website-runtime`
  - mode: `640`
- `/opt/website-v3/.git`
  - owner: `website-deployer`
  - group: `website-runtime`
  - directories: `2750`
  - files: `640`

Why this split exists:

- deploy still needs write access to the code repo
- runtime may need to read git metadata (`git rev-parse`, `git show`) but must
  not be able to modify `.git`

The host also declares:

```bash
git config --system --add safe.directory /opt/website-v3
```

This allows Git commands run as `website-runtime` to read the repo without
failing on Git's dubious ownership protection.

## Environment file

Runtime secrets live in:

```text
/opt/website-v3/.env
```

The app uses env vars for runtime secrets and service configuration. The file is
materialized during deploy from GitHub Actions secrets/vars prefixed
`_WEBSITE_`.

The expected steady state after deploy is:

```text
640 website-deployer website-runtime /opt/website-v3/.env
```

## Deploy flow

Deploys run from GitHub Actions in the forked repo, not by editing the server
manually.

Workflow file:

```text
.github/workflows/deploy-vps.yml
```

High-level flow:

1. Collect runtime keys from GitHub Actions `secrets` and `vars`
2. Keep only names starting with `_WEBSITE_`
3. Strip the prefix and pack the env payload
4. SSH into the Droplet as `website-deployer`
5. Rewrite `/opt/website-v3/.env`
6. Run `scripts/deploy.sh`
7. Restart `website.service`
8. Poll `http://127.0.0.1:5000/health`

Important deploy details:

- the workflow uses native OpenSSH, not `appleboy/ssh-action`
- the SSH private key is written to `$RUNNER_TEMP`
- the remote host identity is pinned with `DEPLOY_SSH_KNOWN_HOSTS`
- the runtime env blob is sent over SSH stdin, not embedded in the remote
  command string

## Host key pinning

GitHub Actions deploys use a pinned SSH host key stored in the secret:

```text
DEPLOY_SSH_KNOWN_HOSTS
```

This means deploy fails closed if the Droplet host key does not match the
expected fingerprint.

If the Droplet is rebuilt or migrated and the SSH host key changes, regenerate
the value with:

```bash
ssh-keyscan -t ed25519 <deploy-host>
```

Then update the `DEPLOY_SSH_KNOWN_HOSTS` secret before the next deploy.

This pinning currently protects GitHub Actions deploys. Operator laptops may
still use each person's local SSH known_hosts policy.

## Useful commands

Check service status:

```bash
systemctl is-active website
systemctl status website --no-pager
```

Read the final unit configuration:

```bash
systemctl cat website.service
```

Check health:

```bash
curl -fsS http://127.0.0.1:5000/health
curl -s http://127.0.0.1:3001/health   # MCP loopback; includes gcsAuthPersistence
```

MCP OAuth persistence across redeploys: [`docs/runbooks/mcp-oauth-persistence.md`](runbooks/mcp-oauth-persistence.md).

View recent service logs:

```bash
journalctl -u website -n 80 --no-pager
```

Check `.env` ownership and mode:

```bash
stat -c '%a %U %G %n' /opt/website-v3/.env
```

## Root access and recovery

Normal SSH access is through `website-deployer`.

Root over SSH is not part of normal operation. If direct root access is needed
for system recovery, use DigitalOcean Recovery / console procedures rather than
relying on application deploy access.
