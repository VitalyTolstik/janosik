import { useState } from "react";
import { Check, ChevronDown, Folder } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { boardColor } from "@/utils/board-color";

interface BoardScopeBoard {
  id: string;
  title: string;
}

/**
 * Board-scope combobox for the global agents header and the page toolbar.
 * The prototype uses one custom listbox for both: colored board dots, an
 * opaque surface and a short scope note. The selected value stays in
 * `?board=`; this component only reports the choice.
 */
export function BoardScopeSelect({
  value,
  boards,
  onChange,
  ariaLabel,
  testId,
  variant,
  className,
  counts,
  totalCount,
}: {
  value: string;
  boards: readonly BoardScopeBoard[];
  onChange: (value: string) => void;
  ariaLabel: string;
  testId: string;
  variant: "header" | "filter";
  className?: string;
  /** Pending approvals per board; absent boards stay without a number. */
  counts?: Readonly<Record<string, number>>;
  /** Pending approvals across all boards, for the “All boards” row. */
  totalCount?: number;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const options = [
    { value: "all", label: t("agents.filters.allBoards") },
    ...boards.map((board) => ({ value: board.id, label: board.title })),
    ...(value !== "all" && !boards.some((board) => board.id === value)
      ? [{ value, label: t("agents.shell.unknownBoard") }]
      : []),
  ];
  const current =
    options.find((option) => option.value === value) ?? options[0];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
          data-testid={testId}
          className={cn(
            "inline-flex max-w-full min-w-0 items-center justify-between gap-1.5 rounded-md text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            variant === "header"
              ? "h-[30px] px-2 font-agent-surface text-[13px] font-semibold leading-[1.2] hover:bg-hover"
              : "min-h-11 border border-border bg-card px-2 text-xs hover:bg-hover md:h-7 md:min-h-7",
            variant === "filter" &&
              value !== "all" &&
              "border-primary/40 bg-primary/10 text-foreground",
            className,
          )}
        >
          {variant === "filter" ? (
            <Folder
              aria-hidden
              className="h-3 w-3 shrink-0 text-muted-foreground"
            />
          ) : null}
          <span className="min-w-0 truncate">{current.label}</span>
          <ChevronDown
            aria-hidden
            className={cn(
              "shrink-0 text-muted-foreground",
              variant === "header" ? "h-[13px] w-[13px]" : "h-[11px] w-[11px]",
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[280px] max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border bg-popover p-1 shadow-xl"
      >
        <div
          role="listbox"
          aria-label={ariaLabel}
          className="max-h-80 overflow-y-auto"
        >
          {options.map((option) => {
            const count =
              option.value === "all" ? totalCount : counts?.[option.value];
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                data-testid={`${testId}-option-${option.value}`}
                onClick={() => {
                  setOpen(false);
                  if (option.value !== value) onChange(option.value);
                }}
                className={cn(
                  "flex min-h-9 w-full items-center gap-2 rounded-[5px] border border-transparent px-2.5 py-1.5 text-left text-[12px] leading-[1.3] text-foreground hover:bg-hover max-md:min-h-11",
                  option.value === value &&
                    "border-primary/30 bg-primary/10 hover:bg-primary/10",
                )}
              >
                {option.value === "all" ? (
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 shrink-0 rounded-full border border-muted-foreground"
                  />
                ) : (
                  <span
                    aria-hidden
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-[2px]",
                      boardColor(option.value),
                    )}
                  />
                )}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {typeof count === "number" && count > 0 ? (
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {count > 99 ? "99+" : count}
                  </span>
                ) : null}
                {option.value === value ? (
                  <Check
                    className="h-3.5 w-3.5 shrink-0 text-primary"
                    aria-hidden
                  />
                ) : null}
              </button>
            );
          })}
        </div>
        <p className="mt-1 border-t border-border px-2.5 pb-1 pt-2 text-[11px] leading-5 text-muted-foreground">
          {t("agents.filters.boardScopeNote")}
        </p>
      </PopoverContent>
    </Popover>
  );
}
