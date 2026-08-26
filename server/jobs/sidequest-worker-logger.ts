/**
 * File logger for the dedicated Sidequest worker process.
 */

import fs from "fs";
import path from "path";
import pino from "pino";
import { SIDEQUEST_LOG_PATH } from "./queue";

const MAX_LOG_BYTES = 2 * 1024 * 1024;
const TRUNCATE_KEEP_BYTES = 512 * 1024;

function truncateLogIfNeeded(): void {
  try {
    const stat = fs.statSync(SIDEQUEST_LOG_PATH);
    if (stat.size <= MAX_LOG_BYTES) return;
    const fd = fs.openSync(SIDEQUEST_LOG_PATH, "r");
    const start = Math.max(0, stat.size - TRUNCATE_KEEP_BYTES);
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    fs.writeFileSync(SIDEQUEST_LOG_PATH, buf);
  } catch {
    // missing or unreadable — worker will create on first write
  }
}

export function createSidequestWorkerLogger(): pino.Logger {
  fs.mkdirSync(path.dirname(SIDEQUEST_LOG_PATH), { recursive: true });
  truncateLogIfNeeded();
  const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug");
  const fileStream = pino.destination({ dest: SIDEQUEST_LOG_PATH, sync: false, mkdir: true });
  if (process.env.NODE_ENV !== "production") {
    return pino(
      { level, base: { module: "sidequest-worker" } },
      pino.multistream([
        { stream: process.stdout, level },
        { stream: fileStream, level },
      ]),
    );
  }
  return pino({ level, base: { module: "sidequest-worker" } }, fileStream);
}
