import type { AdminListFilters } from "../admin-list-query";
import {
  filterFacet,
  selectedFilterValues,
  type LookupFacet,
} from "./filter-registry";
import { useFilterOptions } from "./use-filter-options";

function useResolvedFilter(
  filters: AdminListFilters | undefined,
  key: LookupFacet["key"],
) {
  const ids = selectedFilterValues(filters, key);
  const facet = filterFacet(key);
  const lookup = useFilterOptions(
    ids.length ? { type: facet.type, ids: [...ids] } : null,
  );
  return {
    ...facet,
    ...lookup,
    ids,
  };
}

export function useListFilterOptions(filters: AdminListFilters | undefined) {
  const board = useResolvedFilter(filters, "boardId");
  const column = useResolvedFilter(filters, "columnId");
  const label = useResolvedFilter(filters, "labelId");
  const card = useResolvedFilter(filters, "cardId");
  const assignee = useResolvedFilter(filters, "assigneeId");
  const author = useResolvedFilter(filters, "authorId");
  const uploader = useResolvedFilter(filters, "uploadedById");
  return [board, column, label, card, assignee, author, uploader].flatMap(
    ({ ids, ...filter }) =>
      ids.map((id) => ({
        ...filter,
        id,
        option: filter.data?.items.find((item) => item.id === id),
      })),
  );
}

export type ResolvedFilter = ReturnType<typeof useListFilterOptions>[number];
