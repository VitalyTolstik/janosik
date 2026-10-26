import { useState } from "react";
import {
  Check,
  Copy,
  Crown,
  KeyRound,
  MoreHorizontal,
  ShieldOff,
  ShieldCheck,
  Trash2,
  Unlock,
  UserPlus,
} from "lucide-react";
import type { AdminMasterRowDto } from "@janosik/shared";
import { formatDate, useHour12, useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/Toast";
import { ApiError } from "@/api/client";
import { adminApi } from "./admin-client";
import { useAdminT } from "./admin-i18n";
import { useAdminAuth } from "./AdminAuthContext";
import { useAdminList } from "./use-admin-list";
import { TextCell } from "./cells";
import { fieldError, isValid } from "./validation";
import { Input } from "@/components/ui/input";
import {
  Badge,
  CharCount,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  IdChip,
  LoadingState,
  PageHeader,
  Panel,
  Table,
  Td,
  Th,
} from "./ui";

/**
 * Masters (TASK-36) — owner-only. An owner mints operator accounts here
 * instead of using the server CLI; operators never see this page and the
 * server answers 403 to their management calls regardless of the UI.
 */

type PendingAction =
  | { kind: "disable"; master: AdminMasterRowDto }
  | { kind: "enable"; master: AdminMasterRowDto }
  | { kind: "unlock"; master: AdminMasterRowDto }
  | { kind: "reset"; master: AdminMasterRowDto }
  | { kind: "sessions"; master: AdminMasterRowDto }
  | { kind: "remove"; master: AdminMasterRowDto }
  | null;

function OneTimePassword({
  title,
  email,
  password,
  onDone,
}: {
  title: string;
  email: string;
  password: string;
  onDone: () => void;
}) {
  const t = useAdminT();
  const [copied, setCopied] = useState(false);
  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-sm">{title}</DialogTitle>
        <DialogDescription className="text-xs">{email}</DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {t("admin.masters.created.passwordOnce")}
        </p>
        <div className="flex items-center gap-2">
          <code
            data-testid="admin-master-password"
            className="flex-1 overflow-x-auto rounded-lg border border-border bg-background/70 px-3 py-2 font-mono text-xs text-foreground"
          >
            {password}
          </code>
          <Button
            size="icon"
            variant="outline"
            aria-label={t("admin.common.copy")}
            onClick={() => {
              void navigator.clipboard
                ?.writeText(password)
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
        <Button size="sm" onClick={onDone} data-testid="admin-master-done">
          {t("admin.masters.created.done")}
        </Button>
      </DialogFooter>
    </>
  );
}

function CreateMasterDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useAdminT();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [owner, setOwner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{
    email: string;
    password: string;
  } | null>(null);

  const emailError = fieldError(t, email, { required: true, email: true });
  const nameError = fieldError(t, displayName, { max: 50 });
  const valid =
    isValid(t, email, { required: true, email: true }) &&
    isValid(t, displayName, { max: 50 });

  const reset = () => {
    setEmail("");
    setDisplayName("");
    setOwner(false);
    setError(null);
    setRevealed(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await adminApi.createMaster({
        email: email.trim(),
        displayName: displayName.trim() || undefined,
        role: owner ? "OWNER" : "OPERATOR",
      });
      toast.success(
        t("admin.masters.toast.created", { email: response.admin.email }),
      );
      onCreated();
      setRevealed({
        email: response.admin.email,
        password: response.temporaryPassword,
      });
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setError(t("admin.masters.exists"));
      } else if (cause instanceof ApiError && cause.status === 403) {
        setError(t("admin.masters.forbidden"));
      } else {
        setError(t("admin.common.error"));
      }
    } finally {
      setBusy(false);
    }
  };

  const closeAll = () => {
    onClose();
    reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? undefined : closeAll())}
    >
      <DialogContent className="max-w-sm">
        {revealed ? (
          <OneTimePassword
            title={t("admin.masters.created.title")}
            email={revealed.email}
            password={revealed.password}
            onDone={closeAll}
          />
        ) : (
          <form onSubmit={(event) => void submit(event)} className="space-y-3">
            <DialogHeader>
              <DialogTitle className="text-sm">
                {t("admin.masters.create.title")}
              </DialogTitle>
            </DialogHeader>
            <Field
              label={t("admin.masters.create.email")}
              error={email.trim() === "" ? null : emailError}
            >
              <Input
                type="email"
                autoComplete="email"
                value={email}
                invalid={email.trim() !== "" && emailError !== null}
                onChange={(event) => setEmail(event.target.value)}
                data-testid="admin-master-email"
              />
            </Field>
            <Field
              label={t("admin.masters.create.name")}
              error={displayName.trim() === "" ? null : nameError}
              counter={<CharCount value={displayName} max={50} />}
            >
              <Input
                value={displayName}
                maxLength={50}
                invalid={nameError !== null}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </Field>
            <div className="flex items-start gap-2 rounded-lg border border-border bg-background/40 px-3 py-2">
              <Checkbox
                checked={owner}
                onCheckedChange={setOwner}
                aria-label={t("admin.masters.create.owner")}
                data-testid="admin-master-owner"
                className="mt-0.5"
              />
              <button
                type="button"
                onClick={() => setOwner(!owner)}
                className="space-y-0.5 text-left"
              >
                <span className="block text-xs font-medium text-foreground">
                  {t("admin.masters.create.owner")}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  {t("admin.masters.create.ownerHint")}
                </span>
              </button>
            </div>
            {error ? (
              <p role="alert" className="text-xs text-danger">
                {error}
              </p>
            ) : null}
            <DialogFooter className="gap-2">
              <Button
                size="sm"
                variant="outline"
                type="button"
                onClick={closeAll}
              >
                {t("admin.common.cancel")}
              </Button>
              <Button
                size="sm"
                type="submit"
                disabled={busy || !valid}
                data-testid="admin-master-submit"
              >
                {t("admin.masters.create.submit")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function MastersPage() {
  const t = useAdminT();
  const { lang } = useI18n();
  const hour12 = useHour12();
  const toast = useToast();
  const { admin: current } = useAdminAuth();

  const list = useAdminList<AdminMasterRowDto>(() => adminApi.listMasters());
  const [pending, setPending] = useState<PendingAction>(null);
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<{
    email: string;
    password: string;
  } | null>(null);

  const run = async (action: PendingAction) => {
    if (action === null) return;
    try {
      if (action.kind === "disable" || action.kind === "enable") {
        const disabled = action.kind === "disable";
        await adminApi.updateMaster(action.master.id, { disabled });
        toast.success(
          disabled
            ? t("admin.masters.toast.disabled", { email: action.master.email })
            : t("admin.masters.toast.enabled", { email: action.master.email }),
        );
      } else if (action.kind === "unlock") {
        await adminApi.updateMaster(action.master.id, { unlock: true });
        toast.success(
          t("admin.masters.toast.unlocked", { email: action.master.email }),
        );
      } else if (action.kind === "reset") {
        const response = await adminApi.resetMasterPassword(action.master.id);
        toast.success(
          t("admin.masters.toast.passwordReset", {
            email: action.master.email,
          }),
        );
        setRevealed({
          email: response.admin.email,
          password: response.temporaryPassword,
        });
      } else if (action.kind === "remove") {
        await adminApi.demoteMaster(action.master.id);
        toast.success(
          t("admin.masters.toast.removed", { email: action.master.email }),
        );
      } else {
        const response = await adminApi.revokeMasterSessions(action.master.id);
        toast.success(
          t("admin.masters.toast.sessionsRevoked", {
            count: response.revoked,
          }),
        );
      }
      list.reload();
    } catch {
      toast.error(t("admin.common.error"));
    } finally {
      setPending(null);
    }
  };

  const confirmText = (action: PendingAction) => {
    if (action === null) return { title: "", body: "", label: "" };
    const email = action.master.email;
    if (action.kind === "disable") {
      return {
        title: t("admin.masters.confirm.disable.title", { email }),
        body: t("admin.masters.confirm.disable.body"),
        label: t("admin.masters.action.disable"),
      };
    }
    if (action.kind === "enable") {
      return {
        title: t("admin.masters.confirm.enable.title", { email }),
        body: t("admin.masters.confirm.enable.body"),
        label: t("admin.masters.action.enable"),
      };
    }
    if (action.kind === "unlock") {
      return {
        title: t("admin.masters.confirm.unlock.title", { email }),
        body: t("admin.masters.confirm.unlock.body"),
        label: t("admin.masters.action.unlock"),
      };
    }
    if (action.kind === "reset") {
      return {
        title: t("admin.masters.confirm.reset.title", { email }),
        body: t("admin.masters.confirm.reset.body"),
        label: t("admin.masters.action.resetPassword"),
      };
    }
    if (action.kind === "remove") {
      return {
        title: t("admin.masters.confirm.remove.title", { email }),
        body: t("admin.masters.confirm.remove.body"),
        label: t("admin.masters.action.remove"),
      };
    }
    return {
      title: t("admin.masters.confirm.sessions.title", { email }),
      body: t("admin.masters.confirm.sessions.body"),
      label: t("admin.masters.action.revokeSessions"),
    };
  };

  const statusBadge = (master: AdminMasterRowDto) => {
    if (master.disabledAt !== null) {
      return (
        <Badge variant="danger">{t("admin.masters.status.disabled")}</Badge>
      );
    }
    if (master.lockedUntil !== null) {
      return (
        <Badge variant="warning">{t("admin.masters.status.locked")}</Badge>
      );
    }
    return <Badge variant="success">{t("admin.masters.status.active")}</Badge>;
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <PageHeader
        title={t("admin.masters.title")}
        subtitle={t("admin.masters.subtitle")}
        actions={
          <Button
            size="sm"
            onClick={() => setCreating(true)}
            data-testid="admin-create-master"
          >
            <UserPlus className="h-3.5 w-3.5" aria-hidden />
            {t("admin.masters.create")}
          </Button>
        }
      />

      <Panel className="flex min-h-0 flex-1 flex-col">
        {list.loading ? (
          <LoadingState />
        ) : list.error ? (
          <ErrorState onRetry={list.reload} />
        ) : list.items.length === 0 ? (
          <EmptyState />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t("admin.masters.column.id")}</Th>
                <Th>{t("admin.masters.column.email")}</Th>
                <Th>{t("admin.masters.column.role")}</Th>
                <Th className="w-28">{t("admin.masters.column.name")}</Th>
                <Th className="w-12 text-right">
                  {t("admin.masters.column.failed")}
                </Th>
                <Th>{t("admin.masters.column.lastLogin")}</Th>
                <Th>{t("admin.masters.column.locked")}</Th>
                <Th>{t("admin.masters.column.status")}</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {list.items.map((master) => (
                <tr
                  key={master.id}
                  className="transition-colors hover:bg-hover/50"
                >
                  <Td>
                    <IdChip id={master.id} />
                  </Td>
                  <Td className="font-medium">{master.email}</Td>
                  <Td>
                    {master.role === "OWNER" ? (
                      <span
                        title={t("admin.masters.ownerBadge")}
                        className="inline-flex items-center gap-0.5 rounded border border-primary/30 bg-primary/10 px-1 py-0.5 text-[10px] text-primary"
                      >
                        <Crown className="h-2.5 w-2.5" aria-hidden />
                        {t("admin.masters.ownerBadge")}
                      </span>
                    ) : (
                      <span className="rounded border border-border bg-hover/60 px-1 py-0.5 text-[10px] text-muted-foreground">
                        {t("admin.masters.operatorBadge")}
                      </span>
                    )}
                  </Td>
                  <Td className="text-muted-foreground">
                    <TextCell value={master.displayName} maxWidth="7rem" />
                  </Td>
                  <Td className="text-right tabular-nums">
                    {master.failedLogins}
                  </Td>
                  <Td className="text-muted-foreground">
                    {master.lastLoginAt === null
                      ? t("admin.common.never")
                      : formatDate(master.lastLoginAt, lang, hour12)}
                  </Td>
                  <Td className="text-muted-foreground">
                    {master.lockedUntil === null
                      ? "—"
                      : formatDate(master.lockedUntil, lang, hour12)}
                  </Td>
                  <Td>{statusBadge(master)}</Td>
                  <Td>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={t("admin.common.actions")}
                          data-testid={`admin-master-menu-${master.email}`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56 text-xs">
                        {master.disabledAt === null ? (
                          <DropdownMenuItem
                            disabled={master.id === current?.id}
                            onSelect={() =>
                              setPending({ kind: "disable", master })
                            }
                            className="text-danger focus:text-danger"
                          >
                            <ShieldOff className="h-3.5 w-3.5" aria-hidden />
                            {t("admin.masters.action.disable")}
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onSelect={() =>
                              setPending({ kind: "enable", master })
                            }
                          >
                            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                            {t("admin.masters.action.enable")}
                          </DropdownMenuItem>
                        )}
                        {master.lockedUntil !== null ? (
                          <DropdownMenuItem
                            data-testid={`admin-master-unlock-${master.email}`}
                            onSelect={() =>
                              setPending({ kind: "unlock", master })
                            }
                          >
                            <Unlock className="h-3.5 w-3.5" aria-hidden />
                            {t("admin.masters.action.unlock")}
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem
                          onSelect={() => setPending({ kind: "reset", master })}
                        >
                          <KeyRound className="h-3.5 w-3.5" aria-hidden />
                          {t("admin.masters.action.resetPassword")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            setPending({ kind: "sessions", master })
                          }
                        >
                          <ShieldOff className="h-3.5 w-3.5" aria-hidden />
                          {t("admin.masters.action.revokeSessions")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={master.id === current?.id}
                          className="text-danger focus:text-danger"
                          data-testid={`admin-master-remove-${master.email}`}
                          onSelect={() =>
                            setPending({ kind: "remove", master })
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          {t("admin.masters.action.remove")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <CreateMasterDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={list.reload}
      />

      <ConfirmDialog
        open={pending !== null}
        title={confirmText(pending).title}
        body={confirmText(pending).body}
        confirmLabel={confirmText(pending).label}
        destructive={
          pending !== null &&
          pending.kind !== "enable" &&
          pending.kind !== "unlock"
        }
        onClose={() => setPending(null)}
        onConfirm={() => void run(pending)}
      />

      <Dialog
        open={revealed !== null}
        onOpenChange={(next) => (next ? undefined : setRevealed(null))}
      >
        <DialogContent className="max-w-sm">
          {revealed ? (
            <OneTimePassword
              title={t("admin.masters.reset.title")}
              email={revealed.email}
              password={revealed.password}
              onDone={() => setRevealed(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
