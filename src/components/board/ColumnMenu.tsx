import {
  ArrowDownAZ,
  CalendarClock,
  Clock4,
  CopyPlus,
  EllipsisVertical,
  ArrowDownUp,
  Gauge,
  Pencil,
  Trash2,
} from "lucide-react";

import { useI18n } from "@/i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ColumnSortBy } from "@/store/board-reducer";

interface ColumnMenuProps {
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  /** Fired when a sort criterion is picked (one-shot action). */
  onSort: (sortBy: ColumnSortBy) => void;
  /** Opens the WIP-limit dialog. */
  onSetWipLimit: () => void;
  /** The column's current WIP limit (labels the menu item). */
  wipLimit?: number;
}

const SORT_ITEMS: Array<{ sortBy: ColumnSortBy; icon: typeof Clock4 }> = [
  { sortBy: "createdAt", icon: Clock4 },
  { sortBy: "dueDate", icon: CalendarClock },
  { sortBy: "title", icon: ArrowDownAZ },
];

/**
 * Overflow menu on a column header: rename / duplicate / sort / delete.
 * Sort is a one-shot action (dragging afterwards restores manual order),
 * so the sub-menu uses plain items instead of a checked state. Stops
 * pointer events from bubbling up to the header's drag handle.
 */
export function ColumnMenu({
  onRename,
  onDuplicate,
  onDelete,
  onSort,
  onSetWipLimit,
  wipLimit,
}: ColumnMenuProps) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("column.options")}
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-hover hover:text-foreground"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <EllipsisVertical className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={onRename}>
          <Pencil className="h-4 w-4" />
          {t("column.rename")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onDuplicate}>
          <CopyPlus className="h-4 w-4" />
          {t("column.duplicate")}
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ArrowDownUp className="h-4 w-4" />
            {t("column.sort")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44">
            {SORT_ITEMS.map(({ sortBy, icon: Icon }) => (
              <DropdownMenuItem key={sortBy} onClick={() => onSort(sortBy)}>
                <Icon className="h-4 w-4" />
                {t(`column.sort.${sortBy}`)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onClick={onSetWipLimit}>
          <Gauge className="h-4 w-4" />
          {t("column.wipLimit")}
          {wipLimit !== undefined && (
            <span className="ml-auto text-xs text-muted-foreground">
              {wipLimit}
            </span>
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={onDelete}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
          {t("column.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
