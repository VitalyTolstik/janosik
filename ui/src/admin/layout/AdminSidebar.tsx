import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  ArrowLeft,
  ChevronRight,
  LayoutPanelLeft,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { routes } from "@/routes";
import { useAdminT } from "../admin-i18n";
import { useAdminAuth } from "../AdminAuthContext";
import {
  ADMIN_HUBS,
  ADMIN_NAV_GROUPS,
  HUB_TABS,
  hubTabHref,
  type AdminHubKey,
} from "./admin-nav";

/**
 * Master console sidebar: eight hubs in three task groups (Operate / Govern /
 * Configure), a 232 px expanded rail, a 64 px icon rail on tablets and a
 * 280 px sheet behind a scrim on phones. `data-collapsed` is the effective
 * rail state (stored preference or tablet layout); `data-mobile-open` is
 * transient.
 */
export function AdminSidebar({
  collapsed,
  mobileOpen,
  onNavigate,
}: {
  collapsed: boolean;
  mobileOpen: boolean;
  onNavigate: () => void;
}) {
  const t = useAdminT();
  const { admin } = useAdminAuth();
  const { pathname, search } = useLocation();
  const [allOpen, setAllOpen] = useState(false);
  const activeTab = new URLSearchParams(search).get("tab");
  const isOwner = admin?.role === "OWNER";

  const activeHub = (key: AdminHubKey): boolean => {
    if (key === "overview")
      return pathname === "/admin" || pathname === "/admin/";
    if (key === "users") return pathname.startsWith("/admin/users");
    if (key === "boards") {
      return (
        pathname.startsWith("/admin/boards") ||
        pathname.startsWith("/admin/cards")
      );
    }
    const hub = ADMIN_HUBS.find((entry) => entry.key === key);
    return hub !== undefined && pathname.startsWith(hub.to);
  };

  return (
    <>
      <aside
        data-testid="admin-sidebar"
        data-collapsed={collapsed ? "true" : "false"}
        data-mobile-open={mobileOpen ? "true" : "false"}
        aria-label={t("admin.hub.navLabel")}
        className="admin-sidebar flex shrink-0 flex-col border-r border-border bg-card/40 backdrop-blur-sm"
      >
        <NavLink
          to={routes.admin}
          end
          onClick={onNavigate}
          aria-label="Janosik"
          className={cn(
            "flex h-14 shrink-0 items-center gap-2.5 border-b border-border/60",
            collapsed ? "justify-center px-2" : "px-4",
          )}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <ShieldCheck className="h-4 w-4" aria-hidden />
          </span>
          {!collapsed ? (
            <div className="min-w-0 admin-hide-rail">
              <p className="truncate text-[13px] font-semibold tracking-tight text-foreground">
                Janosik
              </p>
              <p className="truncate text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {t("admin.nav.masterBadge")} console
              </p>
            </div>
          ) : null}
        </NavLink>

        {!collapsed ? (
          <div className="mx-3 mt-3 flex items-center gap-1.5 rounded-md border border-border/70 bg-background/40 px-2 py-1 text-[10px] text-muted-foreground admin-hide-rail">
            <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
            <span className="truncate">
              {import.meta.env.PROD ? "Production" : "Development"}
            </span>
            <span className="ml-auto font-mono text-[10px] opacity-70">
              self-hosted
            </span>
          </div>
        ) : null}

        <nav className="flex flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden px-2 py-3">
          {ADMIN_NAV_GROUPS.map((group) => (
            <div key={group.labelKey} className="space-y-0.5">
              <div
                className="flex h-5 items-center px-2.5 admin-hide-rail"
                aria-hidden={collapsed}
              >
                {collapsed ? (
                  <span className="mx-auto block h-px w-6 bg-border" />
                ) : (
                  <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
                    {t(group.labelKey)}
                  </p>
                )}
              </div>
              {group.keys.map((key) => {
                const hub = ADMIN_HUBS.find((entry) => entry.key === key);
                if (hub === undefined) return null;
                const active = activeHub(key);
                return (
                  <SidebarLink
                    key={hub.key}
                    to={hub.to}
                    label={t(hub.labelKey)}
                    icon={hub.icon}
                    collapsed={collapsed}
                    active={active}
                    onNavigate={onNavigate}
                  />
                );
              })}
            </div>
          ))}

          <button
            type="button"
            onClick={() => setAllOpen(true)}
            data-testid="admin-all-destinations"
            className={cn(
              "mt-1 flex h-7 items-center rounded-md text-[11px] text-muted-foreground transition-colors hover:bg-hover hover:text-foreground",
              collapsed
                ? "justify-center px-0"
                : "gap-2 px-2.5 admin-hide-rail",
            )}
            aria-label={t("admin.hub.allDestinations")}
          >
            <LayoutPanelLeft className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {!collapsed ? (
              <span className="truncate">{t("admin.hub.allDestinations")}</span>
            ) : null}
          </button>
        </nav>

        <div
          className={cn(
            "shrink-0 border-t border-border py-3",
            collapsed
              ? "flex flex-col items-center gap-2 px-2"
              : "space-y-2 px-3",
          )}
        >
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <NavLink
                  to={routes.home}
                  aria-label={t("admin.nav.backToBoards")}
                  onClick={onNavigate}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                </NavLink>
              </TooltipTrigger>
              <TooltipContent side="right">
                {t("admin.nav.backToBoards")}
              </TooltipContent>
            </Tooltip>
          ) : (
            <div className="flex items-center justify-between gap-2 admin-hide-rail">
              <LanguageSwitcher />
              <NavLink
                to={routes.home}
                onClick={onNavigate}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                {t("admin.nav.backToBoards")}
              </NavLink>
            </div>
          )}
        </div>
      </aside>

      <Dialog open={allOpen} onOpenChange={setAllOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {t("admin.hub.allDestinations")}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Every capability keeps a home inside the eight hubs. Old links
              still redirect here with their query string.
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[60vh] gap-4 overflow-y-auto sm:grid-cols-2">
            {(Object.keys(HUB_TABS) as AdminHubKey[]).map((hub) =>
              HUB_TABS[hub].length === 0 ? null : (
                <section key={hub} className="space-y-1.5">
                  <h3 className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    {t(ADMIN_HUBS.find((entry) => entry.key === hub)!.labelKey)}
                  </h3>
                  {HUB_TABS[hub]
                    .filter((tab) => tab.ownerOnly !== true || isOwner)
                    .map((tab) => (
                      <NavLink
                        key={tab.key}
                        to={hubTabHref(hub, tab.key)}
                        onClick={() => setAllOpen(false)}
                        className={cn(
                          "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
                          activeTab === tab.key && activeHub(hub)
                            ? "bg-primary/10 text-foreground"
                            : "text-muted-foreground hover:bg-hover hover:text-foreground",
                        )}
                      >
                        <span>{t(tab.labelKey)}</span>
                        <ChevronRight
                          className="h-3 w-3 opacity-50"
                          aria-hidden
                        />
                      </NavLink>
                    ))}
                </section>
              ),
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SidebarLink({
  to,
  label,
  icon: Icon,
  collapsed,
  active,
  onNavigate,
}: {
  to: string;
  label: string;
  icon: LucideIcon;
  collapsed: boolean;
  active: boolean;
  onNavigate: () => void;
}) {
  const link = (
    <NavLink
      to={to}
      end={to === "/admin"}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? label : undefined}
      className={cn(
        "admin-nav-item relative flex h-7 items-center rounded-md text-xs font-medium transition-colors",
        collapsed ? "justify-center px-0" : "gap-2.5 px-2.5 admin-hide-rail",
        active
          ? "text-foreground"
          : "text-muted-foreground hover:bg-hover hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {!collapsed ? <span className="truncate">{label}</span> : null}
    </NavLink>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
