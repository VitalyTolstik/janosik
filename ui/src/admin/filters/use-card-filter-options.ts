import type { AdminListFilters } from "../admin-list-query";
import {
  cardFilterFacet,
  selectedFilterValues,
  type LookupFacet,
} from "./filter-registry";
import { useFilterOptions } from "./use-filter-options";

function useResolvedFilter(
  filters: AdminListFilters | undefined,
  key: LookupFacet["key"],
) {
  const ids = selectedFilterValues(filters, key);
  const facet = cardFilterFacet(key);
  const lookup = useFilterOptions(
    ids.length ? { type: facet.type, ids: [...ids] } : null,
  );
  return {
    ...facet,
    ...lookup,
    ids,
  };
}

export function useCardFilterOptions(filters: AdminListFilters | undefined) {
  const board = useResolvedFilter(filters, "boardId");
  const column = useResolvedFilter(filters, "columnId");
  const label = useResolvedFilter(filters, "labelId");
  const card = useResolvedFilter(filters, "cardId");
  const assignee = useResolvedFilter(filters, "assigneeId");
  return [board, column, label, card, assignee].flatMap(({ ids, ...filter }) =>
    ids.map((id) => ({
      ...filter,
      id,
      option: filter.data?.items.find((item) => item.id === id),
    })),
  );
}

export type ResolvedCardFilter = ReturnType<
  typeof useCardFilterOptions
>[number];
