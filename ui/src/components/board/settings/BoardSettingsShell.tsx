import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { X, type LucideIcon } from "lucide-react";

import { ConfirmDialog } from "@/components/board/ConfirmDialog";
import { restoreBoardSettingsFocus } from "@/components/board/settings/focus";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { useMediaQuery } from "@/hooks/use-media-query";

export type BoardSettingsSectionId = "workflow" | "agents";

export interface BoardSettingsRailItem {
  id: BoardSettingsSectionId;
  label: string;
  icon: LucideIcon;
  badge?: ReactNode;
}

export interface BoardSettingsShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle: string;
  sections: readonly BoardSettingsRailItem[];
  section: BoardSettingsSectionId;
  onSectionChange: (section: BoardSettingsSectionId) => void;
  /** Dirty state is owned by the dialog so both sections share one guard. */
  dirty: boolean;
  saving?: boolean;
  discardTitle: string;
  discardDescription: string;
  discardConfirmLabel: string;
  closeTestId?: string;
  children: ReactNode;
}

/**
 * TASK-179.6 — the Board Settings surface shared by Workflow and Agents &
 * automation. The shell owns the dialog frame, the top-level rail, the
 * combined dirty guard and focus return; each section owns its body, its
 * single scroll container and its sticky footer.
 */
