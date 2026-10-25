import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Activity,
  ArrowLeft,
  FileText,
  Gauge,
  KanbanSquare,
  KeyRound,
  LayoutDashboard,
  Link2,
  ListChecks,
  LogOut,
  Mail,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  PlayCircle,
  ScrollText,
  Search,
  Share2,
  ShieldCheck,
  Tags,
  Users,
  ClipboardList,
  Columns3,
  Fingerprint,
} from "lucide-react";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { routes } from "@/routes";
import { useAdminT, type AdminMessageKey } from "./admin-i18n";
import { useAdminAuth } from "./AdminAuthContext";
import { GlobalSearchDialog } from "./GlobalSearch";

/**
 * Master panel shell (TASK-36, redesigned in TASK-48): fixed sidebar, dense
 * content area, compact type scale and a global omnibox (Cmd/Ctrl+K) that
 * searches every core entity at once.
 */

const NAV_SECTIONS: Array<{
  labelKey: AdminMessageKey;
  items: Array<{
    to: string;
    end?: boolean;
    labelKey: AdminMessageKey;
    icon: typeof LayoutDashboard;
    ownerOnly?: boolean;
  }>;
}> = [
  {
    labelKey: "admin.nav.section.monitoring",
    items: [
      {
        to: "/admin",
        end: true,
        labelKey: "admin.nav.dashboard",
        icon: LayoutDashboard,
      },
      { to: "/admin/activity", labelKey: "admin.nav.activity", icon: Activity },
      { to: "/admin/commands", labelKey: "admin.nav.log", icon: ClipboardList },
      { to: "/admin/audit", labelKey: "admin.nav.audit", icon: ScrollText },
    ],
  },
  {
    labelKey: "admin.nav.section.people",
    items: [
      { to: "/admin/users", labelKey: "admin.nav.users", icon: Users },
      {
        to: "/admin/masters",
        labelKey: "admin.nav.masters",
        icon: ShieldCheck,
        ownerOnly: true,
      },
    ],
  },
  {
    labelKey: "admin.nav.section.content",
    items: [
      { to: "/admin/boards", labelKey: "admin.nav.boards", icon: KanbanSquare },
      { to: "/admin/cards", labelKey: "admin.nav.cards", icon: FileText },
      {
        to: "/admin/columns",
        labelKey: "admin.nav.columns",
        icon: Columns3,
      },
      { to: "/admin/labels", labelKey: "admin.nav.labels", icon: Tags },
      {
        to: "/admin/checklists",
        labelKey: "admin.nav.checklists",
        icon: ListChecks,
      },
      {
        to: "/admin/cardLinks",
        labelKey: "admin.nav.cardLinks",
        icon: Link2,
      },
    ],
  },
  {
    labelKey: "admin.nav.section.collaboration",
    items: [
      {
        to: "/admin/comments",
        labelKey: "admin.nav.comments",
        icon: MessageSquare,
      },
      {
        to: "/admin/attachments",
        labelKey: "admin.nav.attachments",
        icon: Paperclip,
      },
    ],
  },
  {
    labelKey: "admin.nav.section.security",
    items: [
      {
        to: "/admin/sessions",
        labelKey: "admin.nav.sessions",
        icon: ShieldCheck,
      },
      { to: "/admin/tokens", labelKey: "admin.nav.tokens", icon: KeyRound },
      {
        to: "/admin/email",
        labelKey: "admin.nav.email",
        icon: Mail,
        ownerOnly: true,
      },
      {
        to: "/admin/oauth",
        labelKey: "admin.nav.oauth",
        icon: Fingerprint,
        ownerOnly: true,
      },
    ],
  },
  {
    labelKey: "admin.nav.section.ops",
    items: [
      {
        to: "/admin/traffic",
        labelKey: "admin.nav.traffic",
        icon: Gauge,
      },
      {
        to: "/admin/demo",
        labelKey: "admin.nav.demo",
        icon: PlayCircle,
      },
      {
        to: "/admin/shares",
        labelKey: "admin.nav.shares",
        icon: Share2,
      },
    ],
  },
];

/** localStorage key for the collapsed ("icon rail") sidebar preference. */
const SIDEBAR_KEY = "janosik.admin.sidebar";

