import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildGithubCommitFileUrl } from "@shared/github-commit-file-url";
import {
  buildEntryActivityEventFocusHref,
  buildEntryActivityEventLogHref,
  EntryActivityBadge,
  resetActivityModalSelection,
} from "@/components/pipeline/EntryActivityBadge";
import { ENTRY_ACTIVITY_PAGE_SIZE } from "@/components/pipeline/entryActivityCopy";
import { EVENT_LOG_SHOW_AROUND_HALF_MS } from "@/components/pipeline/event-log-url";

function renderBadge(writeCount: number) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <EntryActivityBadge entryKey="page/home/en" writeCount={writeCount} testIdPrefix="act" />
    </QueryClientProvider>,
  );
}

describe("EntryActivityBadge", () => {
  it("renders zero and positive write counts on the dialog trigger", () => {
    const zero = renderBadge(0);
    expect(zero).toContain("0 writes");
    expect(zero).toContain('data-testid="act-badge"');
    expect(zero).toContain("in the last 14 days");

    const one = renderBadge(1);
    expect(one).toContain("1 write");
    expect(one).not.toContain("1 writes");
  });

  it("builds event-log href for entry + people/agents writes", () => {
    expect(buildEntryActivityEventLogHref("blog/hello/en")).toBe(
      "/private/background-pipeline?entry=blog%2Fhello%2Fen&actor=people,agents&kind=writes",
    );
  });

  it("builds detail event-log href with ±1h window and event hash", () => {
    const createdAt = 1_700_000_000_000;
    expect(buildEntryActivityEventFocusHref(12615, createdAt)).toBe(
      `/private/background-pipeline?starting_at=${createdAt - EVENT_LOG_SHOW_AROUND_HALF_MS}&ending_at=${createdAt + EVENT_LOG_SHOW_AROUND_HALF_MS}#event-12615`,
    );
  });

  it("resets selection on close (list view)", () => {
    expect(resetActivityModalSelection()).toBeNull();
  });

  it("pages activity with Load more batch size 30", () => {
    expect(ENTRY_ACTIVITY_PAGE_SIZE).toBe(30);
  });

  it("builds GitHub commit file URL when sha and path exist", () => {
    const href = buildGithubCommitFileUrl({
      repoUrl: "https://github.com/acme/content",
      commitSha: "deadbeef",
      path: "site_x/blog/y/en.yml",
    });
    expect(href).toContain("https://github.com/acme/content/commit/deadbeef#diff-");
    expect(href).not.toContain("main");
  });
});
