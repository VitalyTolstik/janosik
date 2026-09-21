import type { MessageKey } from "@/i18n";
import type { CoverColor, CoverGradient, LABEL_COLORS } from "@janosik/shared";

/**
 * Palette value → i18n key maps, shared by the card dialog editors and the
 * card context menu. They live here (not next to the components) so both
 * can import them without tripping react-refresh's one-component-per-file
 * rule.
 */

export const LABEL_COLOR_KEYS = {
  red: "label.color.red",
  orange: "label.color.orange",
  yellow: "label.color.yellow",
  brown: "label.color.brown",
  green: "label.color.green",
  teal: "label.color.teal",
  cyan: "label.color.cyan",
  blue: "label.color.blue",
  indigo: "label.color.indigo",
  brand: "label.color.brand",
  fuchsia: "label.color.fuchsia",
  pink: "label.color.pink",
  slate: "label.color.slate",
  plain: "label.color.plain",
} satisfies Record<(typeof LABEL_COLORS)[number], MessageKey>;

export const COVER_COLOR_KEYS = {
  red: "card.coverColor.red",
  orange: "card.coverColor.orange",
  yellow: "card.coverColor.yellow",
  green: "card.coverColor.green",
  teal: "card.coverColor.teal",
  cyan: "card.coverColor.cyan",
  blue: "card.coverColor.blue",
  indigo: "card.coverColor.indigo",
  brand: "card.coverColor.brand",
  fuchsia: "card.coverColor.fuchsia",
  pink: "card.coverColor.pink",
  slate: "card.coverColor.slate",
} satisfies Record<CoverColor, MessageKey>;

export const COVER_GRADIENT_KEYS = {
  sunset: "card.coverGradient.sunset",
  ocean: "card.coverGradient.ocean",
  forest: "card.coverGradient.forest",
  candy: "card.coverGradient.candy",
  grape: "card.coverGradient.grape",
  steel: "card.coverGradient.steel",
} satisfies Record<CoverGradient, MessageKey>;
