#!/usr/bin/env bash
# Production entrypoint: main Express app + MCP server (proxied via /mcp).
# MCP is best-effort — if it fails to start, the website still comes up.
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

MCP_PID=""
QDRANT_PID=""

cleanup() {
  if [[ -n "${MCP_PID}" ]] && kill -0 "${MCP_PID}" 2>/dev/null; then
    kill -TERM "${MCP_PID}" 2>/dev/null || true
    # Allow MCP SIGTERM handler to flush debounced GCS auth writes (~5s max)
    for _ in $(seq 1 25); do
      kill -0 "${MCP_PID}" 2>/dev/null || break
      sleep 0.2
    done
    kill -KILL "${MCP_PID}" 2>/dev/null || true
    wait "${MCP_PID}" 2>/dev/null || true
  fi
  if [[ -n "${QDRANT_PID}" ]] && kill -0 "${QDRANT_PID}" 2>/dev/null; then
    kill "${QDRANT_PID}" 2>/dev/null || true
    wait "${QDRANT_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# ── Qdrant vector store (best-effort) ────────────────────────────────────────
QDRANT_BIN="${ROOT}/.local/bin/qdrant"
QDRANT_VERSION="v1.13.4"
STORAGE_DIR="${ROOT}/.cache/qdrant-storage"
MODEL_CACHE_DIR="${ROOT}/.cache/xenova-models"

mkdir -p "${ROOT}/.local/bin" "${STORAGE_DIR}" "${MODEL_CACHE_DIR}"

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

if [[ -f "${QDRANT_BIN}" ]]; then
  QDRANT__SERVICE__HOST=127.0.0.1 \
  QDRANT__SERVICE__HTTP_PORT=6333 \
  QDRANT__STORAGE__STORAGE_PATH="${STORAGE_DIR}" \
  "${QDRANT_BIN}" &
  QDRANT_PID=$!
  sleep 1
  if ! kill -0 "${QDRANT_PID}" 2>/dev/null; then
    echo "[start] Qdrant exited early — semantic search will be unavailable" >&2
    QDRANT_PID=""
  else
    echo "[start] Qdrant started (pid ${QDRANT_PID}) on port 6333"
  fi
else
  echo "[start] Qdrant binary not found — skipping" >&2
fi

# ── MCP server (best-effort) ─────────────────────────────────────────────────
if [[ -f dist/mcp-server.js ]]; then
  node dist/mcp-server.js &
  MCP_PID=$!
  sleep 0.5
  if ! kill -0 "${MCP_PID}" 2>/dev/null; then
    echo "[start] MCP server exited early — continuing with main app only" >&2
    MCP_PID=""
  else
    echo "[start] MCP server started (pid ${MCP_PID}) on port ${MCP_PORT:-3001}"
  fi
else
  echo "[start] dist/mcp-server.js not found — skipping MCP" >&2
fi

node dist/index.js
