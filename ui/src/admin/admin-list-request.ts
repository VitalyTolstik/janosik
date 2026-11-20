import {
  adminFilterEntries,
  ENTITY_FILTERS,
  type AdminListSurface,
} from "@janosik/shared";
import type { AdminListParams } from "./admin-client";

export function adminListRequestQuery(
  params: AdminListParams,
  surface: AdminListSurface,
): string {
  const search = new URLSearchParams();
  if (params.search) search.set("search", params.search);
  if (params.status && params.status !== "all") {
    search.set("status", params.status);
  }
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.offset !== undefined) search.set("offset", String(params.offset));
  if (ENTITY_FILTERS[surface].dateRange) {
    if (params.from !== undefined) search.set("from", String(params.from));
    if (params.to !== undefined) search.set("to", String(params.to));
  }
  for (const [key, value] of adminFilterEntries(params, surface))
    search.append(key, value);
  const value = search.toString();
  return value === "" ? "" : `?${value}`;
}
