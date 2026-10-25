import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  AtSign,
  Download,
  Eye,
  KanbanSquare,
  KeyRound,
  MailCheck,
  MailX,
  MessageSquare,
  Paperclip,
  Send,
  ShieldCheck,
  ShieldOff,
  Terminal,
  Trash2,
  Users,
} from "lucide-react";
import type {
  AdminActivityRowDto,
  AdminCommandRowDto,
  AdminUserDetailDto,
} from "@janosik/shared";
import { formatDate, useHour12, useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/Toast";
import { ApiError } from "@/api/client";
import { cn } from "@/lib/utils";
import { adminApi } from "./admin-client";
import { useAdminT } from "./admin-i18n";
import {
  ChangeUserEmailDialog,
  DeleteUserDialog,
  PromoteUserDialog,
  ResetUserPasswordDialog,
} from "./dialogs";
import { exportUser, impersonateUser } from "./user-actions";
import {
  DateCell,
  EntityLink,
  IdCell,
  RoleBadge,
  StatusBadge,
  TextCell,
} from "./cells";
import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Panel,
  Table,
  Td,
  Th,
} from "./ui";

/**
 * User detail (TASK-48) — the whole user graph a support agent needs:
 * profile, counters, memberships, cards the user created (derived from the
 * command log), comments, attachments, sessions, tokens and recent events.
 */

type TabKey =
  | "memberships"
  | "cards"
  | "assignedCards"
  | "comments"
  | "attachments"
  | "sessions"
  | "tokens"
  | "commands"
  | "activity";

const cardHref = (id: string) => `/admin/cards/${id}`;
const boardHref = (id: string) => `/admin/boards/${id}`;

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: number;
}) {
  return (
    <Panel className="flex items-center gap-2.5 px-3 py-2.5">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="text-sm font-semibold tabular-nums">{value}</p>
      </div>
    </Panel>
  );
}

