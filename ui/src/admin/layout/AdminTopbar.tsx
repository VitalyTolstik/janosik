import {
  HelpCircle,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Rows3,
  Search,
  Sun,
} from "lucide-react";

import { useTheme } from "@/hooks/use-theme";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useAdminT } from "../admin-i18n";
import { useAdminAuth } from "../AdminAuthContext";
import { AdminBreadcrumbs } from "./AdminBreadcrumbs";

/**
 * 44 px top bar: mobile menu, breadcrumbs, command-palette trigger, density,
 * theme, shortcut help and the signed-in master. Navigation itself lives in
 * the sidebar; the top bar only carries context and global controls.
 */
export function AdminTopbar({
  collapsed,
  mobile,
  density,
  onToggleSidebar,
  onToggleDensity,
  onOpenPalette,
  onOpenShortcuts,
}: {
  collapsed: boolean;
  mobile: boolean;
  density: "comfortable" | "compact";
  onToggleSidebar: () => void;
  onToggleDensity: () => void;
  onOpenPalette: () => void;
  onOpenShortcuts: () => void;
}) {
  const t = useAdminT();
  const { admin, logout } = useAdminAuth();
  const { theme, setTheme } = useTheme();

  return (
    <header
      role="banner"
      className="admin-topbar flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card/30 px-4"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-testid="admin-sidebar-toggle"
              aria-label={t("admin.nav.toggleSidebar")}
              className="admin-sidebar-toggle inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background/50 text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
              aria-expanded={mobile ? undefined : !collapsed}
              onClick={onToggleSidebar}
            >
              {mobile ? (
                <Menu className="h-4 w-4" aria-hidden />
              ) : collapsed ? (
                <PanelLeftOpen className="h-4 w-4" aria-hidden />
              ) : (
                <PanelLeftClose className="h-4 w-4" aria-hidden />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {mobile ? t("admin.hub.openMenu") : t("admin.nav.toggleSidebar")}
          </TooltipContent>
        </Tooltip>

        <AdminBreadcrumbs className="hidden max-w-[26rem] sm:flex" />

        {admin ? (
          <div className="hidden items-center gap-2 border-l border-border/70 pl-2.5 lg:flex">
            <p
              className="max-w-[18rem] truncate text-[11px] text-muted-foreground"
              title={admin.email}
            >
              <span className="sr-only">{t("admin.nav.signedInAs")} </span>
              <span className="font-medium text-foreground">{admin.email}</span>
            </p>
            <span
              className={cn(
                "rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                admin.role === "OWNER"
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border bg-hover/60 text-muted-foreground",
              )}
            >
              {admin.role === "OWNER" ? t("admin.nav.masterBadge") : "Operator"}
            </span>
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          data-testid="admin-global-search"
          onClick={onOpenPalette}
          className="inline-flex h-7 items-center gap-2 rounded-md border border-border bg-background/50 px-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
        >
          <Search className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden sm:inline">{t("admin.search.title")}</span>
          <kbd className="hidden rounded border border-border bg-hover/50 px-1 font-mono text-[10px] sm:inline">
            ⌘K
          </kbd>
        </button>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-testid="admin-density-toggle"
              aria-label={t("admin.density.toggle")}
              aria-pressed={density === "compact"}
              onClick={onToggleDensity}
              className={cn(
                "hidden h-7 w-7 items-center justify-center rounded-md border border-border bg-background/50 transition-colors hover:bg-hover hover:text-foreground sm:inline-flex",
                density === "compact"
                  ? "text-primary"
                  : "text-muted-foreground",
              )}
            >
              <Rows3 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {t("admin.density.label")} ·{" "}
            {density === "compact"
              ? t("admin.density.compact")
              : t("admin.density.comfortable")}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-testid="admin-theme-toggle"
              aria-label={t("admin.nav.toggleTheme")}
              aria-pressed={theme === "dark"}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background/50 text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
            >
              {theme === "dark" ? (
                <Sun className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Moon className="h-3.5 w-3.5" aria-hidden />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("admin.nav.toggleTheme")}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-testid="admin-shortcuts-open"
              aria-label={t("admin.shortcuts.open")}
              onClick={onOpenShortcuts}
              className="hidden h-7 w-7 items-center justify-center rounded-md border border-border bg-background/50 text-muted-foreground transition-colors hover:bg-hover hover:text-foreground sm:inline-flex"
            >
              <HelpCircle className="h-3.5 w-3.5" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("admin.shortcuts.open")}</TooltipContent>
        </Tooltip>

        <button
          type="button"
          onClick={() => void logout()}
          data-testid="admin-logout"
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background/50 px-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden sm:inline">{t("admin.nav.logout")}</span>
        </button>
      </div>
    </header>
  );
}
