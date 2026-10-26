import {
  Ban,
  ChevronsDown,
  ChevronsUp,
  ChevronDown,
  ChevronUp,
  Equal,
  type LucideIcon,
} from "lucide-react";

import type { CardPriority } from "@janosik/shared";
import { CARD_PRIORITIES, DEFAULT_CARD_PRIORITY } from "@janosik/shared";

/**
 * Jira-style priority presentation (TASK-45): one entry per ladder value,
 * ordered most → least urgent. The rank drives sorting; the icon + color
 * pairs drive every badge and picker (kept as literal class strings so
 * Tailwind can see them); the labels mirror the i18n catalog so non-React
 * renderers (history sentences) can localize too.
 */
export const PRIORITY_META: Record<
  CardPriority,
  {
    rank: number;
    icon: LucideIcon;
    dotClass: string;
    iconClass: string;
    label: Record<"en" | "ru", string>;
  }
> = {
  // TASK-115: theme tokens (not raw Tailwind colors) so light/dark and
  // high-contrast themes restyle the ladder; opacity keeps each rung distinct.
  blocker: {
    rank: 0,
    icon: Ban,
    dotClass: "bg-danger",
    iconClass: "text-danger",
    label: { en: "Blocker", ru: "Блокер" },
  },
  highest: {
    rank: 1,
    icon: ChevronsUp,
    dotClass: "bg-danger/80",
    iconClass: "text-danger/80",
    label: { en: "Highest", ru: "Наивысший" },
  },
  high: {
    rank: 2,
    icon: ChevronUp,
    dotClass: "bg-warning",
    iconClass: "text-warning",
    label: { en: "High", ru: "Высокий" },
  },
  medium: {
    rank: 3,
    icon: Equal,
    dotClass: "bg-warning/70",
    iconClass: "text-warning/70",
    label: { en: "Medium", ru: "Средний" },
  },
  low: {
    rank: 4,
    icon: ChevronDown,
    dotClass: "bg-primary",
    iconClass: "text-primary",
    label: { en: "Low", ru: "Низкий" },
  },
  lowest: {
    rank: 5,
    icon: ChevronsDown,
    dotClass: "bg-primary/70",
    iconClass: "text-primary/70",
    label: { en: "Lowest", ru: "Наименьший" },
  },
};

/** Every priority, most → least urgent (same order as the shared ladder). */
export const PRIORITY_ORDER = CARD_PRIORITIES;

/** Sort rank of a card's priority; unset cards rank as the default. */
export function priorityRank(priority: CardPriority | undefined): number {
  return PRIORITY_META[priority ?? DEFAULT_CARD_PRIORITY].rank;
}

/** Localized priority name for non-React renderers (history sentences). */
export function priorityLabel(
  priority: CardPriority,
  lang: "en" | "ru",
): string {
  return PRIORITY_META[priority].label[lang];
}
