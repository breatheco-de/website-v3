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

/** Desktop min card column width used for max-mode panel sizing. */
export const CARDS_COLUMN_WIDTH_PX = 600;
export const CARDS_GAP_PX = 24; // gap-6
export const CARDS_PANEL_PADDING_PX = 48; // p-6 * 2
export const CARDS_FIXED_WIDTH_PX = 900;

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

/** Nominal panel width for positioning / maxWidth capping. */
export function cardsPanelNominalWidthPx(
  itemCount: number,
  layout?: CardsLayoutConfig,
): number {
  const { mode, cols } = resolveCardsLayout(itemCount, layout);
  if (mode === "fixed") {
    return CARDS_FIXED_WIDTH_PX;
  }
  const gaps = Math.max(cols - 1, 0) * CARDS_GAP_PX;
  return cols * CARDS_COLUMN_WIDTH_PX + gaps + CARDS_PANEL_PADDING_PX;
}
