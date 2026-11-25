import { Link, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAdminT } from "../admin-i18n";
import {
  adminDestination,
  HUB_TABS,
  hubTabHref,
  type AdminHubKey,
} from "./admin-nav";

export function AdminBreadcrumbs({ className }: { className?: string }) {
  const t = useAdminT();
  const { pathname, search } = useLocation();
  const crumbs: Array<{ label: string; to?: string }> = [
    { label: t("admin.title"), to: "/admin" },
  ];

  const destination = adminDestination(pathname, search);
  if (destination !== null && destination.hub.key !== "overview") {
    const { hub, tab, detail } = destination;
    crumbs.push({ label: t(hub.labelKey), to: hub.to });
    if (tab !== undefined) {
      crumbs.push({ label: t(tab.labelKey), to: hubTabHref(hub.key, tab.key) });
    }
    if (detail !== undefined) crumbs.push({ label: t(detail.labelKey) });
  }

  if (crumbs.length <= 1) {
    crumbs.push({ label: t("admin.hub.overview") });
  }

  return (
    <nav
      aria-label={t("admin.hub.breadcrumb")}
      data-testid="admin-breadcrumbs"
      className={cn(
        "flex min-w-0 items-center gap-1.5 text-ui-meta text-muted-foreground",
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
            {crumb.to !== undefined ? (
              <Link
                to={crumb.to}
                aria-current={last ? "page" : undefined}
                className={cn(
                  "truncate transition-colors hover:text-foreground",
                  last && "text-foreground",
                )}
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

export function hubTabLabel(
  hub: AdminHubKey,
  tab: string | null,
  t: ReturnType<typeof useAdminT>,
): string | null {
  if (tab === null) return null;
  const entry = HUB_TABS[hub].find((candidate) => candidate.key === tab);
  return entry === undefined ? null : t(entry.labelKey);
}
