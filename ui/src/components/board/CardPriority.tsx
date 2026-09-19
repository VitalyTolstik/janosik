import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n";
import { useBoardActions } from "@/store/BoardContext";
import type { CardPriority } from "@janosik/shared";
import { DEFAULT_CARD_PRIORITY } from "@janosik/shared";
import { PRIORITY_META, PRIORITY_ORDER } from "@/utils/priority";

/**
 * Priority row in the card dialog (TASK-45): a dropdown of the six
 * Jira-style levels, checkmark on the current one. Applying is immediate
 * (like the label picker); "medium" resets the default and drops the
 * field. VIEWER mode renders plain text instead of the menu.
 */
export function CardPriority({
  cardId,
  priority,
  readOnly = false,
}: {
  cardId: string;
  /** Current priority; absent = the default "medium". */
  priority?: CardPriority;
  readOnly?: boolean;
}) {
  const { t } = useI18n();
  const { setCardPriority } = useBoardActions();
  const current = priority ?? DEFAULT_CARD_PRIORITY;
  const CurrentIcon = PRIORITY_META[current].icon;

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-medium text-muted-foreground">
        {t("priority.label")}
      </span>
      {readOnly ? (
        <span className="text-sm text-foreground">
          {t(`priority.${current}`)}
        </span>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" data-testid="priority-trigger">
              <CurrentIcon
                className={`h-3.5 w-3.5 ${PRIORITY_META[current].iconClass}`}
              />
              {t(`priority.${current}`)}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuLabel>{t("priority.label")}</DropdownMenuLabel>
            {PRIORITY_ORDER.map((value) => {
              const meta = PRIORITY_META[value];
              const Icon = meta.icon;
              return (
                <DropdownMenuItem
                  key={value}
                  data-testid={`priority-option-${value}`}
                  disabled={value === current}
                  onClick={() => setCardPriority(cardId, value)}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${meta.iconClass}`}
                    aria-hidden
                  />
                  <span className="flex-1">{t(`priority.${value}`)}</span>
                  {value === current ? <Check className="h-3.5 w-3.5" /> : null}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
