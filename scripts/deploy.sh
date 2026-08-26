#!/usr/bin/env bash
# Atomic deploy: build into releases/<sha>, link persistent runtime data, flip current.
#
# Sites (site_*): real dirs in the release (not symlinked from persistent/ — avoids
# Dirent.isDirectory() false on per-child symlinks that broke the commit queue).
# Blocking content:pull runs before flip so the tree is not empty at cutover.
# .bootstrap-complete is cleared so boot hash-diff realigns (catches content pushes
# that landed during npm ci/build).
#
# Deploy lock lives in this script (not the Actions SSH observer) so cancel-in-progress
# cannot drop the lock while work continues. Abort flag (.deploy-state/<sha>.abort) is
# checked before npm ci and before flip; post-flip abort is ignored.
#
# Never rm -rf the live release (current); same-SHA redeploy → releases/<sha>.rebuild-<pid>.
# Required env: DEPLOY_SHA (full git commit).
# Optional: WEBSITE_RUNTIME_B64 (packed _WEBSITE_ secrets; empty → reuse prior .env).
set -euo pipefail

APP_ROOT=/opt/website-v3
KEEP_RELEASES=5
HEALTH_TRIES=60
HEALTH_SLEEP=2
STATE_DIR="$APP_ROOT/.deploy-state"
LOCK_DIR="/tmp/website-v3-deploy.lock"
LOCK_WAIT_SECONDS=10
LOCK_TIMEOUT_SECONDS=900
LOCK_STALE_SECONDS=1800

: "${DEPLOY_SHA:?DEPLOY_SHA is required}"

if [[ ! "$DEPLOY_SHA" =~ ^[0-9a-f]{7,40}$ ]]; then
  echo "ERROR: DEPLOY_SHA must be a git commit hash (got: $DEPLOY_SHA)" >&2
  exit 1
fi

# Directory name under releases/ (usually $DEPLOY_SHA; may be $DEPLOY_SHA.rebuild-<pid>
# when that SHA is already live — we never rm -rf the tree current points at).
RELEASE_NAME="$DEPLOY_SHA"
RELEASE="$APP_ROOT/releases/$RELEASE_NAME"
PERSISTENT="$APP_ROOT/persistent"
CURRENT_LINK="$APP_ROOT/current"
ABORT_FLAG="$STATE_DIR/${DEPLOY_SHA}.abort"

mkdir -p "$APP_ROOT/releases" "$PERSISTENT" "$STATE_DIR"

# Resolved path of the live release, or empty if current is missing/broken.
live_release_path() {
  if [[ -L "$CURRENT_LINK" ]]; then
    readlink -f "$CURRENT_LINK" 2>/dev/null || true
  elif [[ -d "$CURRENT_LINK" ]]; then
    readlink -f "$CURRENT_LINK" 2>/dev/null || true
  else
    echo ""
  fi
}

# Abort if path is the live tree. Call before any rm -rf of a release dir.
assert_not_live_release() {
  local path="$1"
  local live
  live="$(live_release_path)"
  [[ -n "$live" && -e "$path" ]] || return 0
  if [[ "$(readlink -f "$path")" == "$live" ]]; then
    echo "ERROR: refusing to remove live release: $path (current → $live)" >&2
    exit 1
  fi
}

# content_folder values from sites.yml (site_* only).
list_sites_yml_folders() {
  local yml="$1"
  [[ -f "$yml" ]] || return 0
  python3 - "$yml" <<'PY'
import sys
from pathlib import Path
try:
    import yaml
except ImportError:
    yaml = None
text = Path(sys.argv[1]).read_text(encoding="utf-8")
folders = set()
if yaml is not None:
    data = yaml.safe_load(text) or {}
    if isinstance(data, dict):
        for key, val in data.items():
            if key in ("bucket_name",) or not isinstance(val, dict):
                continue
            cf = val.get("content_folder")
            if isinstance(cf, str) and cf.startswith("site_"):
                folders.add(cf)
else:
    import re
    for m in re.finditer(r"content_folder:\s*(\S+)", text):
        cf = m.group(1).strip().strip("\"'")
        if cf.startswith("site_"):
            folders.add(cf)
for cf in sorted(folders):
    print(cf)
PY
}

