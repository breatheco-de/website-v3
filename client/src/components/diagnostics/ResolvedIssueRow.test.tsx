import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ResolvedIssueRow, type ResolvedArchiveRow } from "./ResolvedIssueRow";

vi.mock("@/hooks/useFormatSitePath", () => ({
  useFormatSitePath: () => (p: string) => p,
}));

const REPORT = "Set seo.pillar_path: null on costa-rica es to opt out of clustering.";
const SUGGESTION = "Add a seo: block with pillar_path or pillar_path: null to opt out";

const baseRow: ResolvedArchiveRow = {
  issueId: "iss-1",
  entryKey: "location/costa-rica/es",
  url: "/es/costa-rica",
  severity: "warning",
  code: "ORPHAN_PAGE",
  message: 'location page "costa-rica" (es) has no seo block — it belongs to no cluster',
  validator: "seo-cluster",
  category: "seo",
  suggestion: SUGGESTION,
  file: "site_4geeks-com/locations/costa-rica/es.yml",
  resolvedAt: "2026-09-02T20:00:00.000Z",
  resolvedBy: "aalejo@gmail.com",
  actor: { type: "mcp", client: "Cursor", model: "Claude" },
  report: REPORT,
  resolution: "verified_gone",
};

function renderRow(props: Partial<React.ComponentProps<typeof ResolvedIssueRow>> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: async () => null } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ResolvedIssueRow row={baseRow} idx={0} {...props} />
    </QueryClientProvider>,
  );
}

describe("ResolvedIssueRow", () => {
  it("does not render the complete note while closed", () => {
    const html = renderRow();
    expect(html).toContain('data-testid="resolved-issue-row-0"');
    expect(html).toContain("ORPHAN_PAGE");
    expect(html).toContain("costa-rica");
    expect(html).not.toContain(REPORT);
    expect(html).not.toContain('data-testid="resolved-issue-report"');
  });

  it("shows suggested fix and complete note when open", () => {
    const html = renderRow({ defaultOpen: true });
    expect(html).toContain('data-testid="resolved-issue-report"');
    expect(html).toContain(REPORT);
    expect(html).toContain('data-testid="resolved-issue-suggestion"');
    expect(html).toContain(SUGGESTION);
  });

  it("shows no agent run attached when the row has no session id", () => {
    const html = renderRow({ defaultOpen: true });
    expect(html).toContain("No agent run attached.");
  });
});
