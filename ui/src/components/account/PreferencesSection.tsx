import type { ReactNode } from "react";
import { Moon, SlidersHorizontal, Sun } from "lucide-react";

import { BackgroundSwitcher } from "@/components/BackgroundSwitcher";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { TimeFormatSwitcher } from "@/components/TimeFormatSwitcher";
import { useTheme } from "@/hooks/use-theme";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/**
 * Preferences section (TASK-36.1): the personal display options that used to
 * crowd the header — language, time format, theme and the board background.
 * Every choice persists exactly like before (localStorage); the header keeps
 * only the quick theme toggle.
 */
export function PreferencesSection() {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();

  return (
    <section className="space-y-5" data-testid="account-preferences">
      <header className="space-y-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <SlidersHorizontal className="h-4 w-4 text-primary" aria-hidden />
          {t("account.prefs.title")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t("account.prefs.description")}
        </p>
      </header>

      <div className="divide-y rounded-lg border bg-muted/30 px-4">
        <Row
          label={t("account.prefs.language")}
          hint={t("account.prefs.languageHint")}
        >
          <LanguageSwitcher variant="row" />
        </Row>
        <Row
          label={t("account.prefs.timeFormat")}
          hint={t("account.prefs.timeFormatHint")}
        >
          <TimeFormatSwitcher variant="row" />
        </Row>
        <Row
          label={t("account.prefs.theme")}
          hint={t("account.prefs.themeHint")}
        >
          <div
            role="group"
            aria-label={t("account.prefs.theme")}
            className="flex rounded-lg border p-0.5"
          >
            <button
              type="button"
              data-testid="pref-theme-light"
              aria-pressed={theme === "light"}
              onClick={() => setTheme("light")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors",
                theme === "light"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Sun className="h-3.5 w-3.5" aria-hidden />
              {t("account.prefs.themeLight")}
            </button>
            <button
              type="button"
              data-testid="pref-theme-dark"
              aria-pressed={theme === "dark"}
              onClick={() => setTheme("dark")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors",
                theme === "dark"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Moon className="h-3.5 w-3.5" aria-hidden />
              {t("account.prefs.themeDark")}
            </button>
          </div>
        </Row>
        <Row
          label={t("account.prefs.background")}
          hint={t("account.prefs.backgroundHint")}
        >
          <BackgroundSwitcher variant="row" />
        </Row>
      </div>
    </section>
  );
}
