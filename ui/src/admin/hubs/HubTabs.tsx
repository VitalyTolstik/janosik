import { Link, useSearchParams } from "react-router-dom";
import { Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAdminT } from "../admin-i18n";
import { useAdminAuth } from "../AdminAuthContext";
import {
  ADMIN_HUBS,
  HUB_DEFAULT_TAB,
  HUB_TABS,
  hubTabHref,
  type AdminHubKey,
} from "../layout/admin-nav";

/**
 * The tab strip that turns a hub into a context. Every legacy destination is
 * still one click away and its URL keeps the `?tab=` parameter, so links are
 * shareable and old bookmarks redirect into the matching tab.
 */
export function HubTabs({
  hub,
  showOwnerTabs = false,
}: {
  hub: AdminHubKey;
  /** Settings keeps owner-only sections visible read-only; Access hides Masters. */
  showOwnerTabs?: boolean;
}) {
  const t = useAdminT();
  const { admin } = useAdminAuth();
  const [params] = useSearchParams();
  const isOwner = admin?.role === "OWNER";
  const tabs = HUB_TABS[hub];
  if (tabs.length === 0) return null;

  const active = params.get("tab") ?? HUB_DEFAULT_TAB[hub] ?? tabs[0]?.key;
  const hubEntry = ADMIN_HUBS.find((entry) => entry.key === hub);
  const visible = tabs.filter(
    (tab) => tab.ownerOnly !== true || isOwner || showOwnerTabs,
  );

  return (
    <div
      className="flex shrink-0 items-center gap-3 border-b border-border bg-background/95 px-4 py-1.5 backdrop-blur"
      data-testid="admin-hub-tabs"
    >
      <span className="hidden shrink-0 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground sm:inline">
        {hubEntry === undefined ? t("admin.hub.tabNav") : t(hubEntry.labelKey)}
      </span>
      <nav
        role="tablist"
        aria-label={t("admin.hub.tabNav")}
        className="admin-tab-strip -mb-1.5 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto pt-1.5"
      >
        {visible.map((tab) => {
          const selected = active === tab.key;
          return (
            <Link
              key={tab.key}
              to={hubTabHref(hub, tab.key)}
              role="tab"
              aria-selected={selected}
              data-testid={`admin-hub-tab-${tab.key}`}
              className={cn(
                "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-colors",
                selected
                  ? "bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:bg-hover hover:text-foreground",
              )}
            >
              {tab.ownerOnly === true && !isOwner ? (
                <Lock className="h-3 w-3 opacity-60" aria-hidden />
              ) : null}
              {t(tab.labelKey)}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function HubFrame({
  hub,
  children,
  showOwnerTabs = false,
  bodyClassName,
}: {
  hub: AdminHubKey;
  children: React.ReactNode;
  showOwnerTabs?: boolean;
  bodyClassName?: string;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <HubTabs hub={hub} showOwnerTabs={showOwnerTabs} />
      <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </div>
  );
}
