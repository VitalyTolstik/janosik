import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from "react";

export interface ComboboxOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface UseComboboxOptions {
  options: readonly ComboboxOption[];
  value: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (value: string) => void;
  /** Kept focused while the popover is open, as the ARIA combobox pattern. */
  triggerRef?: RefObject<HTMLButtonElement | null>;
}

const TYPEAHEAD_RESET_MS = 800;

/**
 * TASK-179.9 keyboard model shared by every custom listbox in the agent
 * surfaces (prototype README: Arrow/Home/End/Enter/Space/Escape, Tab closes,
 * first-letter typeahead, `aria-activedescendant`).
 *
 * Focus never enters the portalled popover: the trigger keeps focus and
 * points at the active option with `aria-activedescendant`. That keeps the
 * Dialog focus trap intact and makes Escape close only the listbox.
 */
export function useCombobox({
  options,
  value,
  open,
  onOpenChange,
  onSelect,
  triggerRef,
}: UseComboboxOptions) {
  const listboxId = useId();
  const [activeIndex, setActiveIndex] = useState(-1);
  const optionRefs = useRef(new Map<number, HTMLButtonElement>());
  const typeahead = useRef({ query: "", at: 0 });

  const selectedIndex = options.findIndex((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- opening the popover seeds the active option
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const element = optionRefs.current.get(activeIndex);
    // `scrollIntoView` is absent in jsdom; the guard keeps unit tests honest.
    if (typeof element?.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, open]);

  // Escape belongs to the listbox while it is open, even if the Dialog focus
  // trap moved focus out of the trigger. Capture at the document so the
  // Dialog's own Escape handler never sees an open combobox.
  useEffect(() => {
    if (!open) return;
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
      triggerRef?.current?.focus();
    };
    document.addEventListener("keydown", onEscape, true);
    return () => document.removeEventListener("keydown", onEscape, true);
  }, [onOpenChange, open, triggerRef]);

  const enabledAt = (index: number): boolean =>
    options[index] !== undefined && options[index].disabled !== true;

  const move = (from: number, direction: 1 | -1) => {
    if (options.length === 0) return;
    let index = from;
    for (let step = 0; step < options.length; step += 1) {
      index = (index + direction + options.length) % options.length;
      if (enabledAt(index)) {
        setActiveIndex(index);
        return;
      }
    }
  };

  const moveTo = (start: number, direction: 1 | -1) => {
    if (options.length === 0) return;
    let index = start;
    for (let step = 0; step < options.length; step += 1) {
      if (enabledAt(index)) {
        setActiveIndex(index);
        return;
      }
      index = (index + direction + options.length) % options.length;
    }
  };

  const choose = (index: number) => {
    const option = options[index];
    if (option === undefined || option.disabled === true) return;
    onSelect(option.value);
    onOpenChange(false);
    triggerRef?.current?.focus();
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const key = event.key;

    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
        onOpenChange(true);
        return;
      }
      move(
        activeIndex < 0 ? (key === "ArrowDown" ? -1 : 0) : activeIndex,
        key === "ArrowDown" ? 1 : -1,
      );
      return;
    }

    if (key === "Home" || key === "End") {
      if (!open) return;
      event.preventDefault();
      moveTo(key === "Home" ? 0 : options.length - 1, key === "Home" ? 1 : -1);
      return;
    }

    if (key === "Enter" || key === " ") {
      if (!open) return;
      event.preventDefault();
      choose(activeIndex);
      return;
    }

    if (key === "Escape") {
      if (!open) return;
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
      triggerRef?.current?.focus();
      return;
    }

    if (key === "Tab") {
      if (open) onOpenChange(false);
      return;
    }

    if (
      open &&
      key.length === 1 &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      const now = Date.now();
      const previous =
        now - typeahead.current.at <= TYPEAHEAD_RESET_MS
          ? typeahead.current.query
          : "";
      const query = `${previous}${key}`.toLocaleLowerCase();
      typeahead.current = { query, at: now };
      const start = activeIndex < 0 ? 0 : activeIndex + 1;
      for (let step = 0; step < options.length; step += 1) {
        const index = (start + step) % options.length;
        const option = options[index];
        if (
          option !== undefined &&
          option.disabled !== true &&
          option.label.toLocaleLowerCase().startsWith(query)
        ) {
          event.preventDefault();
          setActiveIndex(index);
          return;
        }
      }
    }
  };

  const getOptionProps = (
    index: number,
    option: ComboboxOption,
  ): {
    id: string;
    role: "option";
    "aria-selected": boolean;
    "data-active"?: "true";
    tabIndex: -1;
    ref: (element: HTMLButtonElement | null) => void;
    onMouseEnter: () => void;
    onMouseDown: (event: MouseEvent<HTMLButtonElement>) => void;
  } => ({
    id: `${listboxId}-option-${index}`,
    role: "option",
    "aria-selected": option.value === value,
    ...(index === activeIndex ? { "data-active": "true" as const } : {}),
    tabIndex: -1,
    ref: (element) => {
      if (element === null) optionRefs.current.delete(index);
      else optionRefs.current.set(index, element);
    },
    onMouseEnter: () => setActiveIndex(index),
    // Keep focus on the trigger so the Dialog focus trap never sees a
    // portalled element as "outside".
    onMouseDown: (event) => event.preventDefault(),
  });

  return {
    listboxId,
    activeIndex,
    activeOptionId:
      open && activeIndex >= 0
        ? `${listboxId}-option-${activeIndex}`
        : undefined,
    triggerProps: {
      role: "combobox" as const,
      "aria-haspopup": "listbox" as const,
      "aria-expanded": open,
      "aria-controls": open ? listboxId : undefined,
      "aria-activedescendant":
        open && activeIndex >= 0
          ? `${listboxId}-option-${activeIndex}`
          : undefined,
      "aria-autocomplete": "list" as const,
      onKeyDownCapture: onTriggerKeyDown,
    },
    listboxProps: {
      id: listboxId,
      role: "listbox" as const,
    },
    getOptionProps,
    choose,
  };
}
