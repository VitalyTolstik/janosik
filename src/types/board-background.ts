import type { MessageKey } from "@/i18n";

/**
 * Board background presets — a curated set of premium board backdrops
 * (Trello/Notion-style). Each entry maps to a CSS class in index.css
 * (`janosik-bg-*`) that lives on the board <main>, so patterns keep scrolling
 * with the column strip. The choice is persisted under `janosik-board-bg`.
 */

export type BoardBackgroundId = "flat" | "paper" | "dots" | "grid";

export interface BoardBackground {
  id: BoardBackgroundId;
  /** i18n label, e.g. "Solid", "Paper". */
  labelKey: MessageKey;
  /** CSS class applied to the board container. */
  className: string;
  /** Tailwind classes for the little preview tile in the picker. */
  previewClassName: string;
}

export const BOARD_BACKGROUNDS: readonly BoardBackground[] = [
  {
    id: "flat",
    labelKey: "bg.flat",
    className: "janosik-bg-flat",
    previewClassName: "janosik-bg-flat",
  },
  {
    id: "paper",
    labelKey: "bg.paper",
    className: "janosik-bg-paper",
    previewClassName: "janosik-bg-paper",
  },
  {
    id: "dots",
    labelKey: "bg.dots",
    className: "janosik-bg-dots",
    previewClassName: "janosik-bg-dots janosik-bg-dots-sm",
  },
  {
    id: "grid",
    labelKey: "bg.grid",
    className: "janosik-bg-grid",
    previewClassName: "janosik-bg-grid janosik-bg-grid-sm",
  },
];

export const DEFAULT_BOARD_BACKGROUND: BoardBackgroundId = "flat";

export function isBoardBackgroundId(value: string): value is BoardBackgroundId {
  return BOARD_BACKGROUNDS.some((bg) => bg.id === value);
}

export function boardBackgroundById(id: BoardBackgroundId): BoardBackground {
  return BOARD_BACKGROUNDS.find((bg) => bg.id === id) ?? BOARD_BACKGROUNDS[0];
}