abort_requested() {
  [[ -f "$ABORT_FLAG" ]]
}

# Pre-flip only: discard this release and exit 0 (current untouched).
handle_abort() {
  echo "[deploy] abort requested for $DEPLOY_SHA — discarding release, current intact" >&2
  if [[ -n "${RELEASE:-}" && -d "$RELEASE" ]]; then
    assert_not_live_release "$RELEASE"
    chmod -R u+w "$RELEASE" 2>/dev/null || true
    rm -rf "$RELEASE"
  fi
  rm -f "$ABORT_FLAG"
  exit 0
}

lock_is_stale() {
  local pid_file="$LOCK_DIR/pid"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      return 1
    fi
    return 0
  fi
  local age
  age="$(( $(date +%s) - $(stat -c %Y "$LOCK_DIR" 2>/dev/null || echo 0) ))"
  [[ "$age" -ge "$LOCK_STALE_SECONDS" ]]
}

release_lock() {
  rm -rf "$LOCK_DIR"
}

acquire_lock() {
  local waited=0
  while ! mkdir "$LOCK_DIR" 2>/dev/null; do
    if [[ -f "$LOCK_DIR/sha" ]]; then
      local running_sha
      running_sha="$(cat "$LOCK_DIR/sha" 2>/dev/null || true)"
      if [[ -n "$running_sha" && "$running_sha" != "$DEPLOY_SHA" ]]; then
        mkdir -p "$STATE_DIR"
        touch "$STATE_DIR/${running_sha}.abort"
        echo "[deploy-lock] marked abort for $running_sha (superseded by $DEPLOY_SHA)"
      fi
    fi
    if lock_is_stale; then
      echo "[deploy-lock] removing stale lock (dead pid or aged lock)"
      rm -rf "$LOCK_DIR"
      continue
    fi
    if [[ "$waited" -ge "$LOCK_TIMEOUT_SECONDS" ]]; then
      echo "[deploy-lock] another deploy is still running after ${LOCK_TIMEOUT_SECONDS}s" >&2
      exit 1
    fi
    echo "[deploy-lock] another deploy is running; waiting ${LOCK_WAIT_SECONDS}s"
    sleep "$LOCK_WAIT_SECONDS"
    waited=$((waited + LOCK_WAIT_SECONDS))
  done
  # Own the lock dir first, clear stale abort for this SHA, then publish pid+sha.
  # Clearing before writing sha avoids wiping an abort another waiter just set for us;
  # not clearing before acquire avoids a same-SHA re-entry deleting another run's abort.
  echo $$ > "$LOCK_DIR/pid"
  rm -f "$ABORT_FLAG"
  echo "$DEPLOY_SHA" > "$LOCK_DIR/sha"
  trap release_lock EXIT
  echo "[deploy-lock] acquired for $DEPLOY_SHA (pid $$)"
}

acquire_lock

echo "[deploy] fetching $DEPLOY_SHA"
git -C "$APP_ROOT" fetch --prune origin "$DEPLOY_SHA"

LIVE_RELEASE="$(live_release_path)"
# Never wipe the tree that serves traffic. Same-SHA redeploy builds into a sibling.
if [[ -n "$LIVE_RELEASE" && -e "$RELEASE" && "$(readlink -f "$RELEASE")" == "$LIVE_RELEASE" ]]; then
  RELEASE_NAME="${DEPLOY_SHA}.rebuild-$$"
  RELEASE="$APP_ROOT/releases/$RELEASE_NAME"
  echo "[deploy] $DEPLOY_SHA is live at $LIVE_RELEASE — will not rm it"
  echo "[deploy] building into $RELEASE instead"
fi

if [[ -e "$RELEASE" ]]; then
  assert_not_live_release "$RELEASE"
  echo "[deploy] removing incomplete/previous tree at $RELEASE"
  chmod -R u+w "$RELEASE" 2>/dev/null || true
  rm -rf "$RELEASE"
fi

