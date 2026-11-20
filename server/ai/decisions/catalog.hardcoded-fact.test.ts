import { describe, expect, it } from "vitest";
import {
  HARDCODED_SITE_FACT_LITERAL_NOUL_THRESHOLD,
  askHardcodedSiteFactLiteral,
  type DecisionClient,
} from "./index";

describe("askHardcodedSiteFactLiteral", () => {
  it("returns no on empty text without calling the client", async () => {
    let called = false;
    const client: DecisionClient = {
      async decide() {
        called = true;
        return { status: "ok", answers: {}, model: "test" };
      },
    };
    expect(await askHardcodedSiteFactLiteral(client, "  ")).toEqual({ outcome: "no" });
    expect(called).toBe(false);
  });

  it("maps noul above threshold to yes", async () => {
    const client: DecisionClient = {
      async decide() {
        return {
          status: "ok",
          model: "jev-test",
          answers: { hardcoded_site_fact: { noul: HARDCODED_SITE_FACT_LITERAL_NOUL_THRESHOLD } },
        };
      },
    };
    expect((await askHardcodedSiteFactLiteral(client, "Tuition is $10,999")).outcome).toBe("yes");
  });

  it("fail-opens on unavailable", async () => {
    const client: DecisionClient = {
      async decide() {
        return { status: "unavailable", reason: "timeout" };
      },
    };
    expect((await askHardcodedSiteFactLiteral(client, "Hire rate 84%")).outcome).toBe("unavailable");
  });
});
