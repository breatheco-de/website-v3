import { describe, expect, it } from "vitest";
import { getValidatorRunClass, isDecisionValidator, validatorsInvitedOnSave } from "./runClass";
import { listValidators } from "../validators";

describe("fact-literals runClass / invite", () => {
  it("classifies fact-literals as decision (paid), not entry-local", () => {
    expect(getValidatorRunClass("fact-literals")).toBe("decision");
    expect(isDecisionValidator("fact-literals")).toBe(true);
  });

  it("listValidators exposes cost and onSaveInvite", () => {
    const meta = listValidators().find((v) => v.name === "fact-literals");
    expect(meta).toMatchObject({
      name: "fact-literals",
      runClass: "decision",
      cost: "paid",
      onSaveInvite: "claim_cues",
      apiExposed: true,
    });
  });

  it("invites only on live selling pages with figure-ish cues", () => {
    expect(
      validatorsInvitedOnSave({
        isLiveWrite: true,
        funnelStage: "decision",
        claimCue: "ambiguous",
      }),
    ).toEqual(["fact-literals"]);
    expect(
      validatorsInvitedOnSave({
        isLiveWrite: true,
        funnelStage: "consideration",
        claimCue: "clear_yes",
      }),
    ).toEqual(["fact-literals"]);
    expect(
      validatorsInvitedOnSave({
        isLiveWrite: false,
        funnelStage: "decision",
        claimCue: "ambiguous",
      }),
    ).toEqual([]);
    expect(
      validatorsInvitedOnSave({
        isLiveWrite: true,
        funnelStage: "awareness",
        claimCue: "ambiguous",
      }),
    ).toEqual([]);
    expect(
      validatorsInvitedOnSave({
        isLiveWrite: true,
        funnelStage: "decision",
        claimCue: "clear_no",
      }),
    ).toEqual([]);
  });
});
