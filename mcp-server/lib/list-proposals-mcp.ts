/**
 * Stats-first helpers for list_proposals MCP tool.
 */

export type ListProposalsArgs = {
  proposal_id?: string;
  query?: string;
  status?: string;
  kind?: string;
  issue_id?: string;
  limit?: number;
  offset?: number;
};

export function isProposalsScoped(args: ListProposalsArgs): boolean {
  return Boolean(
    args.proposal_id?.trim() ||
      args.query?.trim() ||
      args.issue_id?.trim() ||
      args.status ||
      args.kind,
  );
}

export function clampProposalLimit(limit?: number): number {
  if (limit == null || !Number.isFinite(limit)) return 20;
  return Math.min(200, Math.max(1, Math.floor(limit)));
}

export function clampProposalOffset(offset?: number): number {
  if (offset == null || !Number.isFinite(offset)) return 0;
  return Math.max(0, Math.floor(offset));
}

export function proposalNextOffset(
  offset: number,
  limit: number,
  total: number,
  pageLen: number,
): number | null {
  const next = offset + pageLen;
  return next < total ? next : null;
}