export function BoardSettingsShell({
  open,
  onOpenChange,
  title,
  subtitle,
  sections,
  section,
  onSectionChange,
  dirty,
  saving = false,
  discardTitle,
  discardDescription,
  discardConfirmLabel,
  closeTestId = "workflow-close",
  children,
}: BoardSettingsShellProps) {
  const { t } = useI18n();
  const verticalRail = useMediaQuery("(min-width: 768px)");
  const [confirmClose, setConfirmClose] = useState(false);
  const tabRefs = useRef<
    Partial<Record<BoardSettingsSectionId, HTMLButtonElement | null>>
  >({});

  const closeDialog = () => {
    onOpenChange(false);
    restoreBoardSettingsFocus();
  };

  const requestOpenChange = (next: boolean) => {
    if (!next && dirty) {
      setConfirmClose(true);
      return;
    }
    if (next) onOpenChange(true);
    else closeDialog();
  };

  const statusText = saving
    ? t("board.settings.shell.saving")
    : dirty
      ? t("board.settings.shell.unsaved")
      : t("board.settings.shell.saved");
  const statusTone = saving
    ? "bg-primary"
    : dirty
      ? "bg-warning"
      : "bg-success";

  const moveSection = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const keys = [
      "ArrowDown",
      "ArrowRight",
      "ArrowUp",
      "ArrowLeft",
      "Home",
      "End",
    ];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const last = sections.length - 1;
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? last
          : event.key === "ArrowDown" || event.key === "ArrowRight"
            ? (index + 1) % sections.length
            : (index - 1 + sections.length) % sections.length;
    const next = sections[nextIndex];
    if (next === undefined) return;
    onSectionChange(next.id);
    tabRefs.current[next.id]?.focus();
  };

  return (
    <Dialog open={open} onOpenChange={requestOpenChange}>
      <DialogContent
        hideClose
        className={cn(
          "h-[min(47.25rem,calc(100dvh-4.75rem))] max-h-[calc(100dvh-4.75rem)] w-[calc(100vw-2rem)] max-w-[1040px] gap-0 overflow-hidden rounded-[11px]! p-0 font-agent-surface shadow-[0_28px_80px_-36px_rgba(15,23,42,0.28),0_2px_8px_rgba(15,23,42,0.06)]! dark:shadow-[0_28px_80px_-32px_rgba(0,0,0,0.78),0_2px_8px_rgba(0,0,0,0.22)]! md:top-[56px] md:bottom-auto",
          "max-md:m-0 max-md:h-[100dvh] max-md:max-h-none max-md:w-full max-md:max-w-none max-md:rounded-none! max-md:border-0! max-md:pb-[env(safe-area-inset-bottom)]",
        )}
        data-testid="board-settings-dialog"
      >
        <header className="relative flex shrink-0 items-center gap-3 border-b border-border pb-3 pl-4 pr-3.5 pt-3.5 max-md:flex-wrap max-md:px-2.5 max-md:pb-2 max-md:pt-2.5 max-md:pr-[58px]">
          <div className="min-w-0 flex-1">
            <p className="m-0 mb-0.5 text-[11px] font-[650] uppercase leading-[1.4] tracking-[0.08em] text-muted-foreground">
              {t("board.settings.title")}
            </p>
            <DialogTitle className="m-0 font-agent-display text-[17px] font-bold leading-[1.25] tracking-[-0.025em] max-md:text-base">
              {title}
            </DialogTitle>
            <DialogDescription className="m-0 mt-0.5 text-[11px] leading-[1.45] text-muted-foreground">
              {subtitle}
            </DialogDescription>
          </div>
          <span
            className="hidden items-center gap-[5px] whitespace-nowrap text-[11px] text-muted-foreground min-[720px]:inline-flex"
            data-testid="board-settings-save-state"
          >
            <span
              aria-hidden
              className={cn(
                "h-[5px] w-[5px] shrink-0 rounded-full",
                statusTone,
                !saving &&
                  (dirty
                    ? "shadow-[0_0_0_2.5px_color-mix(in_oklab,var(--warning)_14%,transparent)]"
                    : "shadow-[0_0_0_2.5px_color-mix(in_oklab,var(--success)_14%,transparent)]"),
              )}
            />
            <span aria-live="polite">{statusText}</span>
          </span>
          <button
            type="button"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-transparent text-muted-foreground hover:border-border hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:absolute max-md:right-2 max-md:top-2 max-md:z-[3] max-md:h-11 max-md:w-11 max-md:bg-popover"
            aria-label={t("common.close")}
            data-testid={closeTestId}
            onClick={() => requestOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div
          className="flex min-h-0 flex-1 flex-col md:flex-row"
          data-testid="board-settings-body"
        >
          <aside
            className="shrink-0 border-b border-border bg-[color-mix(in_oklab,var(--background)_22%,var(--popover))] p-2 md:flex md:w-[194px] md:flex-col md:border-b-0 md:border-r md:p-[12px_9px]"
            data-testid="board-settings-rail"
          >
            <p className="hidden px-2 pb-[7px] text-[11px] font-[650] uppercase tracking-[0.08em] text-muted-foreground md:block">
              {t("board.settings.shell.settings")}
            </p>
            <nav
              aria-label={t("board.settings.title")}
              className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible"
              role="tablist"
              aria-orientation={verticalRail ? "vertical" : "horizontal"}
            >
              {sections.map((entry, index) => {
                const Icon = entry.icon;
                const active = section === entry.id;
                return (
                  <button
                    key={entry.id}
                    ref={(element) => {
                      tabRefs.current[entry.id] = element;
                    }}
                    type="button"
                    role="tab"
                    id={`board-settings-tab-${entry.id}`}
                    aria-selected={active}
                    aria-controls={`board-settings-panel-${entry.id}`}
                    tabIndex={active ? 0 : -1}
                    onClick={() => onSectionChange(entry.id)}
                    onKeyDown={(event) => moveSection(event, index)}
                    data-testid={`board-settings-${entry.id}`}
                    className={cn(
                      "flex min-h-11 w-auto shrink-0 items-center gap-2 whitespace-nowrap rounded-[6px] border border-transparent px-2 text-left text-[12px] font-[550] leading-[1.45] text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none md:min-h-[38px] md:w-full md:whitespace-normal",
                      active &&
                        "border-border bg-popover text-foreground shadow-[inset_2px_0_0_var(--primary)]",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                    {entry.label}
                    {entry.badge ? (
                      <span className="ml-auto inline-flex h-[17px] min-w-[17px] shrink-0 items-center justify-center rounded-full bg-warning px-1 text-[11px] font-extrabold leading-none tabular-nums text-[#1b1305] shadow-[0_0_0_1px_color-mix(in_oklab,var(--warning)_20%,transparent)]">
                        {entry.badge}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </nav>
            <p className="mt-4 hidden border-t border-border px-2 pt-2.5 text-[11px] leading-[1.55] text-muted-foreground md:block">
              <b className="mb-0.5 block text-[11px] font-semibold text-foreground">
                {t("board.settings.shell.noteTitle")}
              </b>
              {t("board.settings.shell.hint")}
            </p>
          </aside>
          <div
            className="min-h-0 min-w-0 flex-1 overflow-hidden bg-popover"
            data-testid="board-settings-content"
          >
            {children}
          </div>
        </div>
      </DialogContent>

      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title={discardTitle}
        description={discardDescription}
        confirmLabel={discardConfirmLabel}
        destructive
        onConfirm={() => {
          setConfirmClose(false);
          closeDialog();
        }}
      />
    </Dialog>
  );
}
