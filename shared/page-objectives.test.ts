import { describe, expect, it } from "vitest";
import { objectiveFor, STAGE_OBJECTIVES } from "./page-objectives";

describe("objectiveFor", () => {
  it("returns base objective for non-decision stages", () => {
    const awareness = objectiveFor("awareness");
    expect(awareness).toEqual(STAGE_OBJECTIVES.awareness);

    const consideration = objectiveFor("consideration");
    expect(consideration).toEqual(STAGE_OBJECTIVES.consideration);

    const postEnrollment = objectiveFor("post-enrollment");
    expect(postEnrollment).toEqual(STAGE_OBJECTIVES["post-enrollment"]);
  });

  it("returns base objective for decision stage with no checkout buttons", () => {
    const decision = objectiveFor("decision", { checkout_buttons: 0, lead_forms: 2 });
    expect(decision).toEqual(STAGE_OBJECTIVES.decision);
  });

  it("returns enrollment objective for decision stage with checkout buttons and lead forms", () => {
    const decision = objectiveFor("decision", { checkout_buttons: 2, lead_forms: 3 });
    expect(decision?.stage).toBe("decision");
    expect(decision?.job).toBe("Get leads or start enrollments.");
    expect(decision?.primary.id).toBe("lead_or_enroll_rate");
    expect(decision?.primary.label).toBe("Leads or enrollment clicks");
    expect(decision?.cost?.id).toBe("cost_per_conversion");
    expect(decision?.cost?.label).toBe("Cost per conversion");
    expect(decision?.funnel).toEqual([
      "impressions",
      "clicks",
      "visits",
      "engaged",
      "form_or_cta",
      "lead_or_enroll",
    ]);
  });

  it("returns enrollment-only objective for decision stage with checkout buttons but no lead forms", () => {
    const decision = objectiveFor("decision", { checkout_buttons: 2, lead_forms: 0 });
    expect(decision?.job).toBe("Start enrollments.");
    expect(decision?.primary.id).toBe("lead_or_enroll_rate");
  });

  it("returns null for invalid stage", () => {
    expect(objectiveFor(null)).toBeNull();
    expect(objectiveFor(undefined)).toBeNull();
    expect(objectiveFor("invalid")).toBeNull();
  });

  it("returns base objective when actions is undefined", () => {
    const decision = objectiveFor("decision");
    expect(decision).toEqual(STAGE_OBJECTIVES.decision);
  });
});
