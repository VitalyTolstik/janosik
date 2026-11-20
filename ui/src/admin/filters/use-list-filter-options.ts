import type { AdminListFilters } from "../admin-list-query";
import {
  filterFacet,
  filterLabel,
  selectedFilterValues,
  type FilterBarSurface,
  type LookupFacet,
} from "./filter-registry";
import { useFilterOptions } from "./use-filter-options";

function useResolvedFilter(
  filters: AdminListFilters | undefined,
  key: Exclude<LookupFacet["key"], "type" | "action" | "targetType">,
  surface?: FilterBarSurface,
) {
  const ids = selectedFilterValues(filters, key);
  const facet = filterFacet(key);
  const lookup = useFilterOptions(
    ids.length ? { type: facet.type, ids: [...ids] } : null,
  );
  return {
    ...facet,
    label: (surface && filterLabel(key, surface)) ?? facet.label,
    ...lookup,
    ids,
  };
}

export function useListFilterOptions(
  filters: AdminListFilters | undefined,
  surface?: FilterBarSurface,
) {
  const board = useResolvedFilter(filters, "boardId");
  const column = useResolvedFilter(filters, "columnId");
  const label = useResolvedFilter(filters, "labelId");
  const card = useResolvedFilter(filters, "cardId");
  const assignee = useResolvedFilter(filters, "assigneeId");
  const author = useResolvedFilter(filters, "authorId");
  const uploader = useResolvedFilter(filters, "uploadedById");
  const adminMember = useResolvedFilter(filters, "adminMemberId");
  const actor = useResolvedFilter(filters, "actorId", surface);
  const admin = useResolvedFilter(filters, "adminId");
  return [
    board,
    column,
    label,
    card,
    assignee,
    author,
    uploader,
    adminMember,
    actor,
    admin,
  ].flatMap(({ ids, ...filter }) =>
    ids.map((id) => ({
      ...filter,
      id,
      option: filter.data?.items.find((item) => item.id === id),
    })),
  );
}

export type ResolvedFilter = ReturnType<typeof useListFilterOptions>[number];
