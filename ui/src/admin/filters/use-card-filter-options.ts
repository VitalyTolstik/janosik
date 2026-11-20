import type { AdminListFilters } from "../admin-list-query";
import {
  cardFilterFacet,
  cardFilterValue,
  type CardFilterKey,
} from "./filter-registry";
import { useFilterOptions } from "./use-filter-options";

function useResolvedFilter(
  filters: AdminListFilters | undefined,
  key: CardFilterKey,
) {
  const id = cardFilterValue(filters, key);
  const facet = cardFilterFacet(key);
  const lookup = useFilterOptions(id ? { type: facet.type, ids: [id] } : null);
  if (!id) return null;
  const option = lookup.data?.items.find((item) => item.id === id);
  return { ...facet, ...lookup, id, option };
}

export function useCardFilterOptions(filters: AdminListFilters | undefined) {
  const board = useResolvedFilter(filters, "boardId");
  const column = useResolvedFilter(filters, "columnId");
  const label = useResolvedFilter(filters, "labelId");
  const card = useResolvedFilter(filters, "cardId");
  return [board, column, label, card].filter((filter) => filter !== null);
}

export type ResolvedCardFilter = ReturnType<
  typeof useCardFilterOptions
>[number];
