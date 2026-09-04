import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AskActivityGateCopy,
  formatAskActivityGateCopy,
  SolveWithAiAgentDropdown,
} from "@/components/DebugBubble/SolveWithAiAgentDropdown";

describe("formatAskActivityGateCopy", () => {
  it("softens zero writes (2C)", () => {
    expect(formatAskActivityGateCopy(0, 14)).toBe(
      "No recent writes on this entry in the past 14 days. You can still check activity, then ask an agent.",
    );
  });

  it("warns on positive write counts with singular/plural", () => {
    expect(formatAskActivityGateCopy(1, 14)).toContain("1 write on this entry");
    expect(formatAskActivityGateCopy(1, 14)).not.toContain("1 writes");
    expect(formatAskActivityGateCopy(3, 14)).toContain("3 writes on this entry");
    expect(formatAskActivityGateCopy(3, 14)).toContain("past 14 days");
  });
});

describe("AskActivityGateCopy", () => {
  it("renders write count and days as badges", () => {
    const html = renderToStaticMarkup(
      <AskActivityGateCopy writeCount={5} windowDays={14} testId="gate" />,
    );
    expect(html).toContain('data-testid="gate-writes-badge"');
    expect(html).toContain('data-testid="gate-days-badge"');
    expect(html).toContain('data-testid="gate-warning-icon"');
    expect(html).toContain("5 writes");
    expect(html).toContain("14 days");
  });

  it("omits writes badge when count is zero", () => {
    const html = renderToStaticMarkup(
      <AskActivityGateCopy writeCount={0} windowDays={14} testId="gate" />,
    );
    expect(html).not.toContain("writes-badge");
    expect(html).toContain('data-testid="gate-days-badge"');
    expect(html).toContain("No recent writes");
  });
});

describe("SolveWithAiAgentDropdown", () => {
  function renderDropdown(opts: { entryKey?: string; writeCount?: number }) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <SolveWithAiAgentDropdown
          prompt="Fix this page"
          testId="ask-test"
          onAgentSelect={() => {}}
          entryKey={opts.entryKey}
          writeCount={opts.writeCount}
        />
      </QueryClientProvider>,
    );
  }

  it("renders trigger without entryKey (flat menu 4B)", () => {
    const html = renderDropdown({});
    expect(html).toContain('data-testid="button-ask-test"');
    expect(html).not.toContain("entry-activity");
  });

  it("mounts activity dialog sibling when entryKey is set", () => {
    const html = renderDropdown({ entryKey: "page/home/en", writeCount: 3 });
    expect(html).toContain('data-testid="button-ask-test"');
  });
});
