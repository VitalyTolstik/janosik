import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

interface CollapsibleSectionProps {
  /** Visible section title; also the accessible name of the toggle. */
  title: string;
  /** Jira-style count pill next to the title (hidden while undefined). */
  badge?: ReactNode;
  /** Sections that carry the reading flow start open (activity starts closed). */
  defaultExpanded?: boolean;
  /** Controlled open state; omit for uncontrolled with `defaultExpanded`. */
  expanded?: boolean;
  /** Notified on every toggle — lets a parent expand before adding content. */
  onExpandedChange?: (expanded: boolean) => void;
  /** Right-aligned header control (e.g. "Add checklist"), always visible. */
  action?: ReactNode;
  testId?: string;
  /** Extra classes for the content wrapper (border, padding, gap). */
  contentClassName?: string;
  children: ReactNode;
}

/**
 * One collapsible block of the card dialog (TASK-44): a title row with a
 * rotating chevron, an optional count pill and an optional trailing action.
 * Every expandable card section (description, checklists, activity) uses
 * this header so opening a card reads as one system, not three.
 *
 * The expanded flag is plain local state: the dialog remounts per card
 * (AGENT.md: reset by remount), so the next card always opens with defaults.
 */
export function CollapsibleSection({
  title,
  badge,
  defaultExpanded = true,
  expanded,
  onExpandedChange,
  action,
  testId,
  contentClassName,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultExpanded);
  const isOpen = expanded ?? open;
  const toggle = () => {
    const next = !isOpen;
    setOpen(next);
    onExpandedChange?.(next);
  };

  return (
    <section data-expanded={isOpen}>
      <div className="flex w-full items-center gap-1.5">
        <button
          type="button"
          aria-expanded={isOpen}
          data-testid={testId}
          onClick={toggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "h-3.5 w-3.5 shrink-0 transition-transform",
              isOpen && "rotate-90",
            )}
          />
          <span className="truncate">{title}</span>
          {badge !== undefined ? (
            <span className="shrink-0 rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
              {badge}
            </span>
          ) : null}
        </button>
        {action}
      </div>

      {isOpen ? <div className={contentClassName}>{children}</div> : null}
    </section>
  );
}
