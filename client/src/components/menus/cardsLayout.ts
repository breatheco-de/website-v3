export type CardsLayoutMode = "fixed" | "max";

export type CardsLayoutConfig = {
  mode?: CardsLayoutMode;
  count?: number;
};

export type ResolvedCardsLayout = {
  mode: CardsLayoutMode;
  count: number;
  cols: number;
};

const GRID_COLS_CLASS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
};

/**
 * Preferred card column width by column count (max mode).
 * More columns → narrower cards so the panel stays readable without overflowing.
 */
const CARDS_PREFERRED_COLUMN_PX: Record<number, number> = {
  1: 520,
  2: 300,
  3: 280,
  4: 220,
};

/** @deprecated Prefer cardsColumnWidthPx(cols) — kept for callers that need a single constant. */
export const CARDS_COLUMN_WIDTH_PX = CARDS_PREFERRED_COLUMN_PX[3];

export const CARDS_GAP_PX = 24; // gap-6
export const CARDS_PANEL_PADDING_PX = 48; // p-6 * 2
export const CARDS_FIXED_WIDTH_PX = 900;
/** Hard cap so max-mode panels do not try to span the full viewport. */
export const CARDS_MAX_PANEL_PX = 1100;

export function resolveCardsLayout(
  itemCount: number,
  layout?: CardsLayoutConfig,
): ResolvedCardsLayout {
  const mode: CardsLayoutMode = layout?.mode === "fixed" ? "fixed" : "max";
  const count = Math.min(Math.max(layout?.count ?? 4, 1), 4);
  const cols = mode === "fixed" ? count : Math.min(Math.max(itemCount, 1), count);
  return { mode, count, cols };
}

export function cardsGridColsClass(cols: number): string {
  return GRID_COLS_CLASS[Math.min(Math.max(cols, 1), 4)] ?? "grid-cols-4";
}

/** Preferred column width for max-mode sizing (shrinks as cols grow). */
export function cardsColumnWidthPx(cols: number): number {
  const c = Math.min(Math.max(cols, 1), 4);
  return CARDS_PREFERRED_COLUMN_PX[c] ?? CARDS_PREFERRED_COLUMN_PX[4];
}

/** Nominal panel width for positioning / maxWidth capping. */
export function cardsPanelNominalWidthPx(
  itemCount: number,
  layout?: CardsLayoutConfig,
): number {
  const { mode, cols } = resolveCardsLayout(itemCount, layout);
  if (mode === "fixed") {
    return CARDS_FIXED_WIDTH_PX;
  }
  const colW = cardsColumnWidthPx(cols);
  const gaps = Math.max(cols - 1, 0) * CARDS_GAP_PX;
  const raw = cols * colW + gaps + CARDS_PANEL_PADDING_PX;
  return Math.min(raw, CARDS_MAX_PANEL_PX);
}
