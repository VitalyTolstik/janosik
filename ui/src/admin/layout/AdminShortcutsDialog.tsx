import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAdminT } from "../admin-i18n";

const SHORTCUTS: Array<{
  keys: string;
  labelKey: Parameters<ReturnType<typeof useAdminT>>[0];
}> = [
  { keys: "⌘K / Ctrl K", labelKey: "admin.shortcuts.palette" },
  { keys: "⌘B / Ctrl B", labelKey: "admin.shortcuts.sidebar" },
  { keys: "g d / u / b / m / a / c / s / ,", labelKey: "admin.shortcuts.hubs" },
  { keys: "Enter", labelKey: "admin.shortcuts.enter" },
  { keys: "Esc", labelKey: "admin.shortcuts.escape" },
  { keys: "?", labelKey: "admin.shortcuts.help" },
];

export function AdminShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useAdminT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="admin-shortcuts-dialog">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {t("admin.shortcuts.title")}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t("admin.shortcuts.hubsHint")}
          </DialogDescription>
        </DialogHeader>
        <dl className="divide-y divide-border/60 text-xs">
          {SHORTCUTS.map((shortcut) => (
            <div
              key={shortcut.keys}
              className="flex items-center justify-between gap-4 py-2"
            >
              <dt className="text-muted-foreground">{t(shortcut.labelKey)}</dt>
              <dd>
                <kbd className="rounded border border-border bg-hover/50 px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                  {shortcut.keys}
                </kbd>
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
