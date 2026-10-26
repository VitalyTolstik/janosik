// Fixed geometry for every clip. Positions are computed rather than measured so
// overlays (a dragged card, a cursor) line up with the board exactly.
//
// 16:10 matches the marketing site's `.slot-frame` aspect ratio, so a clip
// drops into a slot with no layout shift.

export const WIDTH = 1280;
export const HEIGHT = 800;
export const FPS = 30;

/** Canvas padding around the columns. */
export const PAD = 40;
/** Gap between columns. */
export const GAP = 24;
/** Height of the window chrome bar at the top. */
export const CHROME_H = 54;
/** Height of a column's header row. */
export const COL_HEAD = 44;
/** Card height and the gap between cards in a column. */
export const CARD_H = 96;
export const CARD_GAP = 14;

export const colWidth = (columns: number): number =>
  (WIDTH - PAD * 2 - GAP * (columns - 1)) / columns;

export const colX = (columns: number, index: number): number =>
  PAD + index * (colWidth(columns) + GAP);

/** Top of the card at `index` inside a column (relative to the canvas). */
export const cardY = (index: number): number =>
  PAD + COL_HEAD + index * (CARD_H + CARD_GAP);
