# TEMPORARY: Node security upgrade on the VPS (October 2026)

> Delete this file once the droplet runs Node 24.22.1+ and a deploy has succeeded on it.
> Permanent reference: [docs/vps.md § 4.4 Node runtime](vps.md#44-node-runtime).

## Why

On October 21, 2026 Node.js shipped security releases ([advisory](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)). The worst one is a Brotli decoder bug that can run attacker code (CVE-2026-111497); two others let bad TLS certificates pass the hostname check. Fixed versions: **24.22.1**, 22.23.4, 26.12.1. Node 20 is end-of-life and gets no fix.

## What changed in the app repo

- `scripts/deploy.sh` now refuses to build when the server's Node is older than the fixed versions. It stops **before** touching the live release, so the site keeps serving the old version and the Actions run fails with `Node <version> on this server is unpatched`.
- `package.json` has an `allowScripts` list. Node 24's npm (11.x) skips dependency install scripts unless listed there; without it `better-sqlite3` / `sharp` are never compiled and the app crashes at boot.
- CI runs on Node 24.

## Order matters

1. **Merge the app commit first** (the one with `allowScripts` + the deploy check) to `main`. Do not upgrade Node on the droplet before that commit is on `main`, or the next `npm ci` skips the native builds.
2. Upgrade Node on the droplet (below).
3. Run **Deploy to VPS** from GitHub Actions (Actions → Deploy to VPS → Run workflow).

The merge will trigger a deploy on its own. Until step 2 is done, that deploy fails at the Node check. That failure is expected and harmless (live site untouched).

## Upgrade steps (as root)

```bash
# 1. What is installed and where it came from
node -v
which node                      # expected: /usr/bin/node
apt-cache policy nodejs         # expected: a NodeSource origin (deb.nodesource.com)
```

If `apt-cache policy` does **not** show NodeSource (e.g. Node came from nvm, snap, or Ubuntu's own repo), stop and adapt the next step to that source. The app only needs `/usr/bin/node` (and the deploy user's `node`/`npm` on `PATH`) to be 24.22.1 or newer.

```bash
# 2. Install Node 24 from NodeSource
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs

# 3. Confirm, also as the deploy user
node -v                                         # v24.22.1 or newer
sudo -u website-deployer -i node -v             # same version
sudo -u website-deployer -i npm -v

# 4. The perf recorder runs /usr/bin/node directly
systemctl restart cpu-capture
systemctl is-active cpu-capture
```

Then run **Deploy to VPS** (step 3 above).

**Do not** just `systemctl restart website` after upgrading. If the major version changed (for example 20 or 22 → 24), the live release's native modules were compiled for the old Node and will not load. Only a fresh deploy (`npm ci` on the new Node) fixes that.

## Verify after the deploy

- Actions log shows `[deploy] node v24.x.x OK`, then `[deploy] done <sha>`.
- `curl -fsS http://127.0.0.1:5000/health` and `curl -fsS http://127.0.0.1:3001/health` both succeed.
- Settings → Server in the admin shows a new Boot ID.
- Public pages load; staff login works; `/mcp` responds.

## If something goes wrong

- **Deploy fails at the Node check:** Node on the droplet is still old, or the deploy user sees a different `node` on `PATH`. Re-check step 3.
- **Deploy fails health and rolls back, and the rolled-back site also fails:** expected after a major-version jump. Older releases were built for the old Node. Fix forward: redeploy the latest `main` (re-run the workflow). Do not flip `current` to an old release by hand after a major upgrade.
- **Boot error `NODE_MODULE_VERSION ... was compiled against a different Node.js version`:** native modules were not rebuilt. Make sure the deployed commit includes `allowScripts` in `package.json`, then redeploy.
- **Emergency only, to get the site up on the old Node:** reinstall the previous Node major from NodeSource (`setup_<old>.x`), then redeploy. The deploy check will block it, so this also needs a temporary revert of `require_patched_node` in `scripts/deploy.sh`. Treat it as a short-lived exception.

## When done

- Reply to the dev team with the output of `node -v` on the droplet and the successful deploy SHA.
- Delete this file in the next app commit.
