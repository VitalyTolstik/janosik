import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LanguagesIcon } from "@/components/ui/languages-icon";
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
import { useI18n } from "@/i18n";

/** Language picker (English / Русский) — a globe icon with a dropdown. */
export function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n();

  return (
    <Tooltip>
      <DropdownMenu>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("lang.aria")}
            >
              <LanguagesIcon size={20} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <DropdownMenuContent align="end" className="w-36">
          <DropdownMenuItem
            onClick={() => setLang("en")}
            className={lang === "en" ? "font-medium text-foreground" : ""}
          >
            {lang === "en" && <Check className="h-4 w-4" />}
            <span className={lang === "en" ? "" : "pl-6"}>English</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setLang("ru")}
            className={lang === "ru" ? "font-medium text-foreground" : ""}
          >
            {lang === "ru" && <Check className="h-4 w-4" />}
            <span className={lang === "ru" ? "" : "pl-6"}>Русский</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipContent>{t("lang.tooltip")}</TooltipContent>
    </Tooltip>
  );
}
