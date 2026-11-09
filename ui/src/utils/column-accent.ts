import type { MessageKey } from "@/i18n";
import type { CardCover, ColumnAccentStyle } from "@janosik/shared";
import { coverBackground, coverSolid } from "@janosik/shared";
import type { CSSProperties } from "react";

/**
 * Column accent style → i18n key map. Lives outside the components so the
 * header picker and the board toolbar share one order/labels source.
 */
export const COLUMN_STYLE_KEYS = {
  rail: "column.style.rail",
  left: "column.style.left",
  wash: "column.style.wash",
  title: "column.style.title",
  glow: "column.style.glow",
  glass: "column.style.glass",
  band: "column.style.band",
  dot: "column.style.dot",
  signature: "column.style.signature",
} satisfies Record<ColumnAccentStyle, MessageKey>;

/** Short one-line description shown under each option in the toolbar. */
export const COLUMN_STYLE_HINT_KEYS = {
  rail: "column.styleHint.rail",
  left: "column.styleHint.left",
  wash: "column.styleHint.wash",
  title: "column.styleHint.title",
  glow: "column.styleHint.glow",
  glass: "column.styleHint.glass",
  band: "column.styleHint.band",
  dot: "column.styleHint.dot",
  signature: "column.styleHint.signature",
} satisfies Record<ColumnAccentStyle, MessageKey>;

/** CSS variables consumed by the `janosik-column-accent-*` rules. */
export function columnAccentVars(accent: CardCover | undefined): CSSProperties {
  if (!accent) return {};
  return {
    "--column-accent-paint": coverBackground(accent),
    "--column-accent-solid": coverSolid(accent),
  } as CSSProperties;
}
