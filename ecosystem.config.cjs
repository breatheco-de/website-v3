/**
 * pm2-runtime ecosystem — production process supervisor.
 * Started by scripts/start-production.sh under website.service.
 */
const fs = require("fs");
const path = require("path");

const root = __dirname;
/** @type {import('pm2').StartOptions[]} */
const apps = [];

apps.push({
  name: "web",
  cwd: root,
  script: "dist/index.js",
  instances: 1,
  exec_mode: "fork",
  kill_timeout: 10_000,
  env: {
    NODE_ENV: "production",
  },
});

if (fs.existsSync(path.join(root, "dist/mcp-server.js"))) {
  apps.push({
    name: "mcp",
    cwd: root,
    script: "dist/mcp-server.js",
    node_args: "--max-old-space-size=1024",
    max_memory_restart: "1G",
    exp_backoff_restart_delay: 200,
    kill_timeout: 8_000,
    env: {
      NODE_ENV: "production",
    },
  });
}

apps.push({
  name: "sidequest",
  cwd: root,
  script: "dist/sidequest-worker.js",
  kill_timeout: 30_000,
  exp_backoff_restart_delay: 500,
  env: {
    NODE_ENV: "production",
  },
});

const qdrantBin = path.join(root, ".local/bin/qdrant");
if (fs.existsSync(qdrantBin)) {
  apps.push({
    name: "qdrant",
    cwd: root,
    script: qdrantBin,
    interpreter: "none",
    env: {
      QDRANT__SERVICE__HOST: "127.0.0.1",
      QDRANT__SERVICE__HTTP_PORT: "6333",
      QDRANT__STORAGE__STORAGE_PATH: path.join(root, ".cache/qdrant-storage"),
    },
  });
}

module.exports = { apps };
