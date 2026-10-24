import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
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
  Paperclip,
  PlayCircle,
  ScrollText,
  Search,
  ShieldCheck,
  Tags,
  Users,
  ClipboardList,
  Columns3,
  Fingerprint,
} from "lucide-react";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
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
    ],
  },
];

function Brand() {
  const t = useAdminT();
  return (
    <div className="flex items-center gap-2.5 px-4 py-4">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <ShieldCheck className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold tracking-tight text-foreground">
          Janosik
        </p>
        <p className="truncate text-[10px] uppercase tracking-widest text-muted-foreground">
          {t("admin.nav.masterBadge")}
        </p>
      </div>
    </div>
  );
}

export function AdminShell() {
  const t = useAdminT();
  const { admin, logout } = useAdminAuth();
  const isOwner = admin?.role === "OWNER";
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-[13px] text-foreground">
      <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-card/40">
        <Brand />
        <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-2 pb-3">
          {NAV_SECTIONS.map((section) => (
            <div key={section.labelKey} className="space-y-0.5">
              <p className="px-2.5 pb-0.5 text-[10px] uppercase tracking-widest text-muted-foreground/70">
                {t(section.labelKey)}
              </p>
              {section.items
                .filter((item) => item.ownerOnly !== true || isOwner)
                .map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                        isActive
                          ? "bg-primary/15 text-foreground"
                          : "text-muted-foreground hover:bg-hover hover:text-foreground",
                      )
                    }
                  >
                    <item.icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {t(item.labelKey)}
                  </NavLink>
                ))}
            </div>
          ))}
        </nav>

        <div className="space-y-2 border-t border-border px-3 py-3">
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
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar: signed-in identity, the omnibox and the way out. */}
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-card/30 px-6">
          <p className="truncate text-xs text-muted-foreground">
            {t("admin.nav.signedInAs")}{" "}
            <span className="font-medium text-foreground">{admin?.email}</span>
            {admin?.role === "OWNER" ? (
              <span className="ml-2 rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-primary">
                {t("admin.nav.masterBadge")}
              </span>
            ) : null}
          </p>
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
