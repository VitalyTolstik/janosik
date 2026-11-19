import type {
  AgentsOverviewApprovalsResponse,
  AgentsOverviewQuery,
} from "@janosik/shared";
import { api } from "@/api/client";

type ApprovalPageQuery = Omit<
  AgentsOverviewQuery,
  "section" | "cursor" | "limit"
>;

export async function fetchApprovalPage(
  query: ApprovalPageQuery,
  previous?: AgentsOverviewApprovalsResponse,
): Promise<AgentsOverviewApprovalsResponse> {
  const cursor = previous?.nextCursor ?? undefined;
  const page = await api.agentsOverview({
    ...query,
    section: "approvals",
    limit: 100,
    ...(cursor === undefined ? {} : { cursor }),
  });
  if (page.section !== "approvals") {
    throw new Error("Agents overview returned a non-approval section");
  }
  if (previous === undefined) return page;
  const items = new Map(previous.items.map((item) => [item.id, item]));
  for (const item of page.items) items.set(item.id, item);
  return {
    ...page,
    items: [...items.values()],
    nextCursor: page.nextCursor === cursor ? null : page.nextCursor,
  };
}

/** Keep a previously expanded queue expanded after a refresh. */
export async function refreshApprovalPages(
  query: ApprovalPageQuery,
  targetSize: number,
) {
  let page = await fetchApprovalPage(query);
  const seen = new Set<string>();
  while (page.nextCursor !== null && page.items.length < targetSize) {
    if (seen.has(page.nextCursor)) return { ...page, nextCursor: null };
    seen.add(page.nextCursor);
    page = await fetchApprovalPage(query, page);
  }
  return page;
}
