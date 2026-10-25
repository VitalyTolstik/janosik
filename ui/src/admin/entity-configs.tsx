import { useNavigate } from "react-router-dom";
import type {
  AdminActivityRowDto,
  AdminAnnouncementDto,
  AdminAttachmentRowDto,
  AdminBoardRowDto,
  AdminCardLabelRowDto,
  AdminCardLinkRowDto,
  AdminCardRowDto,
  AdminChecklistItemRowDto,
  AdminChecklistRowDto,
  AdminColumnRowDto,
  AdminCommandRowDto,
  AdminCommentRowDto,
  AdminEntity,
  AdminLabelRowDto,
  AdminSessionRowDto,
  AdminTokenRowDto,
  AdminUserRowDto,
  AdminAuditRowDto,
} from "@janosik/shared";
import { adminApi } from "./admin-client";
import { useAdminT, type AdminMessageKey } from "./admin-i18n";
import { Badge } from "./ui";
import {
  AttachmentDownloadButton,
  AttachmentThumb,
  BoolCell,
  CopyButton,
  DateCell,
  EntityLink,
  IdCell,
  JsonCell,
  LabelChip,
  NumberCell,
  SizeCell,
  StatusBadge,
  TextCell,
  TextExpandCell,
  TranscodeBadge,
} from "./cells";
import type { EntityListConfig } from "./EntityPage";
import {
  ChangeUserEmailDialog,
  CreateBoardButton,
  CreateUserButton,
  DeleteUserDialog,
  PromoteUserDialog,
  ResetUserPasswordDialog,
} from "./dialogs";
import { exportUser, impersonateUser } from "./user-actions";

/**
 * Per-entity table configs (TASK-48) — one human-readable value per cell,
 * every foreign key rendered as a link into the related detail page and the
 * moderation actions attached where they exist.
 */

const userHref = (id: string) => `/admin/users/${id}`;
const boardHref = (id: string) => `/admin/boards/${id}`;
const cardHref = (id: string) => `/admin/cards/${id}`;

/** Cut a long title to `max` characters (the full text stays in `title`). */
const truncate = (value: string, max = 30): string =>
  value.length > max ? `${value.slice(0, max)}…` : value;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyConfig = EntityListConfig<any>;

