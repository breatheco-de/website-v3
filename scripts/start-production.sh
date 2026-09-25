#!/usr/bin/env bash
# Production entrypoint: pm2-runtime supervises web + MCP + Sidequest + Qdrant.
# systemd: website.service ExecStart=…/scripts/start-production.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export NODE_ENV="${NODE_ENV:-production}"

if [[ -z "${TURNSTILE_SITE_KEY:-}" ]]; then
  echo "ERROR: TURNSTILE_SITE_KEY is required in production. Set it and restart." >&2
  exit 1
fi
if [[ -z "${TURNSTILE_SECRET_KEY:-}" ]]; then
  echo "ERROR: TURNSTILE_SECRET_KEY is required in production. Set it and restart." >&2
  exit 1
fi

if [[ ! -f dist/index.js ]]; then
  echo "ERROR: dist/index.js not found. Run npm run build first." >&2
  exit 1
fi
if [[ ! -f dist/sidequest-worker.js ]]; then
  echo "ERROR: dist/sidequest-worker.js not found. Run npm run build first." >&2
  exit 1
fi
if [[ ! -f dist/sidequest.jobs.js ]]; then
  echo "ERROR: dist/sidequest.jobs.js not found. Run npm run build first." >&2
  exit 1
fi
if [[ ! -f ecosystem.config.cjs ]]; then
  echo "ERROR: ecosystem.config.cjs not found." >&2
  exit 1
fi

# ── Qdrant binary (best-effort download; pm2 starts it if present) ───────────
QDRANT_BIN="${ROOT}/.local/bin/qdrant"
QDRANT_VERSION="v1.13.4"
STORAGE_DIR="${ROOT}/.cache/qdrant-storage"
MODEL_CACHE_DIR="${ROOT}/.cache/xenova-models"

mkdir -p "${ROOT}/.local/bin" "${STORAGE_DIR}" "${MODEL_CACHE_DIR}" "${ROOT}/data"

if [[ ! -f "${QDRANT_BIN}" ]]; then
  echo "[start] Downloading Qdrant ${QDRANT_VERSION}..."
  TMP_DIR=$(mktemp -d)
  curl -fsSL -o "${TMP_DIR}/qdrant.tar.gz" \
    "https://github.com/qdrant/qdrant/releases/download/${QDRANT_VERSION}/qdrant-x86_64-unknown-linux-musl.tar.gz" \
    && tar -xzf "${TMP_DIR}/qdrant.tar.gz" -C "${TMP_DIR}" \
    && mv "${TMP_DIR}/qdrant" "${QDRANT_BIN}" \
    && chmod +x "${QDRANT_BIN}" \
    || echo "[start] Qdrant download failed — semantic search will be unavailable" >&2
  rm -rf "${TMP_DIR}"
fi

if [[ -f dist/mcp-server.js ]]; then
  echo "[start] MCP artifact present — pm2 will supervise mcp"
else
  echo "[start] dist/mcp-server.js not found — pm2 will skip mcp" >&2
fi

export PM2_HOME="${PM2_HOME:-$ROOT/data/.pm2}"
mkdir -p "${PM2_HOME}"

echo "[start] Starting pm2-runtime (web + sidequest + optional mcp/qdrant)"
exec npx pm2-runtime start ecosystem.config.cjs
