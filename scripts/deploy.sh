#!/usr/bin/env bash
# Atomic deploy: build into releases/<sha>, link persistent data, flip current.
# Sites: content/YAML symlinked from persistent/; component-registry copied into the
# release so relative imports from shared/schema.ts resolve correctly.
# Required env: DEPLOY_SHA (full git commit).
# Optional: WEBSITE_RUNTIME_B64 (packed _WEBSITE_ secrets; empty → reuse prior .env).
set -euo pipefail

APP_ROOT=/opt/website-v3
KEEP_RELEASES=5
HEALTH_TRIES=60
HEALTH_SLEEP=2

: "${DEPLOY_SHA:?DEPLOY_SHA is required}"

if [[ ! "$DEPLOY_SHA" =~ ^[0-9a-f]{7,40}$ ]]; then
  echo "ERROR: DEPLOY_SHA must be a git commit hash (got: $DEPLOY_SHA)" >&2
  exit 1
fi

RELEASE="$APP_ROOT/releases/$DEPLOY_SHA"
PERSISTENT="$APP_ROOT/persistent"
CURRENT_LINK="$APP_ROOT/current"

mkdir -p "$APP_ROOT/releases" "$PERSISTENT"

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

# Move real site_* dirs into persistent/ and put a symlink back (no app downtime hole).
adopt_site_path() {
  local src="$1"
  local name
  name="$(basename "$src")"
  local dest="$PERSISTENT/$name"

  [[ "$name" == site_* ]] || return 0
  if [[ -L "$src" ]]; then
    return 0
  fi
  if [[ ! -d "$src" ]]; then
    return 0
  fi

  if [[ -e "$dest" || -L "$dest" ]]; then
    echo "[deploy] adopt skip $name: $dest already exists (leaving $src as real dir)" >&2
    return 0
  fi

  echo "[deploy] adopting $src -> $dest"
  mv "$src" "$dest"
  ln -sfn "$dest" "$src"
}

adopt_into_persistent() {
  echo "[deploy] adopting real site_* dirs into persistent/"
  local -A seen=()
  local p name

  shopt -s nullglob
  for p in "$CURRENT_LINK"/site_* "$APP_ROOT"/site_*; do
    [[ -e "$p" || -L "$p" ]] || continue
    name="$(basename "$p")"
    [[ -n "${seen[$name]:-}" ]] && continue
    seen[$name]=1
    adopt_site_path "$p"
  done
  shopt -u nullglob

  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    [[ -n "${seen[$name]:-}" ]] && continue
    seen[$name]=1
    if [[ -e "$CURRENT_LINK/$name" || -L "$CURRENT_LINK/$name" ]]; then
      adopt_site_path "$CURRENT_LINK/$name"
    elif [[ -e "$APP_ROOT/$name" || -L "$APP_ROOT/$name" ]]; then
      adopt_site_path "$APP_ROOT/$name"
    fi
  done < <(list_sites_yml_folders "$PERSISTENT/sites.yml")
}

echo "[deploy] fetching $DEPLOY_SHA"
git -C "$APP_ROOT" fetch --prune origin "$DEPLOY_SHA"

adopt_into_persistent

if [[ -e "$RELEASE" ]]; then
  echo "[deploy] removing incomplete/previous tree at $RELEASE"
  # Safe: release dirs are never the persistent target; only relative symlinks out.
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

