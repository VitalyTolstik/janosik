import { Check, ChevronDown } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { api } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { LazyAnimatedIcon } from "@/components/ui/lazy-animated-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n, type Lang } from "@/i18n";
import { ensureLocale } from "@/i18n/i18n";
import { APP_BASE } from "@/utils/app-path";

interface LanguageSwitcherProps {
  /** `icon` (header trigger) or `row` (account preferences). */
  variant?: "icon" | "row";
}

/**
 * The router's current URL, read from `window` so it also works after this
 * component unmounts (closing the account dialog, switching Preferences
 * sections). `navigate` works in router-relative coordinates, so strip the
 * deploy basename that `createBrowserRouter({ basename })` adds.
 */
function currentRouterLocation(): {
  pathname: string;
  search: string;
  hash: string;
} {
  const { pathname, search, hash } = window.location;
  const base = APP_BASE === "/" ? "" : APP_BASE.replace(/\/$/, "");
  if (base === "") return { pathname, search, hash };
  if (pathname === base) return { pathname: "/", search, hash };
  if (pathname.startsWith(`${base}/`)) {
    return { pathname: pathname.slice(base.length), search, hash };
  }
  return { pathname, search, hash };
}

/** Language picker (English / Russian) — a globe icon with a dropdown. */
export function LanguageSwitcher({ variant = "icon" }: LanguageSwitcherProps) {
  const { lang, setLang, t } = useI18n();
  const navigate = useNavigate();
  const { status, user, updateUser, impersonating } = useAuth();

  // Load the lazy catalog before switching; a failed load (offline, not yet
  // cached) leaves both the UI, the URL and the server profile on the current
  // language. The `?lng=` handoff is consumed only after the new catalog is
  // ready, so a reload can retry a failed one.
  //
  // The handoff must be removed through the router, not raw
  // `history.replaceState`: the board filter, card deep links and admin list
  // queries rebuild their URL from `useSearchParams`, which would otherwise
  // keep the stale `lng` and re-pin the old language on reload. The M39
  // workflow blocker ignores an `lng`-only search change. Read the live URL
  // in the callback: this component may already be unmounted, and a captured
  // location would pull the user back to the pre-close route.
  const choose = (next: Lang) => {
    void ensureLocale(next).then((ready) => {
      if (!ready) return;
      setLang(next);
      const current = currentRouterLocation();
      const params = new URLSearchParams(current.search);
      if (params.has("lng")) {
        params.delete("lng");
        void navigate(
          {
            pathname: current.pathname,
            search: params.toString(),
            hash: current.hash,
          },
          { replace: true },
        );
      }
      if (status !== "authenticated" || user === null || impersonating) return;
      void api
        .updateProfile({ locale: next })
        .then(updateUser)
        .catch(() => undefined);
    });
  };

  const trigger =
    variant === "row" ? (
      <Button
        variant="outline"
        size="sm"
        className="gap-2 max-lg:min-h-11"
        data-testid="pref-language"
        aria-label={t("lang.aria")}
      >
        <LazyAnimatedIcon name="languages" size={16} />
        <span>{lang === "en" ? "English" : "Русский"}</span>
        <ChevronDown className="h-3.5 w-3.5 opacity-50" />
      </Button>
    ) : (
      <Button variant="ghost" size="icon" aria-label={t("lang.aria")}>
        <LazyAnimatedIcon name="languages" size={20} />
      </Button>
    );

  const menu = (
    <DropdownMenu>
      {variant === "icon" ? (
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        </TooltipTrigger>
      ) : (
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      )}
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuItem
          onClick={() => choose("en")}
          className={lang === "en" ? "font-medium text-foreground" : ""}
        >
          {lang === "en" && <Check className="h-4 w-4" />}
          <span className={lang === "en" ? "" : "pl-6"}>English</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => choose("ru")}
          className={lang === "ru" ? "font-medium text-foreground" : ""}
        >
          {lang === "ru" && <Check className="h-4 w-4" />}
          <span className={lang === "ru" ? "" : "pl-6"}>Русский</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (variant === "row") return menu;

  return (
    <Tooltip>
      {menu}
      <TooltipContent>{t("lang.tooltip")}</TooltipContent>
    </Tooltip>
  );
}