mkdir -p "$RELEASE"
echo "[deploy] extracting tree into $RELEASE"
git -C "$APP_ROOT" archive "$DEPLOY_SHA" | tar -x -C "$RELEASE"

link_persistent() {
  local name="$1"
  local target="$PERSISTENT/$name"
  local link="$RELEASE/$name"

  if [[ ! -e "$target" && ! -L "$target" ]]; then
    case "$name" in
      .cache|.local|data|snapshots)
        mkdir -p "$target"
        ;;
      .qdrant-initialized)
        : >"$target"
        ;;
      .multisite-user-store.json)
        echo '{}' >"$target"
        ;;
      sites.yml)
        echo "ERROR: $target missing — copy or restore sites.yml into persistent/" >&2
        exit 1
        ;;
      *)
        echo "ERROR: missing persistent path $target" >&2
        exit 1
        ;;
    esac
  fi

  ln -sfn "../../persistent/$name" "$link"
}

# Real empty site_* dirs; content:pull fills them before flip.
ensure_release_site_dirs() {
  local folder
  local -A seen=()

  echo "[deploy] ensuring real site_* dirs in release"
  while IFS= read -r folder; do
    [[ -n "$folder" ]] || continue
    [[ -n "${seen[$folder]:-}" ]] && continue
    seen[$folder]=1
    mkdir -p "$RELEASE/$folder"
    echo "[deploy] site dir ready: $RELEASE/$folder"
  done < <(list_sites_yml_folders "$PERSISTENT/sites.yml")

  if [[ ${#seen[@]} -eq 0 ]]; then
    echo "ERROR: no site_* content_folder entries in $PERSISTENT/sites.yml" >&2
    exit 1
  fi
}

# Drop bootstrap flags so the next boot hash-diff realigns (content pushes during build).
clear_bootstrap_complete_flags() {
  local folder
  echo "[deploy] clearing .bootstrap-complete so boot re-aligns content"
  while IFS= read -r folder; do
    [[ -n "$folder" ]] || continue
    rm -f "$RELEASE/$folder/.bootstrap-complete"
  done < <(list_sites_yml_folders "$PERSISTENT/sites.yml")

  # Leftover hybrid layout under persistent/
  shopt -s nullglob
  for flag in "$PERSISTENT"/site_*/.bootstrap-complete; do
    rm -f "$flag"
    echo "[deploy] removed $flag"
  done
  shopt -u nullglob
}

echo "[deploy] linking persistent paths"
for name in sites.yml data .cache .local .multisite-user-store.json .qdrant-initialized snapshots; do
  link_persistent "$name"
done

ensure_release_site_dirs

# Bump version.json in the release only (not committed to git). Read the live
# current release so repeated deploys increment correctly; fall back to the
# archived tree from this commit.
bump_release_version() {
  local dest="$RELEASE/version.json"
  local prior=""
  if [[ -e "$CURRENT_LINK/version.json" ]]; then
    prior="$CURRENT_LINK/version.json"
  elif [[ -e "$dest" ]]; then
    prior="$dest"
  fi
  PRIOR_VERSION_JSON="$prior" DEST_VERSION_JSON="$dest" python3 <<'PY'
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

prior_path = (os.environ.get("PRIOR_VERSION_JSON") or "").strip()
dest_path = Path(os.environ["DEST_VERSION_JSON"])

data = {"version": "1.0.0"}
if prior_path:
    try:
        data = json.loads(Path(prior_path).read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"[deploy] WARNING: could not read {prior_path}: {exc}", flush=True)

version = str(data.get("version") or "1.0.0")
parts = version.split(".")
if len(parts) != 3:
    print(f"[deploy] WARNING: unexpected version format '{version}', skipping bump", flush=True)
    sys.exit(0)

try:
    parts[2] = str(int(parts[2]) + 1)
except ValueError:
    print(f"[deploy] WARNING: non-numeric patch in '{version}', skipping bump", flush=True)
    sys.exit(0)

new_version = ".".join(parts)
deployed_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
payload = {"version": new_version, "deployedAt": deployed_at}
dest_path.write_text(json.dumps(payload) + "\n", encoding="utf-8")
print(
    f"[deploy] version bumped: {version} → {new_version} (deployedAt={deployed_at})",
    flush=True,
)
PY
}

bump_release_version

copy_prior_env() {
  local dest="$1"
  echo "[deploy] reusing prior .env"
  if [[ -e "$CURRENT_LINK/.env" ]]; then
    cp -a "$CURRENT_LINK/.env" "$dest"
  elif [[ -e "$APP_ROOT/.env" ]]; then
    cp -a "$APP_ROOT/.env" "$dest"
  else
    echo "ERROR: no WEBSITE_RUNTIME_B64 keys and no prior .env to copy" >&2
    exit 1
  fi
}

write_env() {
  local dest="$RELEASE/.env"
  local b64="${WEBSITE_RUNTIME_B64:-}"
  if [[ -z "$b64" ]]; then
    copy_prior_env "$dest"
    return
  fi
  # Non-empty b64 may still decode to {} (no _WEBSITE_ keys packed).
  if ! WEBSITE_RUNTIME_B64="$b64" DEST_ENV="$dest" CURRENT_LINK="$CURRENT_LINK" APP_ROOT="$APP_ROOT" python3 <<'PY'
import base64
import grp
import json
import os
import re
import sys
from pathlib import Path

dest = Path(os.environ["DEST_ENV"])
raw = (os.environ.get("WEBSITE_RUNTIME_B64") or "").strip()
data = json.loads(base64.b64decode(raw)) if raw else {}
if not data:
    sys.exit(2)

current_link = Path(os.environ.get("CURRENT_LINK") or "")
app_root = Path(os.environ.get("APP_ROOT") or "")

def parse_env_line(line: str) -> tuple[str, str] | None:
    line = line.strip()
    if not line or line.startswith("#"):
        return None
    m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line)
    if not m:
        return None
    key, val = m.group(1), m.group(2)
    if len(val) >= 2 and val[0] == val[-1] and val[0] in ("'", '"'):
        val = val[1:-1]
    return key, val

def load_prior_env() -> dict[str, str]:
    merged: dict[str, str] = {}
    for candidate in (current_link / ".env", app_root / ".env"):
        if not candidate.is_file():
            continue
        try:
            text = candidate.read_text(encoding="utf-8")
        except OSError:
            continue
        for line in text.splitlines():
            parsed = parse_env_line(line)
            if parsed:
                merged[parsed[0]] = parsed[1]
        if merged:
            break
    return merged

def bash_assign(name, value):
    return name + "=" + "'" + value.replace("'", "'\"'\"'") + "'"

prior = load_prior_env()
packed_count = len(data)
merged = dict(prior)
merged.update(data)

text = "\n".join(bash_assign(k, merged[k]) for k in sorted(merged)) + "\n"
tmp = dest.with_name(".env.tmp")
tmp.write_text(text, encoding="utf-8")
try:
    runtime_gid = grp.getgrnam("website-runtime").gr_gid
    os.chown(tmp, -1, runtime_gid)
except KeyError:
    print("[deploy] website-runtime group not found; keeping current group")
os.chmod(tmp, 0o640)
os.replace(tmp, dest)
print(
    f"[deploy] merged {packed_count} packed key(s) over prior .env "
    f"({len(merged)} total keys): {', '.join(sorted(data))}"
)
PY
  then
    local rc=$?
    if [[ "$rc" -eq 2 ]]; then
      copy_prior_env "$dest"
    else
      exit "$rc"
    fi
  fi
}

write_env

abort_requested && handle_abort

echo "[deploy] building in $RELEASE"
cd "$RELEASE"
unset NODE_ENV
npm ci --include=dev
ln -sfn "$(pwd)/shared" node_modules/@shared
set -a
# shellcheck disable=SC1091
source .env
set +a
if [[ -z "${TURNSTILE_SITE_KEY:-}" || -z "${TURNSTILE_SECRET_KEY:-}" ]]; then
  echo "ERROR: TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are required." >&2
  exit 1
fi

echo "[deploy] pulling content (blocking, pre-flip)"
npm run content:pull -- --required

echo "[deploy] compiling"
npm run build

abort_requested && handle_abort

echo "[deploy] validating pipeline SQLite migrations (dry-run)"
npm run ensure:pipeline-db -- --dry-run
abort_requested && handle_abort

# Intentionally clear flags after pull wrote them — boot hash-diff catches newer content.
clear_bootstrap_complete_flags

PREV_TARGET=""
if [[ -L "$CURRENT_LINK" || -d "$CURRENT_LINK" ]]; then
  PREV_TARGET="$(readlink -f "$CURRENT_LINK" || true)"
fi

echo "[deploy] pointing current -> releases/$RELEASE_NAME"
ln -sfn "releases/$RELEASE_NAME" "$CURRENT_LINK"

restart_website() {
  if systemctl cat website.service >/dev/null 2>/dev/null; then
    sudo systemctl restart website
  else
    echo "[deploy] website.service not installed — skip restart"
  fi
}

restart_website

rollback() {
  echo "[deploy] health failed — rolling back current" >&2
  if [[ -n "$PREV_TARGET" && -d "$PREV_TARGET" ]]; then
    ln -sfn "releases/$(basename "$PREV_TARGET")" "$CURRENT_LINK"
    restart_website
  else
    echo "[deploy] no previous release to restore" >&2
  fi
  # Drop failed sibling build (never the rolled-back live tree).
  if [[ -d "$RELEASE" && "$RELEASE" != "$PREV_TARGET" ]]; then
    assert_not_live_release "$RELEASE"
    echo "[deploy] removing failed build $RELEASE" >&2
    chmod -R u+w "$RELEASE" 2>/dev/null || true
    rm -rf "$RELEASE"
  fi
}

echo "[deploy] waiting for health"
ok=0
for _ in $(seq 1 "$HEALTH_TRIES"); do
  if curl -fsS http://127.0.0.1:5000/health >/dev/null; then
    curl -fsS http://127.0.0.1:5000/health || true
    echo
    ok=1
    break
  fi
  sleep "$HEALTH_SLEEP"
done

if [[ "$ok" -ne 1 ]]; then
  rollback
  echo "ERROR: app did not become healthy within $((HEALTH_TRIES * HEALTH_SLEEP))s" >&2
  exit 1
fi

echo "[deploy] pruning old releases (keep active + $KEEP_RELEASES others)"
ACTIVE="$(live_release_path)"
# shellcheck disable=SC2012
mapfile -t ALL_RELEASES < <(ls -1dt "$APP_ROOT"/releases/*/ 2>/dev/null | sed 's:/*$::' || true)
others=0
for dir in "${ALL_RELEASES[@]:-}"; do
  [[ -n "$dir" ]] || continue
  if [[ -n "$ACTIVE" && "$dir" == "$ACTIVE" ]]; then
    continue
  fi
  others=$((others + 1))
  if [[ "$others" -gt "$KEEP_RELEASES" ]]; then
    assert_not_live_release "$dir"
    echo "[deploy] removing $dir"
    chmod -R u+w "$dir" 2>/dev/null || true
    rm -rf "$dir"
  fi
done

echo "[deploy] pruning .deploy-state older than 7 days"
find "$STATE_DIR" -maxdepth 1 \( -name '*.log' -o -name '*.done' -o -name '*.abort' \) \
  -mtime +7 -type f -delete 2>/dev/null || true

WD="$(systemctl show -p WorkingDirectory --value website.service 2>/dev/null || true)"
if [[ -n "$WD" && "$WD" != "$CURRENT_LINK" && "$WD" != "$CURRENT_LINK/" ]]; then
  echo "[deploy] WARNING: website.service WorkingDirectory is '$WD'" >&2
  echo "[deploy] WARNING: set it to $CURRENT_LINK (and EnvironmentFile=$CURRENT_LINK/.env) so restarts use this release." >&2
fi

rm -f "$ABORT_FLAG"
echo "[deploy] done $DEPLOY_SHA (current → releases/$RELEASE_NAME)"
