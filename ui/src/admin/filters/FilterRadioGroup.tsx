import { useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export function FilterRadioGroup({
  label,
  options,
  selected,
  onSelect,
  segmented = false,
}: {
  label: string;
  options: readonly string[];
  selected: number;
  onSelect: (index: number) => void;
  segmented?: boolean;
}) {
  const [focused, setFocused] = useState(selected);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = options.length - 1;
    const next = {
      ArrowDown: focused === last ? 0 : focused + 1,
      ArrowRight: focused === last ? 0 : focused + 1,
      ArrowUp: focused === 0 ? last : focused - 1,
      ArrowLeft: focused === 0 ? last : focused - 1,
      Home: 0,
      End: last,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    event.currentTarget.querySelectorAll("button")[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(segmented && "mb-2 flex rounded-md border p-1")}
      onKeyDown={onKeyDown}
    >
      {options.map((option, index) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={index === selected}
          tabIndex={index === focused ? 0 : -1}
          autoFocus={!segmented && index === selected}
          onFocus={() => setFocused(index)}
          onClick={() => onSelect(index)}
          className={cn(
            "flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-start text-sm hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:min-h-8",
            segmented && "justify-center aria-checked:bg-primary/10",
          )}
        >
          {!segmented ? (
            <span
              aria-hidden
              className={cn(
                "size-4 shrink-0 rounded-full border border-muted-foreground",
                index === selected && "border-[5px] border-primary",
              )}
            />
          ) : null}
          {option}
        </button>
      ))}
    </div>
  );
}
