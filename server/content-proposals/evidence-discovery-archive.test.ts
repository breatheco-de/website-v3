import { describe, expect, it } from "vitest";
import { buildEvidenceDiscoveryItems } from "./proposal-discovery-path";

const base = { domain: "a.com", database: "press_mentions", index: 0, label: "Forbes" };

function lookFor(row: Record<string, unknown>): string[] {
  const items = buildEvidenceDiscoveryItems(
    { outcome: "ok", claims: [{ name: "Forbes", status: "sourced", row: { ...base, ...row } as never }], blocking: [], databases: [] },
    null,
  );
  return (items[0] as unknown as { look_for: string[] }).look_for;
}

describe("evidence discovery: archive line", () => {
  it("names the archived copy when it differs from the source", () => {
    const out = lookFor({ link: "https://forbes.com/a", archive_status: "archived", archive_url: "https://web.archive.org/web/1/https://forbes.com/a" });
    expect(out).toContain("archived copy: https://web.archive.org/web/1/https://forbes.com/a");
  });

  it("says once that the source link is itself the copy", () => {
    const link = "https://archive.ph/AbC12";
    const out = lookFor({ link, archive_status: "archived", archive_url: link });
    expect(out).toContain("the source link is itself an archived copy");
    expect(out.some((l) => l.startsWith("archived copy:"))).toBe(false);
  });

  it("flags a missing copy as warning only", () => {
    const out = lookFor({ link: "https://forbes.com/a", archive_status: "pending", archive_url: null });
    expect(out).toContain("no archived copy yet (pending) — warning only");
  });
});
