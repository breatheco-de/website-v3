import { describe, expect, it } from "vitest";
import {
  formatMoneyValue,
  normalizeMoneyValue,
  parseLegacyPriceString,
  variableValueCompareKey,
  variableValueToDisplayString,
} from "./variable-money";

describe("parseLegacyPriceString", () => {
  it("parses US dollar amounts", () => {
    expect(parseLegacyPriceString("$10,999")).toEqual({ amount: 10999, currency: "USD" });
    expect(parseLegacyPriceString("$299")).toEqual({ amount: 299, currency: "USD" });
    expect(parseLegacyPriceString("2500 USD")).toEqual({ amount: 2500, currency: "USD" });
  });

  it("parses European euro amounts", () => {
    expect(parseLegacyPriceString("6.800 €")).toEqual({ amount: 6800, currency: "EUR" });
    expect(parseLegacyPriceString("200€")).toEqual({ amount: 200, currency: "EUR" });
  });
});

describe("formatMoneyValue / display", () => {
  it("formats with Intl and prefers display override", () => {
    expect(formatMoneyValue({ amount: 10999, currency: "USD" }, { locale: "en-US" })).toBe(
      "$10,999",
    );
    expect(
      formatMoneyValue({ amount: 10999, currency: "USD", display: "From $10,999" }),
    ).toBe("From $10,999");
  });

  it("formats structured and legacy via variableValueToDisplayString", () => {
    expect(variableValueToDisplayString({ amount: 299, currency: "USD" }, { locale: "en-US" })).toBe(
      "$299",
    );
    expect(variableValueToDisplayString("$299", { locale: "en-US" })).toBe("$299");
  });
});

describe("normalizeMoneyValue", () => {
  it("rejects negative and bad currency", () => {
    expect(normalizeMoneyValue({ amount: -1, currency: "USD" })).toBeNull();
    expect(normalizeMoneyValue({ amount: 10, currency: "US" })).toBeNull();
  });

  it("compare keys distinguish structured values", () => {
    expect(variableValueCompareKey({ amount: 10, currency: "USD" })).toBe("10|USD");
    expect(variableValueCompareKey("$10")).toBe("10|USD");
  });
});
