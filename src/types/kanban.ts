/**
 * Core domain model for the kanban board.
 *
 * Data is normalized: cards live in a record keyed by id (on the board),
 * columns keep an ordered `cardIds` array, and a board keeps an ordered
 * `columns` array. This makes reordering and cross-column moves trivial
 * (just reorder id arrays) and keeps the structure ready for multiple
 * boards stored as `Board[]`.
 */

/**
 * Label palette — ordered as a rainbow gradient (red → … → violet → pink)
 * so the picker reads like a spectrum, then a neutral slate, then a
 * colorless "plain" swatch (rendered as an empty outline, no fill) and a
 * distinct brown. Contains the classic hues: red, orange, yellow, green,
 * teal, cyan, blue, indigo, violet (brand), fuchsia, pink. `amber` was
 * retired (it collided with orange) but keeps an alias below so labels
 * persisted with the old color still render.
 */
export const LABEL_COLORS = [
 "red",
 "orange",
 "yellow",
 "brown",
 "green",
 "teal",
 "cyan",
 "blue",
 "indigo",
 "brand",
 "fuchsia",
 "pink",
 "slate",
 "plain",
] as const;

/** Legacy colors accepted from persisted data but not offered in the picker. */
export type LabelColor = (typeof LABEL_COLORS)[number] | "amber";

/** Tailwind classes used to render a label chip in both themes. */
export const LABEL_COLOR_CHIP = {
 red: "bg-danger/15 text-danger",
 orange: "bg-orange/15 text-orange",
 yellow: "bg-yellow/15 text-yellow",
 brown: "bg-brown/15 text-brown",
 green: "bg-success/15 text-success",
 teal: "bg-teal/15 text-teal",
 cyan: "bg-secondary/15 text-secondary",
 blue: "bg-blue/15 text-blue",
 indigo: "bg-indigo/15 text-indigo",
 brand: "bg-primary/15 text-primary",
 fuchsia: "bg-fuchsia/15 text-fuchsia",
 pink: "bg-pink/15 text-pink",
 slate: "bg-slate/15 text-slate",
 // Colorless: an outlined empty pill instead of a tinted one.
 plain: "border border-border bg-background/40 text-muted-foreground",
 // Retired color kept so persisted labels still render.
 amber: "bg-warning/15 text-warning",
} satisfies Record<LabelColor, string>;

/** Solid color used for dot indicators (e.g. drag previews, swatches). */
export const LABEL_COLOR_DOT = {
 red: "bg-danger",
 orange: "bg-orange",
 yellow: "bg-yellow",
 brown: "bg-brown",
 green: "bg-success",
 teal: "bg-teal",
 cyan: "bg-secondary",
 blue: "bg-blue",
 indigo: "bg-indigo",
 brand: "bg-primary",
 fuchsia: "bg-fuchsia",
 pink: "bg-pink",
 slate: "bg-slate",
 // Colorless: an empty ring instead of a filled dot.
 plain: "bg-transparent ring-1 ring-inset ring-border",
 // Retired color kept so persisted labels still render.
 amber: "bg-warning",
} satisfies Record<LabelColor, string>;

export interface Label {
  id: string;
  /** Human-friendly name shown in the label picker, e.g. "Design". */
  name: string;
  color: LabelColor;
}

/** A single todo line inside a checklist. */
export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

/** A named group of todo items ("subtasks") on a card. */
export interface Checklist {
  id: string;
  title: string;
  items: ChecklistItem[];
}

export interface Card {
  id: string;
  title: string;
  /** Optional multi-line notes. Omitted (not empty) when unset. */
  description?: string;
  /** Optional subtask checklists. Omitted (not empty) when unset. */
  checklists?: Checklist[];
  /** Optional deadline as a Unix timestamp (ms). Omitted when unset. */
  dueDate?: number;
  /** Optional decorative cover. Omitted when unset. */
  cover?: CardCover;
  /** References to labels defined on the board; empty when unlabeled. */
  labelIds: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Card cover palette — solid colors reuse the label token hues (subset,
 * minus `plain`/retired `amber` which are reserved for labels).
 */
export const COVER_COLORS = [
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "cyan",
  "blue",
  "indigo",
  "brand",
  "fuchsia",
  "pink",
  "slate",
] as const;

export type CoverColor = (typeof COVER_COLORS)[number];

/**
 * Named gradient presets (Trello-style "cover art") — CSS values are
 * composed from theme tokens, so every gradient adapts to both themes.
 */
export const COVER_GRADIENTS = [
  "sunset",
  "ocean",
  "forest",
  "candy",
  "grape",
  "steel",
] as const;

export type CoverGradient = (typeof COVER_GRADIENTS)[number];

export type CardCover =
  | { type: "color"; value: CoverColor }
  | { type: "gradient"; value: CoverGradient };

/** Solid token color behind a cover (the strip / gradient endpoint). */
export const COVER_COLOR_CSS: Record<CoverColor, string> = {
  red: "var(--danger)",
  orange: "var(--orange)",
  yellow: "var(--yellow)",
  green: "var(--success)",
  teal: "var(--teal)",
  cyan: "var(--secondary)",
  blue: "var(--blue)",
  indigo: "var(--indigo)",
  brand: "var(--primary)",
  fuchsia: "var(--fuchsia)",
  pink: "var(--pink)",
  slate: "var(--slate)",
};

/** Gradient presets as CSS backgrounds (135° diagonal, token endpoints). */
export const COVER_GRADIENT_CSS: Record<CoverGradient, string> = {
  sunset: "linear-gradient(135deg, var(--danger), var(--orange))",
  ocean: "linear-gradient(135deg, var(--blue), var(--teal))",
  forest: "linear-gradient(135deg, var(--success), var(--teal))",
  candy: "linear-gradient(135deg, var(--pink), var(--fuchsia))",
  grape: "linear-gradient(135deg, var(--indigo), var(--primary))",
  steel: "linear-gradient(135deg, var(--slate), var(--muted-foreground))",
};

/** CSS background for any cover shape (solid color or gradient). */
export function coverBackground(cover: CardCover): string {
  return cover.type === "color"
    ? COVER_COLOR_CSS[cover.value]
    : COVER_GRADIENT_CSS[cover.value];
}

export interface Column {
 id: string;
 title: string;
 /** Ordered card ids — this array defines the vertical order. */
 cardIds: string[];
 createdAt: number;
}

export interface Board {
 id: string;
 title: string;
 /** Ordered columns — this array defines the horizontal order. */
 columns: Column[];
 /** Cards normalized by id. */
 cards: Record<string, Card>;
 labels: Label[];
 createdAt: number;
 updatedAt: number;
}
