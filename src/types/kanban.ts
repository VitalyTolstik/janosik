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

export interface Card {
 id: string;
 title: string;
 /** References to labels defined on the board; empty when unlabeled. */
 labelIds: string[];
 createdAt: number;
 updatedAt: number;
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