# site_*: YAML/content → symlink into persistent; component-registry → real copy in the
# release so shared/schema.ts relative imports resolve next to shared/ (not persistent/shared).
link_site_hybrid() {
  local name="$1"
  local src="$PERSISTENT/$name"
  local dest="$RELEASE/$name"
  local child base

  [[ "$name" == site_* ]] || {
    echo "ERROR: link_site_hybrid expected site_* name, got $name" >&2
    exit 1
  }

  if [[ ! -e "$src" && ! -L "$src" ]]; then
    mkdir -p "$src"
    echo "[deploy] created empty $src (new site folder)"
  fi
  if [[ -L "$src" ]]; then
    src="$(readlink -f "$src")"
  fi
  if [[ ! -d "$src" ]]; then
    echo "ERROR: persistent site path is not a directory: $src" >&2
    exit 1
  fi

  rm -rf "$dest"
  mkdir -p "$dest"

  shopt -s nullglob
  for child in "$src"/* "$src"/.[!.]* "$src"/..?*; do
    [[ -e "$child" || -L "$child" ]] || continue
    base="$(basename "$child")"
    [[ "$base" == "." || "$base" == ".." ]] && continue
    if [[ "$base" == "component-registry" ]]; then
      continue
    fi
    ln -sfn "$child" "$dest/$base"
  done
  shopt -u nullglob

  if [[ -d "$src/component-registry" ]]; then
    cp -a "$src/component-registry" "$dest/component-registry"
    echo "[deploy] copied $name/component-registry into release (not symlinked)"
  else
    # Do not mkdir an empty registry: sites with inherit_components_from must omit
    # the directory entirely (schema:sync / registry-resolve enforce parent-only).
    echo "[deploy] no component-registry in $src — leaving absent in release"
  fi
}

echo "[deploy] linking persistent paths"
for name in sites.yml data .cache .local .multisite-user-store.json .qdrant-initialized snapshots; do
  link_persistent "$name"
done

echo "[deploy] linking sites (hybrid: content symlink, registry copy)"
declare -A linked_sites=()
shopt -s nullglob
for dir in "$PERSISTENT"/site_*; do
  [[ -d "$dir" || -L "$dir" ]] || continue
  name="$(basename "$dir")"
  linked_sites[$name]=1
  link_site_hybrid "$name"
done
shopt -u nullglob

while IFS= read -r folder; do
  [[ -n "$folder" ]] || continue
  [[ -n "${linked_sites[$folder]:-}" ]] && continue
  linked_sites[$folder]=1
  link_site_hybrid "$folder"
done < <(list_sites_yml_folders "$PERSISTENT/sites.yml")

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
  if ! WEBSITE_RUNTIME_B64="$b64" DEST_ENV="$dest" python3 <<'PY'
import base64
import grp
import json
import os
import sys
from pathlib import Path

dest = Path(os.environ["DEST_ENV"])
raw = (os.environ.get("WEBSITE_RUNTIME_B64") or "").strip()
data = json.loads(base64.b64decode(raw)) if raw else {}
if not data:
    sys.exit(2)

def bash_assign(name, value):
    return name + "=" + "'" + value.replace("'", "'\"'\"'") + "'"

text = "\n".join(bash_assign(k, data[k]) for k in sorted(data)) + "\n"
tmp = dest.with_name(".env.tmp")
tmp.write_text(text, encoding="utf-8")
try:
    runtime_gid = grp.getgrnam("website-runtime").gr_gid
    os.chown(tmp, -1, runtime_gid)
except KeyError:
    print("[deploy] website-runtime group not found; keeping current group")
os.chmod(tmp, 0o640)
os.replace(tmp, dest)
print("[deploy] wrote", dest, "keys:", ", ".join(sorted(data)))
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
npm run build

PREV_TARGET=""
if [[ -L "$CURRENT_LINK" ]]; then
  PREV_TARGET="$(readlink -f "$CURRENT_LINK" || true)"
fi

echo "[deploy] pointing current -> releases/$DEPLOY_SHA"
ln -sfn "releases/$DEPLOY_SHA" "$CURRENT_LINK"

restart_website() {
  if systemctl cat website.service >/dev/null 2>&1; then
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
ACTIVE="$(readlink -f "$CURRENT_LINK" || true)"
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
    echo "[deploy] removing $dir"
    chmod -R u+w "$dir" 2>/dev/null || true
    rm -rf "$dir"
  fi
done

WD="$(systemctl show -p WorkingDirectory --value website.service 2>/dev/null || true)"
if [[ -n "$WD" && "$WD" != "$CURRENT_LINK" && "$WD" != "$CURRENT_LINK/" ]]; then
  echo "[deploy] WARNING: website.service WorkingDirectory is '$WD'" >&2
  echo "[deploy] WARNING: set it to $CURRENT_LINK (and EnvironmentFile=$CURRENT_LINK/.env) so restarts use this release." >&2
fi

echo "[deploy] done $DEPLOY_SHA"
