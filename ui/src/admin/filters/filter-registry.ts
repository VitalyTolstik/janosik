import {
  ENTITY_FILTERS,
  type AdminFilterOptionDto,
  type AdminFilterOptionType,
} from "@janosik/shared";
import type { AdminMessageKey, AdminT } from "../admin-i18n";
import type { AdminListFilters } from "../admin-list-query";

const definitions = {
  boardId: { type: "board", label: "admin.filter.board" },
  columnId: { type: "column", label: "admin.filter.column" },
  labelId: { type: "label", label: "admin.filter.label" },
  cardId: { type: "card", label: "admin.filter.card" },
} as const satisfies Record<
  string,
  { type: AdminFilterOptionType; label: AdminMessageKey }
>;

export type CardFilterKey = keyof typeof definitions;
const { implemented, offered } = ENTITY_FILTERS.cards;

export function cardFilterFacet(key: CardFilterKey) {
  return { key, ...definitions[key] };
}

export const OFFERED_CARD_FILTERS = (
  Object.keys(definitions) as CardFilterKey[]
)
  .filter((key) => implemented.includes(key) && offered.includes(key))
  .map(cardFilterFacet);

export type CardFilterFacet = ReturnType<typeof cardFilterFacet>;

export function cardFilterValue(
  filters: AdminListFilters | undefined,
  key: CardFilterKey,
) {
  const value = filters?.[key];
  return typeof value === "string" && implemented.includes(key) ? value : null;
}

export const BOARD_DEPENDENTS = ["columnId", "labelId", "cardId"] as const;

function shortId(id: string): string {
  // CUIDs created together can share a timestamp prefix. Their random
  // suffix distinguishes boards when operators search for identical titles.
  return /^c[a-z0-9]{24}$/.test(id) ? id.slice(-8) : id.slice(0, 8);
}

export function optionIds(
  id: string,
  option?: AdminFilterOptionDto,
  short = true,
): string {
  const format = (value: string) => (short ? shortId(value) : value);
  const parent = [option?.boardId, option?.columnId]
    .filter((value): value is string => typeof value === "string")
    .map(format)
    .join("/");
  return parent ? `${format(id)} · ${parent}` : format(id);
}

export function optionState(
  t: AdminT,
  state: AdminFilterOptionDto["state"] | undefined,
): string | undefined {
  if (state === "archived") return t("admin.filters.archived");
  if (state === "deleted") return t("admin.filters.deleted");
  return undefined;
}
