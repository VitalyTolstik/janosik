import { useState } from "react";
import { Check, Copy, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/Toast";
import { ApiError } from "@/api/client";
import { adminApi } from "./admin-client";
import { useAdminT } from "./admin-i18n";

/**
 * Creation dialogs for the generic entity pages (TASK-48): users (with the
 * one-time generated password) and boards (with an owner email). The server
 * re-validates everything and writes the audit trail.
 */

export function CreateUserButton({ reload }: { reload: () => void }) {
  const t = useAdminT();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [temporary, setTemporary] = useState<{
    email: string;
    password: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const reset = () => {
    setEmail("");
    setDisplayName("");
    setPassword("");
    setError(null);
    setTemporary(null);
    setCopied(false);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await adminApi.createUser({
        email: email.trim(),
        displayName: displayName.trim() || undefined,
        password: password === "" ? undefined : password,
      });
      toast.success(
        t("admin.users.toast.created", { email: response.user.email }),
      );
      reload();
      if (response.temporaryPassword !== null) {
        setTemporary({
          email: response.user.email,
          password: response.temporaryPassword,
        });
      } else {
        setOpen(false);
        reset();
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setError("Email is already registered");
      } else if (cause instanceof ApiError && cause.messageText) {
        setError(cause.messageText);
      } else {
        setError(t("admin.common.error"));
      }
    } finally {
      setBusy(false);
    }
  };

  const closeAll = () => {
    setOpen(false);
    reset();
  };

  return (
    <>
      <Button
        size="sm"
        data-testid="admin-create-user"
        onClick={() => setOpen(true)}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        {t("admin.users.create")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => (next ? undefined : closeAll())}
      >
        <DialogContent className="max-w-sm">
          {temporary ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-sm">
                  {t("admin.users.created.title")}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {temporary.email}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t("admin.users.created.passwordOnce")}
                </p>
                <div className="flex items-center gap-2">
                  <code
                    data-testid="admin-created-password"
                    className="flex-1 overflow-x-auto rounded-lg border border-border bg-background/70 px-3 py-2 font-mono text-xs text-foreground"
                  >
                    {temporary.password}
                  </code>
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label={t("admin.common.copy")}
                    onClick={() => {
                      void navigator.clipboard
                        ?.writeText(temporary.password)
                        .then(() => setCopied(true))
                        .catch(() => setCopied(false));
                    }}
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-success" aria-hidden />
                    ) : (
                      <Copy className="h-4 w-4" aria-hidden />
                    )}
                  </Button>
                </div>
              </div>
              <DialogFooter>
                <Button size="sm" onClick={closeAll}>
                  {t("admin.users.created.done")}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <form
              onSubmit={(event) => void submit(event)}
              className="space-y-3"
            >
              <DialogHeader>
                <DialogTitle className="text-sm">
                  {t("admin.users.create.title")}
                </DialogTitle>
              </DialogHeader>
              <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t("admin.users.create.email")}
                </span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  data-testid="admin-user-email"
                  className="h-8 w-full rounded-lg border border-input bg-background/70 px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t("admin.users.create.name")}
                </span>
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  className="h-8 w-full rounded-lg border border-input bg-background/70 px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t("admin.users.create.password")}
                </span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  data-testid="admin-user-password"
                  className="h-8 w-full rounded-lg border border-input bg-background/70 px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <span className="block text-[11px] text-muted-foreground">
                  {t("admin.users.create.passwordHint")}
                </span>
              </label>
              {error ? (
                <p role="alert" className="text-xs text-danger">
                  {error}
                </p>
              ) : null}
              <DialogFooter className="gap-2">
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={closeAll}
                >
                  {t("admin.common.cancel")}
                </Button>
                <Button
                  size="sm"
                  type="submit"
                  disabled={busy}
                  data-testid="admin-user-submit"
                >
                  {t("admin.users.create.submit")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CreateBoardButton({ reload }: { reload: () => void }) {
  const t = useAdminT();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTitle("");
    setOwnerEmail("");
    setError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const board = await adminApi.createBoard({
        title: title.trim(),
        ownerEmail: ownerEmail.trim(),
      });
      toast.success(t("admin.boards.toast.created", { title: board.title }));
      setOpen(false);
      reset();
      reload();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) {
        setError(t("admin.boards.create.ownerHint"));
      } else if (cause instanceof ApiError && cause.messageText) {
        setError(cause.messageText);
      } else {
        setError(t("admin.common.error"));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        data-testid="admin-create-board"
        onClick={() => setOpen(true)}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        {t("admin.boards.create")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => (next ? undefined : setOpen(false))}
      >
        <DialogContent className="max-w-sm">
          <form onSubmit={(event) => void submit(event)} className="space-y-3">
            <DialogHeader>
              <DialogTitle className="text-sm">
                {t("admin.boards.create.title")}
              </DialogTitle>
            </DialogHeader>
            <label className="block space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("admin.boards.create.titleField")}
              </span>
              <input
                required
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                data-testid="admin-board-title"
                className="h-8 w-full rounded-lg border border-input bg-background/70 px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("admin.boards.create.owner")}
              </span>
              <input
                type="email"
                required
                value={ownerEmail}
                onChange={(event) => setOwnerEmail(event.target.value)}
                data-testid="admin-board-owner"
                className="h-8 w-full rounded-lg border border-input bg-background/70 px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            {error ? (
              <p role="alert" className="text-xs text-danger">
                {error}
              </p>
            ) : null}
            <DialogFooter className="gap-2">
              <Button
                size="sm"
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                {t("admin.common.cancel")}
              </Button>
              <Button
                size="sm"
                type="submit"
                disabled={busy}
                data-testid="admin-board-submit"
              >
                {t("admin.boards.create.submit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
