import { useEffect, useRef } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

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

interface LanguageSwitcherProps {
  /** `icon` (header trigger) or `row` (account preferences). */
  variant?: "icon" | "row";
}

/** Language picker (English / Russian) — a globe icon with a dropdown. */
export function LanguageSwitcher({ variant = "icon" }: LanguageSwitcherProps) {
  const { lang, setLang, t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const { status, user, updateUser, impersonating } = useAuth();
  // The lazy catalog can take long enough for the user to change boards,
  // open a card or edit a filter after clicking the language. Keep the newest
  // router location so the cleanup below edits *that* URL instead of
  // navigating back to the click-time snapshot.
  const latestLocation = useRef(location);
  useEffect(() => {
    latestLocation.current = location;
  }, [location]);

  // Load the lazy catalog before switching; a failed load (offline, not yet
  // cached) leaves both the UI, the URL and the server profile on the current
  // language. The `?lng=` handoff is consumed only after the new catalog is
  // ready, so a reload can retry a failed one.
  //
  // The handoff must be removed through the router, not raw
  // `history.replaceState`: the board filter, card deep links and admin list
  // queries rebuild their URL from `useSearchParams`, which would otherwise
  // keep the stale `lng` and re-pin the old language on reload. The M39
  // workflow blocker ignores an `lng`-only search change.
  const choose = (next: Lang) => {
    void ensureLocale(next).then((ready) => {
      if (!ready) return;
      setLang(next);
      const current = latestLocation.current;
      if (new URLSearchParams(current.search).has("lng")) {
        const params = new URLSearchParams(current.search);
        params.delete("lng");
        void navigate(
          {
            pathname: current.pathname,
            search: params.toString(),
            hash: current.hash,
          },
          { replace: true, state: current.state },
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
        className="gap-2"
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