export function UserDetailPage() {
  const { userId = "" } = useParams();
  const t = useAdminT();
  const toast = useToast();
  const { lang } = useI18n();
  const hour12 = useHour12();
  const [detail, setDetail] = useState<AdminUserDetailDto | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<TabKey>("memberships");
  const [emailDialog, setEmailDialog] = useState(false);
  const [resetDialog, setResetDialog] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [promoteDialog, setPromoteDialog] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);

  const load = () => {
    setError(false);
    setReloadKey((key) => key + 1);
  };

  useEffect(() => {
    let active = true;
    adminApi
      .userDetail(userId)
      .then((page) => {
        if (active) setDetail(page);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [userId, reloadKey]);

  if (error) {
    return (
      <div className="p-4">
        <ErrorState onRetry={load} />
      </div>
    );
  }
  if (detail === null) {
    return <LoadingState />;
  }

  const { user, counters } = detail;
  const reload = load;

  const run = async (label: string, action: () => Promise<unknown>) => {
    try {
      await action();
      toast.success(label);
      reload();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 403) {
        toast.error(t("admin.common.forbidden"));
      } else {
        toast.error(t("admin.common.actionFailed"));
      }
    }
  };

  const tabs: Array<{ key: TabKey; label: string; count: number }> = [
    {
      key: "memberships",
      label: t("admin.userDetail.tab.memberships"),
      count: detail.memberships.length,
    },
    {
      key: "cards",
      label: t("admin.userDetail.tab.cards"),
      count: detail.createdCards.length,
    },
    {
      key: "assignedCards",
      label: t("admin.userDetail.tab.assignedCards"),
      count: detail.assignedCards.length,
    },
    {
      key: "comments",
      label: t("admin.userDetail.tab.comments"),
      count: detail.comments.length,
    },
    {
      key: "attachments",
      label: t("admin.userDetail.tab.attachments"),
      count: detail.attachments.length,
    },
    {
      key: "sessions",
      label: t("admin.userDetail.tab.sessions"),
      count: detail.sessions.length,
    },
    {
      key: "tokens",
      label: t("admin.userDetail.tab.tokens"),
      count: detail.tokens.length,
    },
    {
      key: "commands",
      label: t("admin.userDetail.tab.commands"),
      count: detail.recentCommands.length,
    },
    {
      key: "activity",
      label: t("admin.userDetail.tab.activity"),
      count: detail.recentActivity.length,
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-center gap-2">
        <Button size="icon" variant="ghost" className="h-7 w-7" asChild>
          <Link to="/admin/users" aria-label={t("admin.common.back")}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
        <PageHeader
          title={user.displayName ?? user.email}
          subtitle={user.email}
          actions={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="admin-user-detail-actions"
                >
                  {t("admin.common.actions")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {user.disabledAt === null ? (
                  <DropdownMenuItem
                    className="text-danger focus:text-danger"
                    onSelect={() =>
                      void run(t("admin.users.action.disable"), () =>
                        adminApi.updateUser(user.id, { disabled: true }),
                      )
                    }
                  >
                    <ShieldOff className="h-3.5 w-3.5" aria-hidden />
                    {t("admin.users.action.disable")}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onSelect={() =>
                      void run(t("admin.users.action.enable"), () =>
                        adminApi.updateUser(user.id, { disabled: false }),
                      )
                    }
                  >
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                    {t("admin.users.action.enable")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onSelect={() => setEmailDialog(true)}
                  data-testid="admin-user-change-email"
                >
                  <AtSign className="h-3.5 w-3.5" aria-hidden />
                  {t("admin.users.action.changeEmail")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-danger focus:text-danger"
                  onSelect={() =>
                    void run(t("admin.users.action.revokeSessions"), () =>
                      adminApi.revokeUserSessions(user.id),
                    )
                  }
                >
                  {t("admin.users.action.revokeSessions")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-danger focus:text-danger"
                  onSelect={() =>
                    void run(t("admin.users.action.revokeTokens"), () =>
                      adminApi.revokeUserTokens(user.id),
                    )
                  }
                >
                  {t("admin.users.action.revokeTokens")}
                </DropdownMenuItem>
                {user.emailVerifiedAt === null ? (
                  <DropdownMenuItem
                    data-testid="admin-user-verify"
                    onSelect={() =>
                      void run(t("admin.userDetail.action.verify"), () =>
                        adminApi
                          .updateUser(user.id, { emailVerified: true })
                          .then(() => undefined),
                      )
                    }
                  >
                    <MailCheck className="h-3.5 w-3.5" aria-hidden />
                    {t("admin.userDetail.action.verify")}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    data-testid="admin-user-unverify"
                    onSelect={() =>
                      void run(t("admin.userDetail.action.unverify"), () =>
                        adminApi
                          .updateUser(user.id, { emailVerified: false })
                          .then(() => undefined),
                      )
                    }
                  >
                    <MailX className="h-3.5 w-3.5" aria-hidden />
                    {t("admin.userDetail.action.unverify")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  data-testid="admin-user-resend"
                  onSelect={() =>
                    void run(t("admin.userDetail.action.resend"), () =>
                      adminApi.resendUserVerification(user.id),
                    )
                  }
                >
                  <Send className="h-3.5 w-3.5" aria-hidden />
                  {t("admin.userDetail.action.resend")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="admin-user-reset-password"
                  onSelect={() => setResetDialog(true)}
                >
                  <KeyRound className="h-3.5 w-3.5" aria-hidden />
                  {t("admin.userDetail.action.resetPassword")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-warning focus:text-warning"
                  data-testid="admin-user-promote"
                  onSelect={() => setPromoteDialog(true)}
                >
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                  {t("admin.userDetail.action.promote")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="admin-user-impersonate"
                  onSelect={() => void impersonateUser(user.id)}
                >
                  <Eye className="h-3.5 w-3.5" aria-hidden />
                  {t("admin.userDetail.action.impersonate")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="admin-user-export"
                  onSelect={() => void exportUser(user.id)}
                >
                  <Download className="h-3.5 w-3.5" aria-hidden />
                  {t("admin.userDetail.action.export")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-danger focus:text-danger"
                  data-testid="admin-user-delete"
                  onSelect={() => setDeleteDialog(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  {t("admin.userDetail.action.deleteUser")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
      </div>

      <ChangeUserEmailDialog
        user={emailDialog ? { id: user.id, email: user.email } : null}
        onClose={() => setEmailDialog(false)}
        onDone={reload}
      />

      <ResetUserPasswordDialog
        user={resetDialog ? { id: user.id, email: user.email } : null}
        onClose={() => setResetDialog(false)}
      />

      <DeleteUserDialog
        user={deleteDialog ? { id: user.id, email: user.email } : null}
        onClose={() => setDeleteDialog(false)}
        onDone={() => {
          window.location.assign("/admin/users");
        }}
      />

      <PromoteUserDialog
        user={promoteDialog ? { id: user.id, email: user.email } : null}
        onClose={() => setPromoteDialog(false)}
        onDone={reload}
      />

      <div className="flex flex-wrap items-center gap-2">
        <IdCell id={user.id} />
        {user.disabledAt === null ? (
          <Badge variant="success">{t("admin.users.status.active")}</Badge>
        ) : (
          <Badge variant="danger">{t("admin.users.status.disabled")}</Badge>
        )}
        <span className="text-[11px] text-muted-foreground">
          {t("admin.userDetail.createdAt")}{" "}
          {formatDate(user.createdAt, lang, hour12)}
        </span>
        {user.disabledAt !== null ? (
          <span className="text-[11px] text-danger">
            {t("admin.userDetail.disabledAt")}{" "}
            {formatDate(user.disabledAt, lang, hour12)}
          </span>
        ) : null}
        {user.emailVerifiedAt === null ? (
          <Badge variant="warning" data-testid="admin-user-verified-badge">
            {t("admin.userDetail.unverified")}
          </Badge>
        ) : (
          <Badge variant="success" data-testid="admin-user-verified-badge">
            {t("admin.userDetail.verifiedAt", {
              date: formatDate(user.emailVerifiedAt, lang, hour12),
            })}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        <StatCard
          icon={KanbanSquare}
          label={t("admin.userDetail.stat.boards")}
          value={counters.boards}
        />
        <StatCard
          icon={KanbanSquare}
          label={t("admin.userDetail.stat.cardsCreated")}
          value={counters.cardsCreated}
        />
        <StatCard
          icon={Users}
          label={t("admin.userDetail.stat.cardsAssigned")}
          value={counters.cardsAssigned}
        />
        <StatCard
          icon={MessageSquare}
          label={t("admin.userDetail.stat.comments")}
          value={counters.comments}
        />
        <StatCard
          icon={Paperclip}
          label={t("admin.userDetail.stat.attachments")}
          value={counters.attachments}
        />
        <StatCard
          icon={Users}
          label={t("admin.userDetail.stat.sessions")}
          value={counters.sessions}
        />
        <StatCard
          icon={KeyRound}
          label={t("admin.userDetail.stat.tokens")}
          value={counters.tokens}
        />
        <StatCard
          icon={Terminal}
          label={t("admin.userDetail.stat.commands")}
          value={counters.commands}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {tabs.map((entry) => (
          <button
            key={entry.key}
            type="button"
            data-testid={`admin-user-tab-${entry.key}`}
            onClick={() => setTab(entry.key)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors",
              tab === entry.key
                ? "border-primary/30 bg-primary/15 text-foreground"
                : "border-border bg-card/60 text-muted-foreground hover:bg-hover hover:text-foreground",
            )}
          >
            {entry.label}
            <span className="tabular-nums text-[10px] opacity-70">
              {entry.count}
            </span>
          </button>
        ))}
      </div>

      <Panel className="min-h-0 flex-1">
        {tab === "memberships" ? (
          <Table maxHeight="40rem">
            <thead>
              <tr>
                <Th>{t("admin.userDetail.col.board")}</Th>
                <Th>{t("admin.userDetail.col.role")}</Th>
                <Th>{t("admin.userDetail.col.accepted")}</Th>
                <Th>{t("admin.userDetail.col.expires")}</Th>
                <Th>{t("admin.userDetail.col.invitedBy")}</Th>
                <Th>{t("admin.userDetail.col.created")}</Th>
              </tr>
            </thead>
            <tbody>
              {detail.memberships.map((membership) => (
                <tr key={membership.id}>
                  <Td>
                    <EntityLink to={boardHref(membership.boardId)}>
                      {membership.boardTitle}
                    </EntityLink>
                    {membership.boardDeletedAt !== null ? (
                      <Badge variant="danger">
                        {t("admin.status.deleted")}
                      </Badge>
                    ) : null}
                  </Td>
                  <Td>
                    <RoleBadge role={membership.role} />
                  </Td>
                  <Td>
                    {membership.acceptedAt === null ? (
                      <Badge variant="warning">
                        {t("admin.status.pending")}
                      </Badge>
                    ) : (
                      <DateCell value={membership.acceptedAt} />
                    )}
                  </Td>
                  <Td>
                    <DateCell value={membership.expiresAt} />
                  </Td>
                  <Td>
                    <TextCell
                      value={membership.invitedByEmail}
                      maxWidth="12rem"
                    />
                  </Td>
                  <Td>
                    <DateCell value={membership.createdAt} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : null}

        {tab === "cards" ? (
          detail.createdCards.length === 0 ? (
            <EmptyState message={t("admin.userDetail.noCards")} />
          ) : (
            <Table maxHeight="40rem">
              <thead>
                <tr>
                  <Th>{t("admin.cards.column.title")}</Th>
                  <Th>{t("admin.cards.column.board")}</Th>
                  <Th>{t("admin.cards.column.columnRef")}</Th>
                  <Th>{t("admin.cards.column.updated")}</Th>
                  <Th>{t("admin.cards.column.status")}</Th>
                </tr>
              </thead>
              <tbody>
                {detail.createdCards.map((card) => (
                  <tr key={card.id}>
                    <Td>
                      <EntityLink to={cardHref(card.id)}>
                        {card.title}
                      </EntityLink>
                    </Td>
                    <Td>
                      <EntityLink to={boardHref(card.boardId)}>
                        {card.boardTitle}
                      </EntityLink>
                    </Td>
                    <Td>
                      <TextCell value={card.columnTitle} maxWidth="10rem" />
                    </Td>
                    <Td>
                      <DateCell value={card.updatedAt} />
                    </Td>
                    <Td>
                      <StatusBadge
                        deletedAt={card.deletedAt}
                        archivedAt={card.archivedAt}
                        labels={{
                          active: t("admin.status.active"),
                          archived: t("admin.status.archived"),
                          deleted: t("admin.status.deleted"),
                        }}
                      />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        ) : null}

        {tab === "assignedCards" ? (
          detail.assignedCards.length === 0 ? (
            <EmptyState message={t("admin.userDetail.noAssignedCards")} />
          ) : (
            <Table maxHeight="40rem">
              <thead>
                <tr>
                  <Th>{t("admin.cards.column.title")}</Th>
                  <Th>{t("admin.cards.column.board")}</Th>
                  <Th>{t("admin.cards.column.columnRef")}</Th>
                  <Th>{t("admin.cards.column.updated")}</Th>
                  <Th>{t("admin.cards.column.status")}</Th>
                </tr>
              </thead>
              <tbody>
                {detail.assignedCards.map((card) => (
                  <tr key={card.id}>
                    <Td>
                      <EntityLink to={cardHref(card.id)}>
                        {card.title}
                      </EntityLink>
                    </Td>
                    <Td>
                      <EntityLink to={boardHref(card.boardId)}>
                        {card.boardTitle}
                      </EntityLink>
                    </Td>
                    <Td>
                      <TextCell value={card.columnTitle} maxWidth="10rem" />
                    </Td>
                    <Td>
                      <DateCell value={card.updatedAt} />
                    </Td>
                    <Td>
                      <StatusBadge
                        deletedAt={card.deletedAt}
                        archivedAt={card.archivedAt}
                        labels={{
                          active: t("admin.status.active"),
                          archived: t("admin.status.archived"),
                          deleted: t("admin.status.deleted"),
                        }}
                      />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        ) : null}

        {tab === "comments" ? (
          detail.comments.length === 0 ? (
            <EmptyState />
          ) : (
            <Table maxHeight="40rem">
              <thead>
                <tr>
                  <Th>{t("admin.comments.column.text")}</Th>
                  <Th>{t("admin.comments.column.card")}</Th>
                  <Th>{t("admin.comments.column.created")}</Th>
                </tr>
              </thead>
              <tbody>
                {detail.comments.map((comment) => (
                  <tr key={comment.id}>
                    <Td className="max-w-[26rem]">
                      <TextCell value={comment.text} maxWidth="26rem" />
                    </Td>
                    <Td>
                      <EntityLink to={cardHref(comment.cardId)}>
                        {comment.cardTitle}
                      </EntityLink>
                    </Td>
                    <Td>
                      <DateCell value={comment.createdAt} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        ) : null}

        {tab === "attachments" ? (
          detail.attachments.length === 0 ? (
            <EmptyState />
          ) : (
            <Table maxHeight="40rem">
              <thead>
                <tr>
                  <Th>{t("admin.attachments.column.file")}</Th>
                  <Th>{t("admin.attachments.column.card")}</Th>
                  <Th>{t("admin.attachments.column.size")}</Th>
                  <Th>{t("admin.attachments.column.created")}</Th>
                </tr>
              </thead>
              <tbody>
                {detail.attachments.map((file) => (
                  <tr key={file.id}>
                    <Td>
                      <TextCell value={file.fileName} maxWidth="16rem" />
                    </Td>
                    <Td>
                      <EntityLink to={cardHref(file.cardId)}>
                        {file.cardTitle}
                      </EntityLink>
                    </Td>
                    <Td>
                      <span className="tabular-nums">{file.sizeBytes}</span>
                    </Td>
                    <Td>
                      <DateCell value={file.createdAt} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        ) : null}

        {tab === "sessions" ? (
          detail.sessions.length === 0 ? (
            <EmptyState />
          ) : (
            <Table maxHeight="40rem">
              <thead>
                <tr>
                  <Th>{t("admin.sessions.column.created")}</Th>
                  <Th>{t("admin.sessions.column.expires")}</Th>
                  <Th>{t("admin.sessions.column.id")}</Th>
                </tr>
              </thead>
              <tbody>
                {detail.sessions.map((session) => (
                  <tr key={session.id}>
                    <Td>
                      <DateCell value={session.createdAt} />
                    </Td>
                    <Td>
                      <DateCell value={session.expiresAt} />
                    </Td>
                    <Td>
                      <IdCell id={session.id} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        ) : null}

        {tab === "tokens" ? (
          detail.tokens.length === 0 ? (
            <EmptyState />
          ) : (
            <Table maxHeight="40rem">
              <thead>
                <tr>
                  <Th>{t("admin.tokens.column.name")}</Th>
                  <Th>{t("admin.tokens.column.created")}</Th>
                  <Th>{t("admin.tokens.column.lastUsed")}</Th>
                  <Th>{t("admin.tokens.column.expires")}</Th>
                  <Th>{t("admin.tokens.column.status")}</Th>
                </tr>
              </thead>
              <tbody>
                {detail.tokens.map((token) => (
                  <tr key={token.id}>
                    <Td>
                      <TextCell value={token.name} maxWidth="12rem" />
                    </Td>
                    <Td>
                      <DateCell value={token.createdAt} />
                    </Td>
                    <Td>
                      <DateCell value={token.lastUsedAt} />
                    </Td>
                    <Td>
                      <DateCell value={token.expiresAt} />
                    </Td>
                    <Td>
                      <StatusBadge
                        deletedAt={token.revokedAt}
                        labels={{
                          active: t("admin.status.active"),
                          deleted: t("admin.status.revoked"),
                        }}
                      />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        ) : null}

        {tab === "commands" ? (
          detail.recentCommands.length === 0 ? (
            <EmptyState />
          ) : (
            <Table maxHeight="40rem">
              <thead>
                <tr>
                  <Th>{t("admin.commands.column.type")}</Th>
                  <Th>{t("admin.commands.column.board")}</Th>
                  <Th>{t("admin.commands.column.seq")}</Th>
                  <Th>{t("admin.commands.column.created")}</Th>
                </tr>
              </thead>
              <tbody>
                {detail.recentCommands.map((command: AdminCommandRowDto) => (
                  <tr key={command.id}>
                    <Td>
                      <span className="rounded border border-border bg-hover/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                        {command.type}
                      </span>
                    </Td>
                    <Td>
                      <EntityLink to={boardHref(command.boardId)}>
                        {command.boardTitle}
                      </EntityLink>
                    </Td>
                    <Td>
                      <span className="tabular-nums">{command.seq}</span>
                    </Td>
                    <Td>
                      <DateCell value={command.createdAt} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        ) : null}

        {tab === "activity" ? (
          detail.recentActivity.length === 0 ? (
            <EmptyState />
          ) : (
            <Table maxHeight="40rem">
              <thead>
                <tr>
                  <Th>{t("admin.activity.column.type")}</Th>
                  <Th>{t("admin.activity.column.board")}</Th>
                  <Th>{t("admin.activity.column.card")}</Th>
                  <Th>{t("admin.activity.column.created")}</Th>
                </tr>
              </thead>
              <tbody>
                {detail.recentActivity.map((entry: AdminActivityRowDto) => (
                  <tr key={entry.id}>
                    <Td>
                      <span className="rounded border border-border bg-hover/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                        {entry.type}
                      </span>
                    </Td>
                    <Td>
                      <EntityLink to={boardHref(entry.boardId)}>
                        {entry.boardTitle}
                      </EntityLink>
                    </Td>
                    <Td>
                      {entry.cardId ? (
                        <EntityLink to={cardHref(entry.cardId)}>
                          {entry.cardTitle ?? entry.cardId.slice(0, 8)}
                        </EntityLink>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </Td>
                    <Td>
                      <DateCell value={entry.createdAt} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        ) : null}
      </Panel>
    </div>
  );
}
