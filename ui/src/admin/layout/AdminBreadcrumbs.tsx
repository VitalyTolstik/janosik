import { Link, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAdminT } from "../admin-i18n";
import {
  ADMIN_HUBS,
  HUB_TABS,
  hubForPath,
  type AdminHubKey,
} from "./admin-nav";

/**
 * Breadcrumbs for the eight-hub shell. The last crumb is never a link; the
 * hub crumb points at the hub's canonical URL and keeps the current tab so a
 * detail page can return to the exact section the operator came from.
 */
export function AdminBreadcrumbs({ className }: { className?: string }) {
  const t = useAdminT();
  const { pathname, search } = useLocation();
  const crumbs: Array<{ label: string; to?: string }> = [
    { label: t("admin.title"), to: "/admin" },
  ];

  const hub = hubForPath(pathname);
  const tab = new URLSearchParams(search).get("tab");

  if (hub !== null && hub !== "overview") {
    const entry = ADMIN_HUBS.find((candidate) => candidate.key === hub);
    if (entry !== undefined) {
      crumbs.push({ label: t(entry.labelKey) });
    }
    const tabs: Array<{ key: string; labelKey: Parameters<typeof t>[0] }> =
      HUB_TABS[hub];
    if (tab !== null) {
      const activeTab = tabs.find((candidate) => candidate.key === tab);
      if (activeTab !== undefined) {
        crumbs.push({ label: t(activeTab.labelKey) });
      }
    }
  } else if (pathname.startsWith("/admin/cards/")) {
    // A card detail belongs to the Boards hub even though the URL is canonical.
    const boards = ADMIN_HUBS.find((entry) => entry.key === "boards");
    if (boards !== undefined) crumbs.push({ label: t(boards.labelKey) });
  } else if (pathname !== "/admin" && pathname !== "/admin/") {
    // A legacy redirect lands before the location updates; show nothing
    // misleading for the one frame it is visible.
    const known = ADMIN_HUBS.find((entry) => pathname.startsWith(entry.to));
    if (known !== undefined) crumbs.push({ label: t(known.labelKey) });
  }

  const detail = detailCrumb(pathname, t);
  if (detail !== null) crumbs.push({ label: detail });

  if (crumbs.length <= 1) {
    crumbs.push({ label: t("admin.hub.overview") });
  }

  return (
    <nav
      aria-label={t("admin.hub.breadcrumb")}
      data-testid="admin-breadcrumbs"
      className={cn(
        "flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground",
        className,
      )}
    >
      {crumbs.map((crumb, index) => {
        const last = index === crumbs.length - 1;
        return (
          <span
            key={`${crumb.label}-${index}`}
            className="flex min-w-0 items-center gap-1.5"
          >
            {index > 0 ? (
              <ChevronRight
                className="h-3 w-3 shrink-0 opacity-50"
                aria-hidden
              />
            ) : null}
            {crumb.to !== undefined && !last ? (
              <Link
                to={crumb.to}
                className="truncate transition-colors hover:text-foreground"
              >
                {crumb.label}
              </Link>
            ) : (
              <span
                className={cn("truncate", last && "text-foreground")}
                aria-current={last ? "page" : undefined}
              >
                {crumb.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function detailCrumb(
  pathname: string,
  t: ReturnType<typeof useAdminT>,
): string | null {
  if (/^\/admin\/users\/[^/]+$/.test(pathname))
    return t("admin.crumb.userDetail");
  if (/^\/admin\/boards\/[^/]+$/.test(pathname)) {
    return t("admin.crumb.boardDetail");
  }
  if (/^\/admin\/boards\/[^/]+\/content$/.test(pathname)) {
    return t("admin.crumb.boardContent");
  }
  if (/^\/admin\/boards\/[^/]+\/workflow$/.test(pathname)) {
    return t("admin.crumb.boardWorkflow");
  }
  if (/^\/admin\/cards\/[^/]+$/.test(pathname))
    return t("admin.crumb.cardDetail");
  return null;
}

export function hubTabLabel(
  hub: AdminHubKey,
  tab: string | null,
  t: ReturnType<typeof useAdminT>,
): string | null {
  if (tab === null) return null;
  const entry = HUB_TABS[hub].find((candidate) => candidate.key === tab);
  return entry === undefined ? null : t(entry.labelKey);
}
