import { Check, ChevronDown } from "lucide-react";

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

/**
 * Drop the one-shot `?lng=` handoff after the catalog is ready. A router
 * navigation would count as a location change and trip the dirty-workflow
 * blocker (M39); replacing the current history entry keeps the URL honest
 * without rendering a new route. The hash and every other parameter survive.
 */
function consumeLocaleParam(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("lng")) return;
    url.searchParams.delete("lng");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  } catch {
    // A history entry without a usable URL is not worth failing the switch.
  }
}

/** Language picker (English / Russian) — a globe icon with a dropdown. */
export function LanguageSwitcher({ variant = "icon" }: LanguageSwitcherProps) {
  const { lang, setLang, t } = useI18n();
  const { status, user, updateUser, impersonating } = useAuth();

  // Load the lazy catalog before switching; a failed load (offline, not yet
  // cached) leaves both the UI, the URL and the server profile on the current
  // language. The `?lng=` handoff is consumed only after the new catalog is
  // ready, so a reload can retry a failed one.
  const choose = (next: Lang) => {
    void ensureLocale(next).then((ready) => {
      if (!ready) return;
      setLang(next);
      consumeLocaleParam();
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
