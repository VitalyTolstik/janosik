import { Moon, Sun } from "lucide-react";

import { BackgroundSwitcher } from "@/components/BackgroundSwitcher";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTheme } from "@/hooks/use-theme";
import { useI18n } from "@/i18n";

/** Header: brand, language switcher and the dark/light theme toggle. */
export function Header() {
  const { theme, toggleTheme } = useTheme();
  const { t } = useI18n();
  const isDark = theme === "dark";

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b bg-background/80 px-4 backdrop-blur-md sm:px-6">
      <div className="group flex items-center gap-2.5">
        <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-secondary text-primary-foreground shadow-sm">
          <svg
            className="janosik-feather"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <defs>
              <linearGradient
                id="janosik-feather-grad"
                x1="0"
                y1="1"
                x2="1"
                y2="0"
              >
                <stop offset="0" stopColor="currentColor" stopOpacity="0.95" />
                <stop offset="1" stopColor="currentColor" stopOpacity="0.72" />
              </linearGradient>
            </defs>
            <path
              d="M14.086 18.412A2 2 0 0112.67 19H5v-7.672a2 2 0 01.586-1.414L11.75 3.75a6 6 0 118.49 8.49z"
              fill="url(#janosik-feather-grad)"
            />
            <path
              d="M16 8 2 22"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
            <path
              d="M17.488 15H9"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinecap="round"
              opacity="0.6"
            />
          </svg>
          <svg
            className="janosik-sparkle pointer-events-none absolute -right-0.5 -top-0.5 h-3 w-3"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden
          >
            <path d="M12 0c.9 5.2 3.6 7.8 12 12-8.4 4.2-11.1 6.8-12 12-.9-5.2-3.6-7.8-12-12 8.4-4.2 11.1-6.8 12-12z" />
          </svg>
        </div>
        <h1 className="font-display text-3xl font-medium tracking-[-0.02em] text-foreground">
          Janosik
        </h1>
      </div>

      <div className="flex items-center gap-0.5">
        <BackgroundSwitcher />
        <LanguageSwitcher />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="janosik-theme-btn"
              aria-label={t("theme.aria")}
              onClick={toggleTheme}
            >
              {isDark ? (
                <Sun className="janosik-icon-sun h-5 w-5" />
              ) : (
                <Moon className="janosik-icon-moon h-5 w-5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {isDark ? t("theme.tooltipLight") : t("theme.tooltipDark")}
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
