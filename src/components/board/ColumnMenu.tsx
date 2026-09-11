import { CopyPlus, EllipsisVertical, Pencil, Trash2 } from "lucide-react";

import { useI18n } from "@/i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ColumnMenuProps {
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

/**
 * Overflow menu on a column header: rename / duplicate / delete. Stops
 * pointer events from bubbling up to the header's drag handle.
 */
export function ColumnMenu({ onRename, onDuplicate, onDelete }: ColumnMenuProps) {
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