function Brand({ collapsed }: { collapsed: boolean }) {
  const t = useAdminT();
  return (
    <NavLink
      to={routes.admin}
      end
      aria-label="Janosik"
      className={cn(
        "flex h-16 items-center gap-2.5",
        collapsed ? "justify-center px-2" : "px-4",
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <ShieldCheck className="h-4 w-4" aria-hidden />
      </span>
      {!collapsed ? (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight text-foreground">
            Janosik
          </p>
          <p className="truncate text-[10px] uppercase tracking-widest text-muted-foreground">
            {t("admin.nav.masterBadge")}
          </p>
        </div>
      ) : null}
    </NavLink>
  );
}

/**
 * One sidebar entry. When the rail is collapsed the label is dropped and the
 * icon is centred with a right-side tooltip — the popular "icon rail" pattern
 * (VS Code / Linear) that keeps the whole nav reachable in ~56px.
 */
function NavItem({
  item,
  collapsed,
}: {
  item: (typeof NAV_SECTIONS)[number]["items"][number];
  collapsed: boolean;
}) {
  const t = useAdminT();
  const { pathname } = useLocation();
  const label = t(item.labelKey);
  // A plain string className on purpose: when collapsed the link is wrapped by
  // Radix `TooltipTrigger asChild` (a Slot), and a Slot cannot resolve
  // react-router's function `className` — it would stringify the callback and
  // drop every style. Active state is computed here instead.
  const active = item.end
    ? pathname === item.to
    : pathname === item.to || pathname.startsWith(`${item.to}/`);
  const className = cn(
    "flex h-7 items-center rounded-lg text-xs font-medium transition-colors",
    collapsed ? "justify-center px-0" : "gap-2.5 px-2.5",
    active
      ? "bg-primary/15 text-foreground"
      : "text-muted-foreground hover:bg-hover hover:text-foreground",
  );
  const link = (
    <NavLink to={item.to} end={item.end} className={className}>
      <item.icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
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

export function AdminShell() {
  const t = useAdminT();
  const { admin, logout } = useAdminAuth();
  const isOwner = admin?.role === "OWNER";
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "1";
    } catch {
      return false;
    }
  });

  const toggleSidebar = useCallback(() => {
    setCollapsed((previous) => {
      const next = !previous;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      } catch {
        /* storage unavailable — the layout still toggles for the session */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      // Cmd/Ctrl+B toggles the sidebar (VS Code muscle memory).
      if (mod && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-[13px] text-foreground">
      <aside
        data-testid="admin-sidebar"
        data-collapsed={collapsed ? "true" : "false"}
        className={cn(
          "flex shrink-0 flex-col border-r border-border bg-card/40 transition-[width] duration-200",
          collapsed ? "w-14" : "w-52",
        )}
      >
        <Brand collapsed={collapsed} />
        <nav className="flex flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden px-2 pb-3">
          {NAV_SECTIONS.map((section) => (
            <div key={section.labelKey} className="space-y-0.5">
              {/* The header keeps the SAME height (h-5) in both states, so
                  collapsing never nudges the item rows by a pixel — the label
                  simply becomes a divider. */}
              <div
                className="flex h-5 items-center px-2.5"
                aria-hidden={collapsed}
              >
                {collapsed ? (
                  <span className="mx-auto block h-px w-6 bg-border" />
                ) : (
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground/70">
                    {t(section.labelKey)}
                  </p>
                )}
              </div>
              {section.items
                .filter((item) => item.ownerOnly !== true || isOwner)
                .map((item) => (
                  <NavItem key={item.to} item={item} collapsed={collapsed} />
                ))}
            </div>
          ))}
        </nav>

        <div
          className={cn(
            "border-t border-border py-3",
            collapsed
              ? "flex flex-col items-center gap-2 px-2"
              : "space-y-2 px-3",
          )}
        >
          {collapsed ? (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <NavLink
                    to={routes.home}
                    aria-label={t("admin.nav.backToBoards")}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                  </NavLink>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {t("admin.nav.backToBoards")}
                </TooltipContent>
              </Tooltip>
              <LanguageSwitcher />
            </>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <LanguageSwitcher />
              <NavLink
                to={routes.home}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                {t("admin.nav.backToBoards")}
              </NavLink>
            </div>
          )}
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar: sidebar toggle, signed-in identity, the omnibox, logout. */}
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-card/30 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-testid="admin-sidebar-toggle"
                  aria-label={t("admin.nav.toggleSidebar")}
                  aria-expanded={!collapsed}
                  onClick={toggleSidebar}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-background/50 text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
                >
                  {collapsed ? (
                    <PanelLeftOpen className="h-4 w-4" aria-hidden />
                  ) : (
                    <PanelLeftClose className="h-4 w-4" aria-hidden />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("admin.nav.toggleSidebar")}</TooltipContent>
            </Tooltip>
            <p className="truncate text-xs text-muted-foreground">
              {t("admin.nav.signedInAs")}{" "}
              <span className="font-medium text-foreground">
                {admin?.email}
              </span>
              {admin?.role === "OWNER" ? (
                <span className="ml-2 rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-primary">
                  {t("admin.nav.masterBadge")}
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="admin-global-search"
              onClick={() => setSearchOpen(true)}
              className="inline-flex h-7 items-center gap-2 rounded-lg border border-border bg-background/50 px-2.5 text-xs text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
            >
              <Search className="h-3.5 w-3.5" aria-hidden />
              <span>{t("admin.search.title")}</span>
              <kbd className="rounded border border-border bg-hover/50 px-1 font-mono text-[10px]">
                ⌘K
              </kbd>
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              data-testid="admin-logout"
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-background/50 px-2.5 text-xs text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden />
              {t("admin.nav.logout")}
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      <GlobalSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
