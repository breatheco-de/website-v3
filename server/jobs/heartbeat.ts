/**
 * Sidequest worker heartbeat job lifecycle — currentJob / lastJobFinishedAt for stuck detection.
 */

import { writeSidequestHeartbeat } from "./queue";

export function markJobStarted(jobName: string): void {
  writeSidequestHeartbeat({ pid: process.pid, currentJob: jobName });
}

export function markJobFinished(jobName: string): void {
  writeSidequestHeartbeat({
    pid: process.pid,
    currentJob: undefined,
    lastJobFinishedAt: new Date().toISOString(),
  });
  void jobName;
}
