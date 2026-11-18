import { describe, expect, it } from "vitest";
import type { DeliverableAdRef } from "@shared/adsAccountLocations";
import { accountLocationDiagnosticIssues } from "./account-location-diagnostics";

const pageLocations = (path: string): string[] | null => {
  if (path === "/landing/empty") return [];
  if (path === "/landing/madrid") return ["madrid-spain"];
  if (path === "/landing/mexico") return ["mexicocity-mexico"];
  return null;
};

function ref(partial: Partial<DeliverableAdRef> & { account_id: string; landing_urls: string[] }): DeliverableAdRef {
  return {
    status: "ACTIVE",
    ...partial,
  };
}

describe("accountLocationDiagnosticIssues", () => {
  it("emits nothing when no account is restricted", () => {
    expect(
      accountLocationDiagnosticIssues({
        platform: "meta",
        account_locations: {},
        catalog: null,
        refs: [ref({ account_id: "es", landing_urls: ["https://x.com/landing/madrid"] })],
        pageLocations,
      }),
    ).toEqual([]);
  });

  it("warns when restricted account hits a page with no Locations", () => {
    const issues = accountLocationDiagnosticIssues({
      platform: "meta",
      account_locations: { es: ["madrid-spain"] },
      catalog: null,
      account_names: { es: "España" },
      refs: [ref({ account_id: "es", landing_urls: ["https://x.com/landing/empty"] })],
      pageLocations,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe("account_landing_location_missing");
    expect(issues[0]!.site_fixable).toBe(true);
    expect(issues[0]!.how_to_fix).toMatch(/update_fields/);
    expect(issues[0]!.how_to_fix).toMatch(/staff-only/i);
  });

  it("warns on disjoint Locations", () => {
    const issues = accountLocationDiagnosticIssues({
      platform: "google",
      account_locations: { es: ["madrid-spain"] },
      catalog: null,
      account_names: { es: "España" },
      refs: [ref({ account_id: "es", landing_urls: ["https://x.com/landing/mexico"] })],
      pageLocations,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe("account_landing_location_mismatch");
    expect(issues[0]!.platform).toBe("google");
  });

  it("skips paused ads (clears after sync)", () => {
    const issues = accountLocationDiagnosticIssues({
      platform: "meta",
      account_locations: { es: ["madrid-spain"] },
      catalog: null,
      refs: [
        ref({
          account_id: "es",
          status: "PAUSED",
          landing_urls: ["https://x.com/landing/mexico"],
        }),
      ],
      pageLocations,
    });
    expect(issues).toEqual([]);
  });

  it("skips unrestricted accounts and non-managed paths", () => {
    const issues = accountLocationDiagnosticIssues({
      platform: "meta",
      account_locations: { es: ["madrid-spain"] },
      catalog: null,
      refs: [
        ref({ account_id: "open", landing_urls: ["https://x.com/landing/mexico"] }),
        ref({ account_id: "es", landing_urls: ["https://x.com/blog/post"] }),
        ref({ account_id: "es", landing_urls: ["https://x.com/landing/madrid"] }),
      ],
      pageLocations,
    });
    expect(issues).toEqual([]);
  });
});
