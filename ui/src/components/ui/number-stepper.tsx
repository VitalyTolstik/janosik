import { ChevronDown, ChevronUp } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { clamp } from "@janosik/shared";

/**
 * The app's canonical numeric field: a text input plus themed chevron
 * steppers on the right (TASK-13 pattern). The native `type="number"`
 * spinners are browser chrome and render dark-on-dark in the dark theme, so
 * every numeric field in the app uses this instead. Digits only; `ArrowUp`/
 * `ArrowDown` step within `[min, max]`; stepping from an empty field starts
 * at `min`.
 */
export function NumberStepper({
  value,
  onChange,
  min = 1,
  max,
  maxLength,
  placeholder,
  ariaLabel,
  increaseLabel,
  decreaseLabel,
  autoFocus,
  disabled,
  id,
  name,
  testId,
  className,
  onEnter,
  onEscape,
}: {
  value: string;
  onChange: (value: string) => void;
  min?: number;
  max?: number;
  maxLength?: number;
  placeholder?: string;
  ariaLabel?: string;
  increaseLabel: string;
  decreaseLabel: string;
  autoFocus?: boolean;
  disabled?: boolean;
  id?: string;
  name?: string;
  testId?: string;
  className?: string;
  onEnter?: () => void;
  onEscape?: () => void;
}) {
  const step = (delta: number) => {
    const current = value.trim() ? Number.parseInt(value, 10) : 0;
    const next = clamp(current + delta, min, max ?? Number.POSITIVE_INFINITY);
    onChange(String(next));
  };

  const stepButtonClass =
    "flex flex-1 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";

  return (
    <div className={cn("relative", className)}>
      <Input
        id={id}
        name={name}
        data-testid={testId}
        autoFocus={autoFocus}
        disabled={disabled}
        type="text"
        inputMode="numeric"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, ""))}
        onKeyDown={(event) => {
          if (event.key === "Enter") onEnter?.();
          if (event.key === "Escape") onEscape?.();
          if (event.key === "ArrowUp") {
            event.preventDefault();
            step(1);
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            step(-1);
          }
        }}
        onFocus={(event) => event.target.select()}
        className="pr-10"
      />
      <div className="absolute inset-y-1 right-1 flex w-7 flex-col overflow-hidden rounded-sm border border-input bg-muted/50">
        <button
          type="button"
          tabIndex={-1}
          aria-label={increaseLabel}
          disabled={disabled}
          onClick={() => step(1)}
          className={stepButtonClass}
        >
          <ChevronUp className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label={decreaseLabel}
          disabled={disabled}
          onClick={() => step(-1)}
          className={stepButtonClass}
        >
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
