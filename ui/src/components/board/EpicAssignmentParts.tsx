import { useId, useState, type FormEvent } from "react";
import { LIMITS } from "@janosik/shared";

import { EPIC_THEME } from "@/components/board/epic-theme";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import type { BacklogEpic } from "@/utils/backlog-rows";

export function EpicDot() {
  return (
    <span
      aria-hidden
      style={EPIC_THEME}
      className="size-2 shrink-0 rounded-full bg-(--epic-accent)"
    />
  );
}

export function EpicOption({ entry }: { entry: BacklogEpic }) {
  const { t } = useI18n();
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2" style={EPIC_THEME}>
      <EpicDot />
      <span className="min-w-0 flex-1 truncate" title={entry.epic.title}>
        {entry.epic.title}
      </span>
      <span
        aria-label={t("epic.progress", {
          done: entry.done,
          total: entry.total,
        })}
        className="flex shrink-0 items-center gap-1.5 text-ui-meta tabular-nums text-muted-foreground"
      >
        <span
          aria-hidden
          className="h-1 w-6 overflow-hidden rounded-full bg-(--epic-track)"
        >
          <span
            className="block h-full bg-(--epic-accent)"
            style={{
              width: `${entry.total ? (100 * entry.done) / entry.total : 0}%`,
            }}
          />
        </span>
        {entry.done}/{entry.total}
      </span>
    </span>
  );
}

export function EpicTitleForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (title: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const [title, setTitle] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (title.trim()) onSubmit(title.trim());
  };

  return (
    <form noValidate onSubmit={submit} className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className="text-ui-label font-medium">
        {t("epic.title")}
      </label>
      <Input
        id={id}
        autoFocus
        data-testid="epic-title-input"
        className="max-lg:h-11"
        value={title}
        maxLength={LIMITS.epicTitle}
        onChange={(event) => setTitle(event.target.value)}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="max-lg:h-11"
          onClick={onCancel}
        >
          {t("common.cancel")}
        </Button>
        <Button
          type="submit"
          size="sm"
          className="max-lg:h-11"
          disabled={!title.trim()}
        >
          {t("epic.createAndAssign")}
        </Button>
      </div>
    </form>
  );
}

export function NewAssignmentEpicDialog({
  onSubmit,
  onClose,
  returnFocus,
}: {
  onSubmit: (title: string) => void;
  onClose: () => void;
  returnFocus: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="rounded-xl"
        aria-describedby={undefined}
        closeClassName="max-lg:h-11 max-lg:w-11"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
      >
        <DialogTitle>{t("epic.newTitle")}</DialogTitle>
        <EpicTitleForm onSubmit={onSubmit} onCancel={onClose} />
      </DialogContent>
    </Dialog>
  );
}
