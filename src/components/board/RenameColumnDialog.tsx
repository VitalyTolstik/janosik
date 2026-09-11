import { useEffect, useState } from "react";

import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import {
        Dialog,
        DialogContent,
        DialogFooter,
        DialogHeader,
        DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { LIMITS } from "@/types/kanban";
import { LimitCounter } from "@/components/ui/limit-counter";

interface RenameColumnDialogProps {
        open: boolean;
        initialTitle: string;
        onOpenChange: (open: boolean) => void;
        onSave: (title: string) => void;
}

/**
 * Rename dialog for a column: a single inline text input, commit on Save or
 * Enter, cancel on Escape.
 */
export function RenameColumnDialog({
        open,
        initialTitle,
        onOpenChange,
        onSave,
}: RenameColumnDialogProps) {
        const { t } = useI18n();
        const [title, setTitle] = useState(initialTitle);

        // Reset the draft whenever the dialog (re)opens with a new value.
        useEffect(() => {
                if (open) setTitle(initialTitle);
        }, [open, initialTitle]);

        const handleSave = () => {
                const trimmed = title.trim();
                if (trimmed) onSave(trimmed);
                onOpenChange(false);
        };

        return (
                <Dialog open={open} onOpenChange={onOpenChange}>
                        <DialogContent className="sm:max-w-sm">
                                <DialogHeader>
                                        <DialogTitle>
                                                {t("column.renameDialogTitle")}
                                        </DialogTitle>
                                </DialogHeader>
                                <Input
                                        autoFocus
                                        value={title}
                                        maxLength={LIMITS.columnTitle}
                                        onChange={(e) =>
                                                setTitle(e.target.value)
                                        }
                                        onKeyDown={(e) => {
                                                if (e.key === "Enter")
                                                        handleSave();
                                                if (e.key === "Escape")
                                                        onOpenChange(false);
                                        }}
                                        onFocus={(e) => e.target.select()}
                                        aria-describedby="column-rename-limit"
                                        placeholder={t(
                                                "column.renamePlaceholder",
                                        )}
                                />
                                <LimitCounter
                                        id="column-rename-limit"
                                        length={title.length}
                                        limit={LIMITS.columnTitle}
                                        testId="column-rename-limit"
                                />
                                <DialogFooter className="mt-2">
                                        <Button
                                                variant="outline"
                                                onClick={() =>
                                                        onOpenChange(false)
                                                }
                                        >
                                                {t("common.cancel")}
                                        </Button>
                                        <Button onClick={handleSave}>
                                                {t("common.save")}
                                        </Button>
                                </DialogFooter>
                        </DialogContent>
                </Dialog>
        );
}
