import { Check, ChevronDown } from "lucide-react";

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
import { useI18n, useTimeFormat, type TimeFormat } from "@/i18n";
import type { MessageKey } from "@/i18n/i18n";

const FORMAT_KEYS: Record<TimeFormat, MessageKey> = {
  auto: "timeFormat.auto",
  "12h": "timeFormat.h12",
  "24h": "timeFormat.h24",
};

const FORMATS: TimeFormat[] = ["auto", "12h", "24h"];

interface TimeFormatSwitcherProps {
  /** `icon` (header trigger) or `row` (account preferences). */
  variant?: "icon" | "row";
}

/**
 * Clock format picker (auto / 12-hour / 24-hour) — a clock icon with a
 * dropdown. "Auto" follows the locale convention (en: 12h AM/PM, ru: 24h);
 * the choice persists in localStorage `janosik-time-format`.
 */
export function TimeFormatSwitcher({
  variant = "icon",
}: TimeFormatSwitcherProps) {
  const { t } = useI18n();
  const { timeFormat, setTimeFormat } = useTimeFormat();

  const trigger =
    variant === "row" ? (
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        data-testid="pref-time-format"
        aria-label={t("timeFormat.aria")}
      >
        <LazyAnimatedIcon name="clock" size={16} />
        <span>{t(FORMAT_KEYS[timeFormat])}</span>
        <ChevronDown className="h-3.5 w-3.5 opacity-50" />
      </Button>
    ) : (
      <Button variant="ghost" size="icon" aria-label={t("timeFormat.aria")}>
        <LazyAnimatedIcon name="clock" size={20} />
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
      <DropdownMenuContent align="end" className="w-40">
        {FORMATS.map((format) => (
          <DropdownMenuItem
            key={format}
            onClick={() => setTimeFormat(format)}
            className={
              timeFormat === format ? "font-medium text-foreground" : ""
            }
          >
            {timeFormat === format && <Check className="h-4 w-4" />}
            <span className={timeFormat === format ? "" : "pl-6"}>
              {t(FORMAT_KEYS[format])}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (variant === "row") return menu;

  return (
    <Tooltip>
      {menu}
      <TooltipContent>{t("timeFormat.tooltip")}</TooltipContent>
    </Tooltip>
  );
}
