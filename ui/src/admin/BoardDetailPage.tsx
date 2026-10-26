import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, MoreHorizontal } from "lucide-react";
import type { AdminBoardDetailDto } from "@janosik/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
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
import { routes } from "@/routes";
import { useAdminT } from "./admin-i18n";
import {
  DateCell,
  EntityLink,
  IdCell,
  LabelChip,
  NumberCell,
  RoleBadge,
} from "./cells";
import {
  Badge,
  ErrorState,
  Field,
  LoadingState,
  PageHeader,
  Panel,
  Table,
  Td,
  Th,
} from "./ui";
import { fieldError } from "./validation";

/**
 * Board detail (TASK-48) — meta, live counters, the member roster, columns
 * and labels; the visual content editor stays on the existing board content
 * page (same aggregate as the user app).
 */

const userHref = (id: string) => `/admin/users/${id}`;

function MetaItem({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="truncate text-xs">{children}</div>
    </div>
  );
}

function CountItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function BoardDetailPage() {
  const { boardId = "" } = useParams();
  const t = useAdminT();
  const toast = useToast();
  const [detail, setDetail] = useState<AdminBoardDetailDto | null>(null);
  const [error, setError] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState("MEMBER");
  const [adding, setAdding] = useState(false);

  const memberEmailError = fieldError(t, newEmail, {
    required: true,
    email: true,
  });

  const [reloadKey, setReloadKey] = useState(0);

  const load = () => {
    setError(false);
    setReloadKey((key) => key + 1);
  };

  useEffect(() => {
    let active = true;
    adminApi
      .boardDetail(boardId)
      .then((page) => {
        if (active) setDetail(page);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [boardId, reloadKey]);

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

  const { board } = detail;
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

  const addMember = async () => {
    setAdding(true);
    try {
      await adminApi.addBoardMember(board.id, {
        email: newEmail.trim(),
        role: newRole,
      });
      toast.success(t("admin.boardDetail.member.addDone"));
      setAddOpen(false);
      setNewEmail("");
      reload();
    } catch {
      toast.error(t("admin.common.actionFailed"));
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-center gap-2">
        <Button size="icon" variant="ghost" className="h-7 w-7" asChild>
          <Link to="/admin/boards" aria-label={t("admin.common.back")}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
        <PageHeader
          title={board.title}
          subtitle={board.ownerEmail ?? undefined}
          actions={
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  window.open(routes.adminBoardContent(board.id), "_self")
                }
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                {t("admin.boards.action.content")}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline">
                    {t("admin.common.actions")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {board.archivedAt === null ? (
                    <DropdownMenuItem
                      onSelect={() =>
                        void run(t("admin.boards.action.archive"), () =>
                          adminApi.archiveBoard(board.id),
                        )
                      }
                    >
                      {t("admin.boards.action.archive")}
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onSelect={() =>
                        void run(t("admin.boards.action.unarchive"), () =>
                          adminApi.unarchiveBoard(board.id),
                        )
                      }
                    >
                      {t("admin.boards.action.unarchive")}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    className="text-danger focus:text-danger"
                    onSelect={() =>
                      void run(t("admin.boards.action.delete"), () =>
                        adminApi.deleteBoard(board.id),
                      )
                    }
                  >
                    {t("admin.boards.action.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <IdCell id={board.id} />
        {board.deletedAt !== null ? (
          <Badge variant="danger">{t("admin.status.deleted")}</Badge>
        ) : board.archivedAt !== null ? (
          <Badge variant="warning">{t("admin.status.archived")}</Badge>
        ) : (
          <Badge variant="success">{t("admin.status.active")}</Badge>
        )}
      </div>

      <Panel className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-4 lg:grid-cols-6">
        <MetaItem label={t("admin.boardDetail.owner")}>
          {board.userId ? (
            <EntityLink to={userHref(board.userId)}>
              {board.ownerEmail}
            </EntityLink>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </MetaItem>
        <MetaItem label={t("admin.boardDetail.created")}>
          <DateCell value={board.createdAt} />
        </MetaItem>
        <MetaItem label={t("admin.boardDetail.updated")}>
          <DateCell value={board.updatedAt} />
        </MetaItem>
        <MetaItem label={t("admin.cardDetail.version")}>
          <span className="tabular-nums">{board.version}</span>
        </MetaItem>
      </Panel>

      <Panel className="grid grid-cols-3 gap-3 p-3 sm:grid-cols-5 lg:grid-cols-9">
        <CountItem
          label={t("admin.boardDetail.count.members")}
          value={board.counts.members}
        />
        <CountItem
          label={t("admin.boardDetail.count.columns")}
          value={board.counts.columns}
        />
        <CountItem
          label={t("admin.boardDetail.count.cards")}
          value={board.counts.cards}
        />
        <CountItem
          label={t("admin.boardDetail.count.labels")}
          value={board.counts.labels}
        />
        <CountItem
          label={t("admin.boardDetail.count.links")}
          value={board.counts.links}
        />
        <CountItem
          label={t("admin.boardDetail.count.comments")}
          value={board.counts.comments}
        />
        <CountItem
          label={t("admin.boardDetail.count.attachments")}
          value={board.counts.attachments}
        />
        <CountItem
          label={t("admin.boardDetail.count.commands")}
          value={board.counts.commands}
        />
        <CountItem
          label={t("admin.boardDetail.count.activity")}
          value={board.counts.activity}
        />
      </Panel>

      <Panel>
        <div className="flex items-center justify-between px-3 pt-2.5">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("admin.boardDetail.members")}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            data-testid="admin-board-add-member"
            onClick={() => setAddOpen(true)}
          >
            {t("admin.boardDetail.member.add")}
          </Button>
        </div>
        <Table maxHeight="22rem">
          <thead>
            <tr>
              <Th>{t("admin.userDetail.col.member")}</Th>
              <Th>{t("admin.userDetail.col.role")}</Th>
              <Th>{t("admin.userDetail.col.accepted")}</Th>
              <Th>{t("admin.userDetail.col.expires")}</Th>
              <Th>{t("admin.userDetail.col.invitedBy")}</Th>
              <Th>{t("admin.common.actions")}</Th>
            </tr>
          </thead>
          <tbody>
            {detail.members.map((member) => (
              <tr key={member.id}>
                <Td>
                  <EntityLink to={userHref(member.userId)}>
                    {member.userEmail}
                  </EntityLink>
                  {member.userDisabledAt !== null ? (
                    <Badge variant="danger">{t("admin.status.disabled")}</Badge>
                  ) : null}
                </Td>
                <Td>
                  <RoleBadge role={member.role} />
                </Td>
                <Td>
                  {member.acceptedAt === null ? (
                    <Badge variant="warning">{t("admin.status.pending")}</Badge>
                  ) : (
                    <DateCell value={member.acceptedAt} />
                  )}
                </Td>
                <Td>
                  <DateCell value={member.expiresAt} />
                </Td>
                <Td>{member.invitedByEmail ?? "—"}</Td>
                <Td>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        data-testid={`admin-member-actions-${member.id}`}
                        aria-label={t("admin.common.actions")}
                      >
                        <MoreHorizontal className="h-4 w-4" aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {(["MEMBER", "ADMIN", "VIEWER"] as const)
                        .filter((role) => role !== member.role)
                        .map((role) => (
                          <DropdownMenuItem
                            key={role}
                            onSelect={() =>
                              void run(
                                t("admin.boardDetail.member.roleDone"),
                                () =>
                                  adminApi.updateBoardMember(
                                    board.id,
                                    member.id,
                                    {
                                      role,
                                    },
                                  ),
                              )
                            }
                          >
                            {role}
                          </DropdownMenuItem>
                        ))}
                      <DropdownMenuItem
                        onSelect={() =>
                          void run(
                            t("admin.boardDetail.member.ownerDone"),
                            () =>
                              adminApi.transferOwner(board.id, member.userId),
                          )
                        }
                      >
                        {t("admin.boardDetail.member.makeOwner")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-danger focus:text-danger"
                        onSelect={() =>
                          void run(
                            t("admin.boardDetail.member.removeDone"),
                            () =>
                              adminApi.removeBoardMember(board.id, member.id),
                          )
                        }
                      >
                        {t("admin.boardDetail.member.remove")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      <Dialog
        open={addOpen}
        onOpenChange={(next) => (next ? undefined : setAddOpen(false))}
      >
        <DialogContent
          className="max-w-sm"
          data-testid="admin-add-member-dialog"
        >
          <DialogHeader>
            <DialogTitle>{t("admin.boardDetail.member.add")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <Field
              label={t("admin.boardDetail.member.email")}
              error={newEmail.trim() === "" ? null : memberEmailError}
            >
              <Input
                type="email"
                value={newEmail}
                invalid={newEmail.trim() !== "" && memberEmailError !== null}
                data-testid="admin-add-member-email"
                onChange={(event) => setNewEmail(event.target.value)}
              />
            </Field>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">
                {t("admin.userDetail.col.role")}
              </span>
              <select
                value={newRole}
                data-testid="admin-add-member-role"
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                onChange={(event) => setNewRole(event.target.value)}
              >
                <option value="MEMBER">MEMBER</option>
                <option value="ADMIN">ADMIN</option>
                <option value="VIEWER">VIEWER</option>
              </select>
            </label>
          </div>
          <DialogFooter className="gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAddOpen(false)}>
              {t("admin.common.cancel")}
            </Button>
            <Button
              size="sm"
              disabled={adding || memberEmailError !== null}
              data-testid="admin-add-member-submit"
              onClick={() => void addMember()}
            >
              {t("admin.boardDetail.member.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Panel>
        <p className="px-3 pt-2.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {t("admin.boardDetail.columns")}
        </p>
        <Table maxHeight="22rem">
          <thead>
            <tr>
              <Th>{t("admin.columns.column.title")}</Th>
              <Th>{t("admin.columns.column.position")}</Th>
              <Th>{t("admin.columns.column.wip")}</Th>
              <Th>{t("admin.columns.column.cards")}</Th>
              <Th>{t("admin.columns.column.status")}</Th>
            </tr>
          </thead>
          <tbody>
            {detail.columns.map((column) => (
              <tr key={column.id}>
                <Td>{column.title}</Td>
                <Td>
                  <NumberCell value={column.position} />
                </Td>
                <Td>
                  <NumberCell value={column.wipLimit} />
                </Td>
                <Td>
                  <NumberCell value={column.cardCount} />
                </Td>
                <Td>
                  {column.deletedAt !== null ? (
                    <Badge variant="danger">{t("admin.status.deleted")}</Badge>
                  ) : (
                    <Badge variant="success">{t("admin.status.active")}</Badge>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      {detail.labels.length > 0 ? (
        <Panel className="flex flex-wrap items-center gap-1.5 p-3">
          <p className="w-full text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("admin.boardDetail.labels")}
          </p>
          {detail.labels.map((label) => (
            <LabelChip key={label.id} name={label.name} color={label.color} />
          ))}
        </Panel>
      ) : null}
    </div>
  );
}