/** Build the config for one entity (hook: labels are translated). */
export function useEntityConfig(entity: AdminEntity): AnyConfig {
  const t = useAdminT();
  const navigate = useNavigate();

  const statusLabels = {
    active: t("admin.status.active"),
    disabled: t("admin.status.disabled"),
    archived: t("admin.status.archived"),
    deleted: t("admin.status.deleted"),
    pending: t("admin.status.pending"),
    revoked: t("admin.status.revoked"),
  };

  switch (entity) {
    case "users": {
      const config: EntityListConfig<AdminUserRowDto> = {
        entity,
        title: t("admin.users.title"),
        subtitle: t("admin.users.subtitle"),
        statuses: [
          { value: "active", label: t("admin.users.filter.active") },
          { value: "disabled", label: t("admin.users.filter.disabled") },
        ],
        toolbar: (reload) => <CreateUserButton reload={reload} />,
        rowHref: (user) => userHref(user.id),
        rowTestId: (user) => `admin-user-row-${user.id}`,
        columns: [
          {
            label: t("admin.users.column.email"),
            render: (user) => (
              <EntityLink
                to={userHref(user.id)}
                testId={`admin-user-email-${user.id}`}
                copyValue={user.email}
              >
                {user.email}
              </EntityLink>
            ),
          },
          {
            label: t("admin.users.column.name"),
            render: (user) => (
              <TextCell value={user.displayName} maxWidth="12rem" />
            ),
          },
          {
            label: t("admin.users.column.created"),
            render: (user) => <DateCell value={user.createdAt} />,
          },
          {
            label: t("admin.users.column.status"),
            render: (user) =>
              user.disabledAt === null ? (
                <StatusBadge
                  deletedAt={null}
                  labels={{ active: statusLabels.active, deleted: "" }}
                />
              ) : (
                <StatusBadge
                  deletedAt={1}
                  labels={{ active: "", deleted: statusLabels.disabled }}
                />
              ),
          },
        ],
        actions: (user) => [
          user.disabledAt === null
            ? {
                label: t("admin.users.action.disable"),
                destructive: true,
                confirmTitle: t("admin.users.confirm.disable.title"),
                confirmBody: t("admin.users.confirm.disable.body", {
                  email: user.email,
                }),
                run: () =>
                  adminApi
                    .updateUser(user.id, { disabled: true })
                    .then(() => undefined),
              }
            : {
                label: t("admin.users.action.enable"),
                confirmTitle: t("admin.users.confirm.enable.title"),
                confirmBody: t("admin.users.confirm.enable.body", {
                  email: user.email,
                }),
                run: () =>
                  adminApi
                    .updateUser(user.id, { disabled: false })
                    .then(() => undefined),
              },
          {
            label: t("admin.users.action.changeEmail"),
            run: async () => undefined,
            renderDialog: ({ close, reload }) => (
              <ChangeUserEmailDialog
                user={user}
                onClose={close}
                onDone={reload}
              />
            ),
          },
          {
            label: t("admin.users.action.revokeSessions"),
            destructive: true,
            confirmTitle: t("admin.users.confirm.sessions.title"),
            confirmBody: t("admin.users.confirm.sessions.body", {
              email: user.email,
            }),
            run: () => adminApi.revokeUserSessions(user.id),
          },
          {
            label: t("admin.users.action.revokeTokens"),
            destructive: true,
            confirmTitle: t("admin.users.confirm.tokens.title"),
            confirmBody: t("admin.users.confirm.tokens.body", {
              email: user.email,
            }),
            run: () => adminApi.revokeUserTokens(user.id),
          },
          user.emailVerifiedAt === null
            ? {
                label: t("admin.userDetail.action.verify"),
                confirmTitle: t("admin.userDetail.confirm.verify.title", {
                  email: user.email,
                }),
                confirmBody: t("admin.userDetail.confirm.verify.body"),
                run: () =>
                  adminApi
                    .updateUser(user.id, { emailVerified: true })
                    .then(() => undefined),
              }
            : {
                label: t("admin.userDetail.action.unverify"),
                destructive: true,
                confirmTitle: t("admin.userDetail.confirm.unverify.title", {
                  email: user.email,
                }),
                confirmBody: t("admin.userDetail.confirm.unverify.body"),
                run: () =>
                  adminApi
                    .updateUser(user.id, { emailVerified: false })
                    .then(() => undefined),
              },
          {
            label: t("admin.userDetail.action.resend"),
            noToast: false,
            run: () => adminApi.resendUserVerification(user.id),
          },
          {
            label: t("admin.userDetail.action.resetPassword"),
            run: async () => undefined,
            renderDialog: ({ close }) => (
              <ResetUserPasswordDialog
                user={{ id: user.id, email: user.email }}
                onClose={close}
              />
            ),
          },
          {
            label: t("admin.userDetail.action.promote"),
            warning: true,
            run: async () => undefined,
            renderDialog: ({ close, reload }) => (
              <PromoteUserDialog
                user={{ id: user.id, email: user.email }}
                onClose={close}
                onDone={reload}
              />
            ),
          },
          {
            label: t("admin.userDetail.action.impersonate"),
            noToast: true,
            run: () => impersonateUser(user.id),
          },
          {
            label: t("admin.userDetail.action.export"),
            noToast: true,
            run: () => exportUser(user.id),
          },
          {
            label: t("admin.userDetail.action.deleteUser"),
            run: async () => undefined,
            renderDialog: ({ close, reload }) => (
              <DeleteUserDialog
                user={{ id: user.id, email: user.email }}
                onClose={close}
                onDone={reload}
              />
            ),
          },
        ],
      };
      return config;
    }

    case "boards": {
      const config: EntityListConfig<AdminBoardRowDto> = {
        entity,
        bulk: true,
        title: t("admin.boards.title"),
        subtitle: t("admin.boards.subtitle"),
        statuses: [
          { value: "active", label: t("admin.boards.filter.active") },
          { value: "archived", label: t("admin.boards.filter.archived") },
          { value: "deleted", label: t("admin.boards.filter.deleted") },
        ],
        toolbar: (reload) => <CreateBoardButton reload={reload} />,
        rowHref: (board) => boardHref(board.id),
        rowTestId: (board) => `admin-board-row-${board.id}`,
        columns: [
          {
            label: t("admin.comms.col.title"),
            render: (row) => (
              <TextCell
                value={row.title}
                maxWidth="20rem"
                className="font-medium"
              />
            ),
          },
          {
            label: t("admin.boards.column.owner"),
            render: (board) =>
              board.userId ? (
                <EntityLink
                  to={userHref(board.userId)}
                  copyValue={board.ownerEmail ?? undefined}
                >
                  {board.ownerEmail ?? board.userId.slice(0, 8)}
                </EntityLink>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
          {
            label: t("admin.boards.column.created"),
            render: (board) => <DateCell value={board.createdAt} />,
          },
          {
            label: t("admin.boards.column.updated"),
            render: (board) => <DateCell value={board.updatedAt} />,
          },
          {
            label: t("admin.boards.column.status"),
            render: (board) => (
              <StatusBadge
                deletedAt={board.deletedAt}
                archivedAt={board.archivedAt}
                labels={{
                  active: statusLabels.active,
                  archived: statusLabels.archived,
                  deleted: statusLabels.deleted,
                }}
              />
            ),
          },
        ],
        actions: (board) => [
          {
            label: t("admin.boards.action.content"),
            noToast: true,
            run: async () => {
              navigate(`/admin/boards/${board.id}/content`);
            },
          },
          board.archivedAt === null
            ? {
                label: t("admin.boards.action.archive"),
                confirmTitle: t("admin.boards.action.archive"),
                confirmBody: t("admin.boards.confirm.archive.body", {
                  title: board.title,
                }),
                run: () =>
                  adminApi.archiveBoard(board.id).then(() => undefined),
              }
            : {
                label: t("admin.boards.action.unarchive"),
                run: () =>
                  adminApi.unarchiveBoard(board.id).then(() => undefined),
              },
          {
            label: t("admin.boards.action.delete"),
            destructive: true,
            confirmTitle: t("admin.boards.action.delete"),
            confirmBody: t("admin.boards.confirm.delete.body", {
              title: board.title,
            }),
            run: () => adminApi.deleteBoard(board.id),
          },
        ],
      };
      return config;
    }

    case "columns": {
      const config: EntityListConfig<AdminColumnRowDto> = {
        entity,
        bulk: true,
        title: t("admin.columns.title"),
        subtitle: t("admin.columns.subtitle"),
        statuses: [
          { value: "active", label: statusLabels.active },
          { value: "deleted", label: statusLabels.deleted },
        ],
        rowHref: (column) => boardHref(column.boardId),
        columns: [
          {
            label: t("admin.columns.column.title"),
            render: (column) => (
              <TextCell value={column.title} maxWidth="14rem" />
            ),
          },
          {
            label: t("admin.columns.column.board"),
            render: (column) => (
              <EntityLink to={boardHref(column.boardId)}>
                {column.boardTitle}
              </EntityLink>
            ),
          },
          {
            label: t("admin.columns.column.position"),
            render: (column) => <NumberCell value={column.position} />,
          },
          {
            label: t("admin.columns.column.wip"),
            render: (column) => <NumberCell value={column.wipLimit} />,
          },
          {
            label: t("admin.columns.column.cards"),
            render: (column) => <NumberCell value={column.cardCount} />,
          },
          {
            label: t("admin.columns.column.updated"),
            render: (column) => <DateCell value={column.updatedAt} />,
          },
          {
            label: t("admin.columns.column.status"),
            render: (column) => (
              <StatusBadge
                deletedAt={column.deletedAt}
                labels={{
                  active: statusLabels.active,
                  deleted: statusLabels.deleted,
                }}
              />
            ),
          },
        ],
      };
      return config;
    }

    case "cards": {
      const config: EntityListConfig<AdminCardRowDto> = {
        entity,
        bulk: true,
        title: t("admin.cards.title"),
        subtitle: t("admin.cards.subtitle"),
        statuses: [
          { value: "active", label: t("admin.boards.filter.active") },
          { value: "archived", label: t("admin.boards.filter.archived") },
          { value: "deleted", label: t("admin.boards.filter.deleted") },
        ],
        rowHref: (card) => cardHref(card.id),
        rowTestId: (card) => `admin-card-row-${card.id}`,
        columns: [
          {
            label: t("admin.cards.column.title"),
            render: (card) => (
              <EntityLink to={cardHref(card.id)}>
                <span title={card.title}>{truncate(card.title)}</span>
              </EntityLink>
            ),
          },
          {
            label: t("admin.cards.column.board"),
            render: (card) => (
              <EntityLink to={boardHref(card.boardId)}>
                {card.boardTitle}
              </EntityLink>
            ),
          },
          {
            label: t("admin.cards.column.columnRef"),
            render: (card) => (
              <TextCell value={card.columnTitle} maxWidth="10rem" />
            ),
          },
          {
            label: t("admin.cards.column.comments"),
            render: (card) => <NumberCell value={card.commentIds.length} />,
          },
          {
            label: t("admin.cards.column.priority"),
            render: (card) =>
              card.priority !== null ? (
                <Badge variant="primary">{card.priority}</Badge>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
          {
            label: t("admin.cards.column.assignee"),
            render: (card) =>
              card.assigneeId ? (
                <EntityLink
                  to={userHref(card.assigneeId)}
                  copyValue={card.assigneeEmail ?? undefined}
                >
                  {card.assigneeEmail ?? card.assigneeId.slice(0, 8)}
                </EntityLink>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
          {
            label: t("admin.cards.column.due"),
            render: (card) => <DateCell value={card.dueDate} />,
          },
          {
            label: t("admin.cards.column.updated"),
            render: (card) => <DateCell value={card.updatedAt} />,
          },
          {
            label: t("admin.cards.column.status"),
            render: (card) => (
              <StatusBadge
                deletedAt={card.deletedAt}
                archivedAt={card.archivedAt}
                labels={{
                  active: statusLabels.active,
                  archived: statusLabels.archived,
                  deleted: statusLabels.deleted,
                }}
              />
            ),
          },
        ],
        actions: (card) => [
          card.archivedAt === null
            ? {
                label: t("admin.cards.action.archive"),
                confirmTitle: t("admin.cards.confirm.archive.title"),
                confirmBody: t("admin.cards.confirm.archive.body", {
                  title: card.title,
                }),
                run: () => adminApi.archiveCard(card.id).then(() => undefined),
              }
            : {
                label: t("admin.cards.action.unarchive"),
                run: () =>
                  adminApi.unarchiveCard(card.id).then(() => undefined),
              },
          {
            label: t("admin.cards.action.delete"),
            destructive: true,
            confirmTitle: t("admin.cards.action.delete"),
            confirmBody: t("admin.cards.confirm.delete.body", {
              title: card.title,
            }),
            run: () => adminApi.deleteCard(card.id),
          },
        ],
      };
      return config;
    }

    case "cardLinks": {
      const config: EntityListConfig<AdminCardLinkRowDto> = {
        entity,
        bulk: true,
        title: t("admin.cardLinks.title"),
        subtitle: t("admin.cardLinks.subtitle"),
        statuses: [
          { value: "active", label: statusLabels.active },
          { value: "deleted", label: statusLabels.deleted },
        ],
        columns: [
          {
            label: t("admin.cardLinks.column.from"),
            render: (link) => (
              <EntityLink to={cardHref(link.fromCardId)}>
                <span title={link.fromCardTitle}>
                  {truncate(link.fromCardTitle)}
                </span>
              </EntityLink>
            ),
          },
          {
            label: t("admin.cardLinks.column.type"),
            render: (link) => (
              <span className="rounded border border-border bg-hover/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {link.type}
              </span>
            ),
          },
          {
            label: t("admin.cardLinks.column.to"),
            render: (link) => (
              <EntityLink to={cardHref(link.toCardId)}>
                <span title={link.toCardTitle}>
                  {truncate(link.toCardTitle)}
                </span>
              </EntityLink>
            ),
          },
          {
            label: t("admin.cardLinks.column.board"),
            render: (link) => (
              <EntityLink to={boardHref(link.boardId)}>
                {link.boardTitle}
              </EntityLink>
            ),
          },
          {
            label: t("admin.cardLinks.column.created"),
            render: (link) => <DateCell value={link.createdAt} />,
          },
          {
            label: t("admin.cardLinks.column.status"),
            render: (link) => (
              <StatusBadge
                deletedAt={link.deletedAt}
                labels={{
                  active: statusLabels.active,
                  deleted: statusLabels.deleted,
                }}
              />
            ),
          },
        ],
      };
      return config;
    }

    case "labels": {
      const config: EntityListConfig<AdminLabelRowDto> = {
        entity,
        bulk: true,
        title: t("admin.labels.title"),
        subtitle: t("admin.labels.subtitle"),
        statuses: [
          { value: "active", label: statusLabels.active },
          { value: "deleted", label: statusLabels.deleted },
        ],
        columns: [
          {
            label: t("admin.labels.column.name"),
            render: (label) => (
              <LabelChip name={label.name} color={label.color} />
            ),
          },
          {
            label: t("admin.labels.column.board"),
            render: (label) => (
              <EntityLink to={boardHref(label.boardId)}>
                {label.boardTitle}
              </EntityLink>
            ),
          },
          {
            label: t("admin.labels.column.position"),
            render: (label) => <NumberCell value={label.position} />,
          },
          {
            label: t("admin.labels.column.cards"),
            render: (label) => <NumberCell value={label.cardCount} />,
          },
          {
            label: t("admin.labels.column.version"),
            render: (label) => <NumberCell value={label.version} />,
          },
          {
            label: t("admin.labels.column.status"),
            render: (label) => (
              <StatusBadge
                deletedAt={label.deletedAt}
                labels={{
                  active: statusLabels.active,
                  deleted: statusLabels.deleted,
                }}
              />
            ),
          },
        ],
      };
      return config;
    }

    case "cardLabels": {
      const config: EntityListConfig<AdminCardLabelRowDto> = {
        entity,
        title: t("admin.cardLabels.title"),
        subtitle: t("admin.cardLabels.subtitle"),
        columns: [
          {
            label: t("admin.cardLabels.column.card"),
            render: (row) => (
              <EntityLink to={cardHref(row.cardId)}>{row.cardTitle}</EntityLink>
            ),
          },
          {
            label: t("admin.cardLabels.column.label"),
            render: (row) => (
              <LabelChip name={row.labelName} color={row.labelColor} />
            ),
          },
          {
            label: t("admin.cardLabels.column.board"),
            render: (row) => (
              <EntityLink to={boardHref(row.boardId)}>
                {row.boardTitle}
              </EntityLink>
            ),
          },
          {
            label: t("admin.cardLabels.column.position"),
            render: (row) => <NumberCell value={row.position} />,
          },
        ],
      };
      return config;
    }

    case "checklists": {
      const config: EntityListConfig<AdminChecklistRowDto> = {
        entity,
        bulk: true,
        title: t("admin.checklists.title"),
        subtitle: t("admin.checklists.subtitle"),
        statuses: [
          { value: "active", label: statusLabels.active },
          { value: "deleted", label: statusLabels.deleted },
        ],
        rowHref: (checklist) => cardHref(checklist.cardId),
        columns: [
          {
            label: t("admin.checklists.column.title"),
            render: (checklist) => (
              <TextCell value={checklist.title} maxWidth="14rem" />
            ),
          },
          {
            label: t("admin.checklists.column.card"),
            render: (checklist) => (
              <EntityLink to={cardHref(checklist.cardId)}>
                {checklist.cardTitle}
              </EntityLink>
            ),
          },
          {
            label: t("admin.checklists.column.board"),
            render: (checklist) => (
              <EntityLink to={boardHref(checklist.boardId)}>
                {checklist.boardTitle}
              </EntityLink>
            ),
          },
          {
            label: t("admin.checklists.column.progress"),
            render: (checklist) => (
              <span className="tabular-nums text-muted-foreground">
                {checklist.doneCount}/{checklist.itemCount}
              </span>
            ),
          },
          {
            label: t("admin.checklists.column.status"),
            render: (checklist) => (
              <StatusBadge
                deletedAt={checklist.deletedAt}
                labels={{
                  active: statusLabels.active,
                  deleted: statusLabels.deleted,
                }}
              />
            ),
          },
        ],
      };
      return config;
    }

    case "checklistItems": {
      const config: EntityListConfig<AdminChecklistItemRowDto> = {
        entity,
        bulk: true,
        title: t("admin.checklistItems.title"),
        subtitle: t("admin.checklistItems.subtitle"),
        statuses: [
          { value: "active", label: statusLabels.active },
          { value: "deleted", label: statusLabels.deleted },
        ],
        columns: [
          {
            label: t("admin.checklistItems.column.text"),
            render: (item) => <TextCell value={item.text} maxWidth="18rem" />,
          },
          {
            label: t("admin.checklistItems.column.done"),
            render: (item) => <BoolCell value={item.done} />,
          },
          {
            label: t("admin.checklistItems.column.checklist"),
            render: (item) => (
              <TextCell value={item.checklistTitle} maxWidth="12rem" />
            ),
          },
          {
            label: t("admin.checklistItems.column.card"),
            render: (item) => (
              <EntityLink to={cardHref(item.cardId)}>
                {item.cardTitle}
              </EntityLink>
            ),
          },
          {
            label: t("admin.checklistItems.column.status"),
            render: (item) => (
              <StatusBadge
                deletedAt={item.deletedAt}
                labels={{
                  active: statusLabels.active,
                  deleted: statusLabels.deleted,
                }}
              />
            ),
          },
        ],
      };
      return config;
    }

    case "comments": {
      const config: EntityListConfig<AdminCommentRowDto> = {
        entity,
        bulk: true,
        title: t("admin.comments.title"),
        subtitle: t("admin.comments.subtitle"),
        columns: [
          {
            label: t("admin.comments.column.text"),
            render: (comment) => (
              <TextCell value={comment.text} maxWidth="26rem" />
            ),
            className: "max-w-[26rem]",
          },
          {
            label: t("admin.comments.column.card"),
            render: (comment) => (
              <EntityLink to={cardHref(comment.cardId)}>
                {comment.cardTitle}
              </EntityLink>
            ),
          },
          {
            label: t("admin.comments.column.author"),
            render: (comment) => (
              <EntityLink
                to={userHref(comment.authorId)}
                copyValue={comment.authorEmail}
              >
                {comment.authorEmail}
              </EntityLink>
            ),
          },
          {
            label: t("admin.comments.column.created"),
            render: (comment) => <DateCell value={comment.createdAt} />,
          },
          {
            label: t("admin.comments.column.status"),
            render: (comment) => (
              <StatusBadge
                deletedAt={comment.deletedAt}
                labels={{
                  active: statusLabels.active,
                  deleted: statusLabels.deleted,
                }}
              />
            ),
          },
        ],
        actions: (comment) => [
          {
            label: t("admin.comments.action.delete"),
            destructive: true,
            confirmTitle: t("admin.comments.action.delete"),
            confirmBody: t("admin.comments.confirm.body", {
              title: comment.cardTitle,
            }),
            run: () => adminApi.deleteComment(comment.id),
          },
        ],
      };
      return config;
    }

    case "attachments": {
      const config: EntityListConfig<AdminAttachmentRowDto> = {
        entity,
        bulk: true,
        title: t("admin.attachments.title"),
        subtitle: t("admin.attachments.subtitle"),
        statuses: [
          { value: "active", label: statusLabels.active },
          { value: "deleted", label: statusLabels.deleted },
        ],
        columns: [
          {
            label: t("admin.attachments.column.file"),
            render: (file) => (
              <span className="inline-flex items-center gap-2">
                <AttachmentThumb
                  attachmentId={file.id}
                  mimeType={file.mimeType}
                  fileName={file.fileName}
                />
                <TextCell value={file.fileName} maxWidth="18rem" />
                <AttachmentDownloadButton
                  attachmentId={file.id}
                  fileName={file.fileName}
                />
              </span>
            ),
          },
          {
            label: t("admin.attachments.column.card"),
            render: (file) => (
              <EntityLink to={cardHref(file.cardId)}>
                {file.cardTitle}
              </EntityLink>
            ),
          },
          {
            label: t("admin.attachments.column.size"),
            render: (file) => <SizeCell bytes={file.sizeBytes} />,
          },
          {
            label: t("admin.attachments.column.mime"),
            render: (file) => (
              <span className="font-mono text-[11px] text-muted-foreground">
                {file.mimeType}
              </span>
            ),
          },
          {
            label: t("admin.attachments.column.transcode"),
            render: (file) => <TranscodeBadge status={file.transcodeStatus} />,
          },
          {
            label: t("admin.attachments.column.uploader"),
            render: (file) => (
              <EntityLink
                to={userHref(file.uploadedById)}
                copyValue={file.uploadedByEmail}
              >
                {file.uploadedByEmail}
              </EntityLink>
            ),
          },
          {
            label: t("admin.attachments.column.created"),
            render: (file) => <DateCell value={file.createdAt} />,
          },
          {
            label: t("admin.attachments.column.status"),
            render: (file) => (
              <StatusBadge
                deletedAt={file.deletedAt}
                labels={{
                  active: statusLabels.active,
                  deleted: statusLabels.deleted,
                }}
              />
            ),
          },
        ],
        actions: (file) =>
          file.deletedAt !== null
            ? [
                {
                  label: t("admin.entities.restore"),
                  run: () => adminApi.restoreEntity("attachments", file.id),
                },
              ]
            : [
                {
                  label: t("admin.attachments.action.delete"),
                  destructive: true,
                  confirmTitle: t("admin.attachments.confirm.delete.title", {
                    name: file.fileName,
                  }),
                  confirmBody: t("admin.attachments.confirm.delete.body"),
                  run: () => adminApi.deleteAttachment(file.id),
                },
              ],
      };
      return config;
    }

    case "activity": {
      const config: EntityListConfig<AdminActivityRowDto> = {
        entity,
        title: t("admin.activity.title"),
        subtitle: t("admin.activity.subtitle"),
        periods: true,
        columns: [
          {
            label: t("admin.activity.column.type"),
            render: (entry) => (
              <span className="rounded border border-border bg-hover/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {entry.type}
              </span>
            ),
          },
          {
            label: t("admin.activity.column.actor"),
            render: (entry) => (
              <EntityLink
                to={userHref(entry.actorId)}
                copyValue={entry.actorEmail}
              >
                {entry.actorEmail}
              </EntityLink>
            ),
          },
          {
            label: t("admin.activity.column.board"),
            render: (entry) => (
              <EntityLink to={boardHref(entry.boardId)}>
                {entry.boardTitle}
              </EntityLink>
            ),
          },
          {
            label: t("admin.activity.column.card"),
            render: (entry) =>
              entry.cardId ? (
                <EntityLink to={cardHref(entry.cardId)}>
                  {entry.cardTitle ?? entry.cardId.slice(0, 8)}
                </EntityLink>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
          {
            label: t("admin.activity.column.details"),
            render: (entry) => (
              <JsonCell
                value={entry.details}
                testId={`admin-activity-details-${entry.id}`}
              />
            ),
          },
          {
            label: t("admin.activity.column.created"),
            render: (entry) => <DateCell value={entry.createdAt} />,
          },
        ],
      };
      return config;
    }

    case "commands": {
      const config: EntityListConfig<AdminCommandRowDto> = {
        entity,
        title: t("admin.commands.title"),
        subtitle: t("admin.commands.subtitle"),
        periods: true,
        columns: [
          {
            label: t("admin.commands.column.type"),
            render: (command) => (
              <span className="rounded border border-border bg-hover/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {command.type}
              </span>
            ),
          },
          {
            label: t("admin.commands.column.actor"),
            render: (command) => (
              <EntityLink
                to={userHref(command.actorId)}
                copyValue={command.actorEmail}
              >
                {command.actorEmail}
              </EntityLink>
            ),
          },
          {
            label: t("admin.commands.column.board"),
            render: (command) => (
              <EntityLink to={boardHref(command.boardId)}>
                {command.boardTitle}
              </EntityLink>
            ),
          },
          {
            label: t("admin.commands.column.seq"),
            render: (command) => <NumberCell value={command.seq} />,
          },
          {
            label: t("admin.commands.column.payload"),
            render: (command) => (
              <JsonCell
                value={command.payload}
                testId={`admin-command-payload-${command.id}`}
              />
            ),
          },
          {
            label: t("admin.commands.column.created"),
            render: (command) => <DateCell value={command.createdAt} />,
          },
        ],
      };
      return config;
    }

    case "sessions": {
      const config: EntityListConfig<AdminSessionRowDto> = {
        entity,
        title: t("admin.sessions.title"),
        subtitle: t("admin.sessions.subtitle"),
        periods: true,
        rowHref: (session) => userHref(session.userId),
        columns: [
          {
            label: t("admin.sessions.column.user"),
            render: (session) => (
              <EntityLink
                to={userHref(session.userId)}
                copyValue={session.userEmail}
              >
                {session.userEmail}
              </EntityLink>
            ),
          },
          {
            label: t("admin.sessions.column.created"),
            render: (session) => <DateCell value={session.createdAt} />,
          },
          {
            label: t("admin.sessions.column.expires"),
            render: (session) => <DateCell value={session.expiresAt} />,
          },
          {
            label: t("admin.sessions.column.ip"),
            render: (session) => (
              <TextCell value={session.ip} maxWidth="10rem" />
            ),
          },
          {
            label: t("admin.sessions.column.userAgent"),
            render: (session) => (
              <TextCell value={session.userAgent} maxWidth="16rem" />
            ),
          },
          {
            label: t("admin.sessions.column.id"),
            render: (session) => <IdCell id={session.id} />,
          },
        ],
        actions: (session) => [
          {
            label: t("admin.sessions.action.revoke"),
            destructive: true,
            confirmTitle: t("admin.sessions.action.revoke"),
            confirmBody: t("admin.sessions.confirm.body", {
              email: session.userEmail,
            }),
            run: () => adminApi.revokeSession(session.id),
          },
        ],
      };
      return config;
    }

    case "tokens": {
      const config: EntityListConfig<AdminTokenRowDto> = {
        entity,
        title: t("admin.tokens.title"),
        subtitle: t("admin.tokens.subtitle"),
        periods: true,
        columns: [
          {
            label: t("admin.tokens.column.name"),
            render: (token) => <TextCell value={token.name} maxWidth="12rem" />,
          },
          {
            label: t("admin.tokens.column.user"),
            render: (token) => (
              <EntityLink
                to={userHref(token.userId)}
                copyValue={token.userEmail}
              >
                {token.userEmail}
              </EntityLink>
            ),
          },
          {
            label: t("admin.tokens.column.created"),
            render: (token) => <DateCell value={token.createdAt} />,
          },
          {
            label: t("admin.tokens.column.lastUsed"),
            render: (token) => <DateCell value={token.lastUsedAt} />,
          },
          {
            label: t("admin.tokens.column.expires"),
            render: (token) => <DateCell value={token.expiresAt} />,
          },
          {
            label: t("admin.tokens.column.status"),
            render: (token) => (
              <StatusBadge
                deletedAt={token.revokedAt}
                labels={{
                  active: statusLabels.active,
                  deleted: statusLabels.revoked,
                }}
              />
            ),
          },
        ],
        actions: (token) =>
          token.revokedAt === null
            ? [
                {
                  label: t("admin.tokens.action.revoke"),
                  destructive: true,
                  confirmTitle: t("admin.tokens.action.revoke"),
                  confirmBody: t("admin.tokens.confirm.body", {
                    name: token.name,
                  }),
                  run: () => adminApi.revokeToken(token.id),
                },
              ]
            : [],
      };
      return config;
    }

    case "announcements": {
      const config: EntityListConfig<AdminAnnouncementDto> = {
        entity,
        title: t("admin.announcements.title"),
        subtitle: t("admin.announcements.subtitle"),
        statuses: [
          { value: "active", label: statusLabels.active },
          {
            value: "disabled",
            label: t("admin.announcements.status.inactive"),
          },
        ],
        columns: [
          {
            label: t("admin.comms.col.title"),
            render: (row) => (
              <TextExpandCell
                value={row.title}
                maxWidth="20rem"
                className="font-medium"
              />
            ),
          },
          {
            label: t("admin.comms.col.body"),
            render: (row) => (
              <TextExpandCell value={row.body} maxWidth="28rem" />
            ),
          },
          {
            label: t("admin.comms.col.level"),
            render: (row) => (
              <Badge
                variant={
                  row.level === "danger"
                    ? "danger"
                    : row.level === "warning"
                      ? "warning"
                      : "neutral"
                }
              >
                {t(`admin.comms.level.${row.level}` as AdminMessageKey)}
              </Badge>
            ),
          },
          {
            label: t("admin.comms.col.audience"),
            render: (row) => (
              <span className="text-xs text-muted-foreground">
                {row.audience === "all"
                  ? t("admin.comms.audience.all")
                  : (row.segment ?? t("admin.comms.audience.segment"))}
              </span>
            ),
          },
          {
            label: t("admin.comms.col.email"),
            render: (row) =>
              row.sendEmail ? <Badge variant="primary">email</Badge> : "—",
          },
          {
            label: t("admin.comms.active"),
            render: (row) =>
              row.active ? (
                <Badge variant="success">{t("admin.observability.on")}</Badge>
              ) : (
                <Badge variant="neutral">{t("admin.observability.off")}</Badge>
              ),
          },
          {
            label: t("admin.comms.col.created"),
            render: (row) => <DateCell value={row.createdAt} />,
          },
          {
            label: t("admin.announcements.column.author"),
            render: (row) => (
              <TextCell value={row.createdBy} maxWidth="16rem" />
            ),
          },
        ],
        actions: (row) => [
          row.active
            ? {
                label: t("admin.announcements.action.deactivate"),
                run: () =>
                  adminApi.updateAnnouncement(row.id, { active: false }),
              }
            : {
                label: t("admin.announcements.action.activate"),
                run: () =>
                  adminApi.updateAnnouncement(row.id, { active: true }),
              },
          {
            label: t("admin.common.delete"),
            destructive: true,
            run: () => adminApi.deleteAnnouncement(row.id),
          },
        ],
      };
      return config;
    }

    case "audit": {
      const config: EntityListConfig<AdminAuditRowDto> = {
        entity,
        title: t("admin.audit.title"),
        subtitle: t("admin.audit.subtitle"),
        periods: true,
        columns: [
          {
            label: t("admin.audit.column.action"),
            render: (entry) => (
              <span className="rounded border border-border bg-hover/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {entry.action}
              </span>
            ),
          },
          {
            label: t("admin.audit.column.admin"),
            render: (entry) =>
              entry.adminId ? (
                <EntityLink
                  to={`/admin/masters`}
                  className="font-normal"
                  copyValue={entry.adminEmail ?? undefined}
                >
                  {entry.adminEmail}
                </EntityLink>
              ) : entry.adminEmail ? (
                <span className="inline-flex items-center gap-1.5">
                  <TextCell value={entry.adminEmail} maxWidth="14rem" />
                  <CopyButton value={entry.adminEmail} />
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
          {
            label: t("admin.audit.column.target"),
            render: (entry) =>
              entry.targetId ? (
                <span className="inline-flex items-center gap-2">
                  <span className="text-muted-foreground">
                    {entry.targetType}
                  </span>
                  <IdCell id={entry.targetId} />
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
          {
            label: t("admin.audit.column.details"),
            render: (entry) => (
              <JsonCell
                value={entry.details}
                testId={`admin-audit-details-${entry.id}`}
              />
            ),
          },
          {
            label: t("admin.audit.column.created"),
            render: (entry) => <DateCell value={entry.createdAt} />,
          },
        ],
      };
      return config;
    }

    default:
      throw new Error(`No list config for entity: ${entity}`);
  }
}
