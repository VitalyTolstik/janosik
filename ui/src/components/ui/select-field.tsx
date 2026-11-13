import { useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";

import { useCombobox, type ComboboxOption } from "@/components/ui/combobox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface SelectFieldProps<T extends string> {
  id?: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Accessible name when the visible label is not attached. */
  ariaLabel?: string;
  testId: string;
  /** Size/spacing overrides for the trigger (the h-9 default stays). */
  className?: string;
  /** Optional decorative icon before the selected value. */
  leadingIcon?: ReactNode;
  chevronClassName?: string;
}

/**
 * Form select with a themed option list. Native `<select>` popups are drawn by
 * the browser: their option rows ignore the app theme and show a white sheet
 * on dark dialogs. This is the agent-surfaces custom combobox (TASK-179.9):
 * an opaque portalled listbox, roving active option, Arrow/Home/End/Enter/
 * Space/Escape, first-letter typeahead, 36 px rows on desktop and 44 px rows
 * on mobile. The option test ids are `<testId>-option-<value>`.
 */
export function SelectField<T extends string>({
  id,
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  testId,
  className,
  leadingIcon,
  chevronClassName,
}: SelectFieldProps<T>) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((option) => option.value === value);
  const combobox = useCombobox({
    options: options as readonly ComboboxOption[],
    value,
    open,
    onOpenChange: setOpen,
    onSelect: (next) => onChange(next as T),
    triggerRef,
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          ref={triggerRef}
          disabled={disabled}
          aria-label={ariaLabel}
          {...combobox.triggerProps}
          data-testid={testId}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-2 text-left text-sm text-foreground transition-colors hover:border-ring/50 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {leadingIcon}
            <span className="truncate">{selected?.label ?? ""}</span>
          </span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground",
              chevronClassName,
            )}
            aria-hidden
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        onOpenAutoFocus={(event) => event.preventDefault()}
        {...combobox.listboxProps}
        aria-label={ariaLabel}
        data-testid={`${testId}-listbox`}
        className="z-[70] max-h-64 overflow-y-auto overscroll-contain rounded-md border bg-popover p-1 text-popover-foreground shadow-xl outline-none"
        style={{
          width: "var(--radix-popover-trigger-width)",
          pointerEvents: "auto",
        }}
      >
        {options.map((option, index) => {
          const active = index === combobox.activeIndex;
          const checked = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              {...combobox.getOptionProps(index, option as ComboboxOption)}
              data-testid={`${testId}-option-${option.value}`}
              onClick={() => combobox.choose(index)}
              className={cn(
                "flex min-h-9 w-full items-center justify-between rounded-md border border-transparent px-2 py-1.5 text-left text-[12px] leading-[1.35] transition-colors max-md:min-h-11",
                active && "bg-hover",
                checked
                  ? "border-primary/30 bg-primary/10 font-medium text-foreground hover:bg-primary/10"
                  : "text-foreground/90 hover:bg-hover",
              )}
            >
              <span className="min-w-0 truncate">{option.label}</span>
              {checked ? (
                <Check
                  className="h-3.5 w-3.5 shrink-0 text-primary"
                  aria-hidden
                />
              ) : null}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
