import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { useTheme } from "@/hooks/use-theme";
import { useAdminT } from "./admin-i18n";
import { AdminSidebar } from "./layout/AdminSidebar";
import { AdminTopbar } from "./layout/AdminTopbar";
import { ADMIN_HUBS, HUB_SHORTCUTS } from "./layout/admin-nav";
import { AdminShortcutsDialog } from "./layout/AdminShortcutsDialog";
import { GlobalSearchDialog, rememberRecentPath } from "./GlobalSearch";
import "./admin.css";

/**
 * Master console shell (redesigned): eight hubs, a 232/64/280 px responsive
 * sidebar, breadcrumbs and the command palette. Dense rows and controls are
 * driven by the `.admin-app` token layer, with a persisted density preference.
 */

const SIDEBAR_KEY = "janosik.admin.sidebar";
const DENSITY_KEY = "janosik.admin.density";

/** Phone: the sidebar becomes a sheet. Matches the table-card breakpoint. */
const PHONE_QUERY = "(max-width: 639px)";
/** Tablet: the sidebar becomes a permanent 64 px icon rail. */
const RAIL_QUERY = "(max-width: 959px)";

type Density = "comfortable" | "compact";

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    try {
      return window.matchMedia?.(query).matches ?? false;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (media === undefined) return;
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

function readDensity(): Density {
  try {
    return localStorage.getItem(DENSITY_KEY) === "compact"
      ? "compact"
      : "comfortable";
  } catch {
    return "comfortable";
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    target.isContentEditable
  );
}

export function AdminShell() {
  const t = useAdminT();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { theme, setTheme } = useTheme();
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobile = useMediaQuery(PHONE_QUERY);
  const railViewport = useMediaQuery(RAIL_QUERY);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [density, setDensity] = useState<Density>(readDensity);
  const pendingG = useRef<number | null>(null);

  // The tablet rail is a layout state, not a stored preference: it exists
  // even when the user asked for the expanded sidebar on a wide screen.
  const effectiveCollapsed = !mobile && (collapsed || railViewport);

  const toggleSidebar = useCallback(() => {
    if (mobile) {
      setMobileOpen((open) => !open);
      return;
    }
    if (railViewport) return;
    setCollapsed((previous) => {
      const next = !previous;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      } catch {
        /* storage unavailable — the layout still toggles for the session */
      }
      return next;
    });
  }, [mobile, railViewport]);

  const toggleDensity = useCallback(() => {
    setDensity((previous) => {
      const next: Density =
        previous === "comfortable" ? "compact" : "comfortable";
      try {
        localStorage.setItem(DENSITY_KEY, next);
      } catch {
        /* storage unavailable — the preference still applies this session */
      }
      return next;
    });
  }, []);

  // Leaving the phone layout closes the sheet; the rail needs no transient
  // state, so it never inherits an open drawer from a narrower window.
  useEffect(() => {
    if (!mobile) setMobileOpen(false);
  }, [mobile]);

  useEffect(() => {
    setMobileOpen(false);
    rememberRecentPath(pathname);
  }, [pathname]);

  // Move keyboard focus to the content region after a route change; screen
  // readers then announce the new h1 instead of leaving focus on the old link.
  useEffect(() => {
    const main = document.getElementById("admin-main");
    main?.focus({ preventScroll: true });
  }, [pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (mod && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggleSidebar();
        return;
      }
      if (isEditableTarget(event.target) || event.metaKey || event.ctrlKey) {
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (event.key.toLowerCase() === "g") {
        pendingG.current = Date.now();
        return;
      }
      if (pendingG.current !== null && Date.now() - pendingG.current < 900) {
        const hub = HUB_SHORTCUTS[event.key.toLowerCase()];
        if (hub !== undefined) {
          event.preventDefault();
          pendingG.current = null;
          const entry = ADMIN_HUBS.find((candidate) => candidate.key === hub);
          if (entry !== undefined) navigate(entry.to);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, toggleSidebar]);

  return (
    <div
      className="admin-app admin-shell"
      data-density={density}
      data-collapsed={effectiveCollapsed ? "true" : "false"}
      data-mobile-open={mobileOpen ? "true" : "false"}
    >
      <a href="#admin-main" className="admin-skip-link">
        Skip to content
      </a>

      <AdminSidebar
        collapsed={effectiveCollapsed}
        mobileOpen={mobileOpen}
        onNavigate={() => setMobileOpen(false)}
      />

      {mobileOpen ? (
        <button
          type="button"
          aria-label={t("admin.hub.closeMenu")}
          data-testid="admin-sidebar-scrim"
          className="admin-scrim fixed inset-0 z-50 border-0 sm:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <div className="admin-main flex flex-1 flex-col overflow-hidden">
        <AdminTopbar
          collapsed={effectiveCollapsed}
          mobile={mobile}
          density={density}
          onToggleSidebar={toggleSidebar}
          onToggleDensity={toggleDensity}
          onOpenPalette={() => setSearchOpen(true)}
          onOpenShortcuts={() => setShortcutsOpen(true)}
        />

        <main
          id="admin-main"
          tabIndex={-1}
          className="min-h-0 flex-1 overflow-y-auto outline-none"
        >
          <Outlet />
        </main>
      </div>

      <GlobalSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onOpenShortcuts={() => {
          setSearchOpen(false);
          setShortcutsOpen(true);
        }}
        onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
        onToggleDensity={toggleDensity}
      />
      <AdminShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
      />
    </div>
  );
}
