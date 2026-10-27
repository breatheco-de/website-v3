/** Poll a diagnostics job until it leaves queued/running. */

import { apiFetch } from "./queryClient";

export type DiagnosticsJobPoll = {
  status: string;
  job_id?: string;
  retry_after_seconds?: number;
  message?: string;
  error?: string;
  code?: string;
  reportPath?: string;
  summary?: { errorCount?: number; warningCount?: number };
  validators?: unknown[];
  purpose?: { type?: string; issueId?: string };
};

export async function pollDiagnosticsJob(jobId: string): Promise<DiagnosticsJobPoll> {
  for (;;) {
    const res = await apiFetch(`/api/validation/diagnostics-jobs/${encodeURIComponent(jobId)}`, {
      credentials: "include",
    });
    const data = (await res.json().catch(() => ({}))) as DiagnosticsJobPoll;
    if (res.status === 404 || data.status === "not_found" || data.status === "failed" || data.status === "completed") {
      return data;
    }
    if (!res.ok && data.status !== "queued" && data.status !== "running") {
      throw new Error(data.message || data.error || `Job poll failed (${res.status})`);
    }
    const waitMs = Math.min(5000, Math.max(1000, (data.retry_after_seconds ?? 2) * 1000));
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

export function startedJobId(body: { status?: string; job_id?: string } | null | undefined): string | null {
  if (!body?.job_id) return null;
  if (body.status === "queued" || body.status === "running") return body.job_id;
  return null;
}
