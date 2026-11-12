import { useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";

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
 * on dark dialogs. This keeps the same trigger footprint and exposes the
 * options as a keyboard-reachable radio list, like the other pickers in the
 * app. The option test ids are `<testId>-option-<value>`.
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
  const selected = options.find((option) => option.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
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
        className="max-h-64 overflow-y-auto p-1"
        style={{ width: "var(--radix-popover-trigger-width)" }}
      >
        <div role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              data-testid={`${testId}-option-${option.value}`}
              onClick={() => {
                setOpen(false);
                onChange(option.value);
              }}
              className={cn(
                "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-hover",
                option.value === value
                  ? "font-medium text-foreground"
                  : "text-foreground/90",
              )}
            >
              {option.label}
              {option.value === value && (
                <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
              )}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
