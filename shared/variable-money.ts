/**
 * Structured money values for category:price site variables.
 * Template resolve → formatted display string; Offer/API → amount + currency.
 */

export type MoneyValue = {
  amount: number;
  currency: string;
  display?: string;
};

export type VariableValue = string | MoneyValue;

const ISO_CURRENCY = /^[A-Z]{3}$/;

export function isMoneyValue(raw: unknown): raw is MoneyValue {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const o = raw as Record<string, unknown>;
  return typeof o.amount === "number" && Number.isFinite(o.amount) && typeof o.currency === "string";
}

/** Normalize unknown YAML/JSON into MoneyValue or null. */
export function normalizeMoneyValue(raw: unknown): MoneyValue | null {
  if (isMoneyValue(raw)) {
    const currency = raw.currency.trim().toUpperCase();
    if (!ISO_CURRENCY.test(currency) || raw.amount < 0) return null;
    const display =
      typeof raw.display === "string" && raw.display.trim() ? raw.display.trim() : undefined;
    return { amount: raw.amount, currency, ...(display ? { display } : {}) };
  }
  if (typeof raw === "string") {
    return parseLegacyPriceString(raw);
  }
  return null;
}

const CURRENCY_SIGNAL = /\$|€|£|\b(USD|EUR|GBP)\b/i;

function parseAmountFromPriceString(cleaned: string): number | null {
  // European thousands: 6.800 or 6.800,50
  let normalized = cleaned;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(cleaned)) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(cleaned)) {
    // US: 10,999 or 10,999.50
    normalized = cleaned.replace(/,/g, "");
  } else {
    normalized = cleaned.replace(/,/g, "");
  }

  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return amount;
}

/**
 * Parse marketing price strings used historically in variables.yml.
 * Requires a currency signal so bare numbers ("4.9", "84", "499") stay non-money
 * (ratings, rates, unmigrated plain strings). Examples: "$10,999", "6.800 €", "2500 USD", "200€", "$299"
 */
export function parseLegacyPriceString(raw: string): MoneyValue | null {
  const s = raw.trim();
  if (!s || /\{\{/.test(s)) return null;

  let currency: string | null = null;
  if (/\$/.test(s) || /\bUSD\b/i.test(s)) currency = "USD";
  else if (/€/.test(s) || /\bEUR\b/i.test(s)) currency = "EUR";
  else if (/\bGBP\b/i.test(s) || /£/.test(s)) currency = "GBP";
  if (!currency) return null;

  const cleaned = s
    .replace(/\$/g, "")
    .replace(/€/g, "")
    .replace(/£/g, "")
    .replace(/\b(USD|EUR|GBP)\b/gi, "")
    .trim();

  const amount = parseAmountFromPriceString(cleaned);
  if (amount == null) return null;
  return { amount, currency };
}

/**
 * Bare numeric marketing amounts for price-category migration only.
 * Defaults to USD when no currency marker is present ("499", "16,999").
 */
export function parseBareAmountAsUsd(raw: string): MoneyValue | null {
  const s = raw.trim();
  if (!s || /\{\{/.test(s) || CURRENCY_SIGNAL.test(s)) return null;
  const amount = parseAmountFromPriceString(s);
  if (amount == null) return null;
  return { amount, currency: "USD" };
}

export function formatMoneyValue(
  money: MoneyValue,
  opts?: { locale?: string },
): string {
  if (money.display?.trim()) return money.display.trim();
  const locale = opts?.locale?.trim() || "en-US";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: money.currency,
      minimumFractionDigits: money.amount % 1 === 0 ? 0 : 2,
      maximumFractionDigits: money.amount % 1 === 0 ? 0 : 2,
    }).format(money.amount);
  } catch {
    return `${money.currency} ${money.amount}`;
  }
}

/** Turn a stored value (string legacy or MoneyValue) into the string visitors see. */
export function variableValueToDisplayString(
  value: unknown,
  opts?: { locale?: string },
): string {
  if (typeof value === "string") {
    const money = parseLegacyPriceString(value);
    if (money) return formatMoneyValue(money, opts);
    return value;
  }
  const money = normalizeMoneyValue(value);
  if (money) return formatMoneyValue(money, opts);
  if (value == null) return "";
  return String(value);
}

/** Stable string for figure-change compare / logging. */
export function variableValueCompareKey(value: unknown): string {
  const money = normalizeMoneyValue(value);
  if (money) {
    const display = money.display ? `|${money.display}` : "";
    return `${money.amount}|${money.currency}${display}`;
  }
  if (typeof value === "string") return value;
  return JSON.stringify(value ?? null);
}

/** Coerce API/YAML write payload into VariableValue (structured for objects). */
export function coerceVariableWriteValue(raw: unknown): VariableValue | null {
  if (typeof raw === "string") return raw;
  const money = normalizeMoneyValue(raw);
  if (money) return money;
  return null;
}

export const PRICE_ROLES = ["list", "monthly", "other"] as const;
export type PriceRole = (typeof PRICE_ROLES)[number];

export function isPriceRole(value: unknown): value is PriceRole {
  return typeof value === "string" && (PRICE_ROLES as readonly string[]).includes(value);
}

export const PRICE_ROLE_LABELS: Record<PriceRole, string> = {
  list: "List / full tuition",
  monthly: "Monthly payment",
  other: "Other",
};
