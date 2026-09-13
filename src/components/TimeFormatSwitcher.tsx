import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ClockIcon } from "@/components/ui/clock-icon";
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

/**
 * Clock format picker (auto / 12-hour / 24-hour) — a clock icon with a
 * dropdown, next to the language switcher. "Auto" follows the locale
 * convention (en: 12h AM/PM, ru: 24h); the choice persists in
 * localStorage `janosik-time-format`.
 */
export function TimeFormatSwitcher() {
  const { t } = useI18n();
  const { timeFormat, setTimeFormat } = useTimeFormat();

  return (
    <Tooltip>
      <DropdownMenu>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("timeFormat.aria")}
            >
              <ClockIcon size={20} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
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
      <TooltipContent>{t("timeFormat.tooltip")}</TooltipContent>
    </Tooltip>
  );
}
