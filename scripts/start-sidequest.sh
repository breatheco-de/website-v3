#!/usr/bin/env bash
# Production Sidequest process — dedicated engine for background jobs.
# systemd: website-sidequest.service ExecStart=…/scripts/start-sidequest.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export NODE_ENV="${NODE_ENV:-production}"

if [[ ! -f dist/sidequest-worker.js ]]; then
  echo "ERROR: dist/sidequest-worker.js not found. Run npm run build first." >&2
  exit 1
fi

if [[ ! -f dist/sidequest.jobs.js ]]; then
  echo "ERROR: dist/sidequest.jobs.js not found. Run npm run build first." >&2
  exit 1
fi

echo "[start-sidequest] Sidequest starting (jobs do not run in Express)"
exec node dist/sidequest-worker.js
