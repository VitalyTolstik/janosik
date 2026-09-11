import { CalendarDays, KanbanSquare, Table2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

/** The three projections of the same board data (TASK-14). */
export type BoardView = "board" | "calendar" | "table";

const VIEWS: {
  id: BoardView;
  icon: typeof KanbanSquare;
  labelKey: "view.board" | "view.calendar" | "view.table";
}[] = [
  { id: "board", icon: KanbanSquare, labelKey: "view.board" },
  { id: "calendar", icon: CalendarDays, labelKey: "view.calendar" },
  { id: "table", icon: Table2, labelKey: "view.table" },
];

interface ViewSwitcherProps {
  value: BoardView;
  onChange: (view: BoardView) => void;
}

/**
 * Segmented control switching how the board is rendered. Every view shows
 * the same (optionally filtered) cards — only the projection changes, so the
 * switcher is safe to keep visible alongside the filter toolbar.
 */
export function ViewSwitcher({ value, onChange }: ViewSwitcherProps) {
  const { t } = useI18n();

  return (
    <div
      role="group"
      aria-label={t("view.label")}
      className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-card/80 p-1 shadow-sm"
    >
      {VIEWS.map(({ id, icon: Icon, labelKey }) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            value === id
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-hover hover:text-foreground",
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {t(labelKey)}
        </button>
      ))}
    </div>
  );
}
