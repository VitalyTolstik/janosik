import { useState } from "react";
import {
  Check,
  Copy,
  KeyRound,
  MoreHorizontal,
  Plus,
  ShieldOff,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type { AdminUserRowDto } from "@janosik/shared";
import { formatDate, useHour12, useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
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
import { useAdminList } from "./use-admin-list";
import {
  Badge,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FilterTabs,
  IdChip,
  LoadingState,
  PageHeader,
  Pagination,
  Panel,
  SearchInput,
  Table,
  Td,
  Th,
} from "./ui";

/**
 * Users (TASK-36): search, status filter, moderation actions and direct
 * creation with a one-time generated password. Client-side checks are UX
 * only — the server re-validates every action and audits it.
 */

type PendingAction =
  | { kind: "disable"; user: AdminUserRowDto }
  | { kind: "enable"; user: AdminUserRowDto }
  | { kind: "sessions"; user: AdminUserRowDto }
  | { kind: "tokens"; user: AdminUserRowDto }
  | null;

function CreateUserDialog({
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
      onCreated();
      if (response.temporaryPassword !== null) {
        setTemporary({
          email: response.user.email,
          password: response.temporaryPassword,
        });
      } else {
        onClose();
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
    onClose();
    reset();
  };

  return (
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
          <form onSubmit={(event) => void submit(event)} className="space-y-3">
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
                variant="outline"
                type="button"
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
  );
}

export function UsersPage() {
  const t = useAdminT();
  const { lang } = useI18n();
  const hour12 = useHour12();
  const toast = useToast();

  const list = useAdminList<AdminUserRowDto>((params) =>
    adminApi.listUsers(params),
  );
  const [pending, setPending] = useState<PendingAction>(null);
  const [creating, setCreating] = useState(false);

  const run = async (action: PendingAction) => {
    if (action === null) return;
    try {
      if (action.kind === "disable" || action.kind === "enable") {
        const disabled = action.kind === "disable";
        await adminApi.updateUser(action.user.id, { disabled });
        toast.success(
          disabled
            ? t("admin.users.toast.disabled", { email: action.user.email })
            : t("admin.users.toast.enabled", { email: action.user.email }),
        );
      } else if (action.kind === "sessions") {
        const response = await adminApi.revokeUserSessions(action.user.id);
        toast.success(
          t("admin.users.toast.sessionsRevoked", { count: response.revoked }),
        );
      } else {
        const response = await adminApi.revokeUserTokens(action.user.id);
        toast.success(
          t("admin.users.toast.tokensRevoked", { count: response.revoked }),
        );
      }
      list.reload();
    } catch {
      toast.error(t("admin.common.error"));
    } finally {
      setPending(null);
    }
  };

  const confirmText = (
    action: PendingAction,
  ): { title: string; body: string; label: string } => {
    if (action === null) return { title: "", body: "", label: "" };
    const email = action.user.email;
    if (action.kind === "disable") {
      return {
        title: t("admin.users.confirm.disable.title", { email }),
        body: t("admin.users.confirm.disable.body"),
        label: t("admin.users.action.disable"),
      };
    }
    if (action.kind === "enable") {
      return {
        title: t("admin.users.confirm.enable.title", { email }),
        body: t("admin.users.confirm.enable.body"),
        label: t("admin.users.action.enable"),
      };
    }
    if (action.kind === "sessions") {
      return {
        title: t("admin.users.confirm.sessions.title", { email }),
        body: t("admin.users.confirm.sessions.body"),
        label: t("admin.users.action.revokeSessions"),
      };
    }
    return {
      title: t("admin.users.confirm.tokens.title", { email }),
      body: t("admin.users.confirm.tokens.body"),
      label: t("admin.users.action.revokeTokens"),
    };
  };

  return (
    <>
      <PageHeader
        title={t("admin.users.title")}
        subtitle={t("admin.users.subtitle", { total: list.total })}
        actions={
          <Button
            size="sm"
            onClick={() => setCreating(true)}
            data-testid="admin-create-user"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t("admin.users.create")}
          </Button>
        }
      />

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
          <SearchInput value={list.search} onChange={list.setSearch} />
          <FilterTabs
            value={list.status}
            onChange={list.setStatus}
            options={[
              { value: "all", label: t("admin.users.filter.all") },
              { value: "active", label: t("admin.users.filter.active") },
              { value: "disabled", label: t("admin.users.filter.disabled") },
            ]}
          />
        </div>

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
                <Th>{t("admin.common.id")}</Th>
                <Th>{t("admin.users.col.email")}</Th>
                <Th>{t("admin.users.col.name")}</Th>
                <Th className="text-right">{t("admin.users.col.boards")}</Th>
                <Th className="text-right">{t("admin.users.col.sessions")}</Th>
                <Th className="text-right">{t("admin.users.col.tokens")}</Th>
                <Th>{t("admin.users.col.created")}</Th>
                <Th>{t("admin.users.col.status")}</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {list.items.map((user) => (
                <tr
                  key={user.id}
                  className="transition-colors hover:bg-hover/50"
                >
                  <Td>
                    <IdChip id={user.id} />
                  </Td>
                  <Td className="font-medium">{user.email}</Td>
                  <Td className="text-muted-foreground">
                    {user.displayName ?? "—"}
                  </Td>
                  <Td className="text-right tabular-nums">{user.boards}</Td>
                  <Td className="text-right tabular-nums">{user.sessions}</Td>
                  <Td className="text-right tabular-nums">{user.apiTokens}</Td>
                  <Td className="text-muted-foreground">
                    {formatDate(user.createdAt, lang, hour12)}
                  </Td>
                  <Td>
                    {user.disabledAt === null ? (
                      <Badge variant="success">
                        {t("admin.users.status.active")}
                      </Badge>
                    ) : (
                      <Badge variant="danger">
                        {t("admin.users.status.disabled")}
                      </Badge>
                    )}
                  </Td>
                  <Td>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={t("admin.common.actions")}
                          data-testid={`admin-user-menu-${user.email}`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52 text-xs">
                        {user.disabledAt === null ? (
                          <DropdownMenuItem
                            onSelect={() =>
                              setPending({ kind: "disable", user })
                            }
                            className="text-danger focus:text-danger"
                          >
                            <ShieldOff className="h-3.5 w-3.5" aria-hidden />
                            {t("admin.users.action.disable")}
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onSelect={() =>
                              setPending({ kind: "enable", user })
                            }
                          >
                            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                            {t("admin.users.action.enable")}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onSelect={() =>
                            setPending({ kind: "sessions", user })
                          }
                        >
                          <KeyRound className="h-3.5 w-3.5" aria-hidden />
                          {t("admin.users.action.revokeSessions")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => setPending({ kind: "tokens", user })}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          {t("admin.users.action.revokeTokens")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        {list.items.length > 0 ? (
          <Pagination
            total={list.total}
            limit={list.limit}
            offset={list.offset}
            onChange={list.setOffset}
          />
        ) : null}
      </Panel>

      <CreateUserDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={list.reload}
      />

      <ConfirmDialog
        open={pending !== null}
        title={confirmText(pending).title}
        body={confirmText(pending).body}
        confirmLabel={confirmText(pending).label}
        destructive={pending !== null && pending.kind !== "enable"}
        onClose={() => setPending(null)}
        onConfirm={() => void run(pending)}
      />
    </>
  );
}
