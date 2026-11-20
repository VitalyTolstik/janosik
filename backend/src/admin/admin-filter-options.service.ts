import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  ADMIN_FILTER_OPTION_LIMITS,
  canonicalAdminFilterValues,
  type AdminFilterOptionDto,
  type AdminFilterOptionsDto,
  type AdminFilterOptionsQuery,
} from "@janosik/shared";
import { PrismaService } from "@/common/prisma/prisma.service";

type OptionRow = Omit<AdminFilterOptionDto, "color"> & { color: string | null };

const ACTIVE_OR_DELETED = Prisma.sql`CASE WHEN entity."deletedAt" IS NOT NULL
  THEN 'deleted' ELSE 'active' END`;
const ARCHIVABLE_STATE = Prisma.sql`CASE WHEN entity."deletedAt" IS NOT NULL THEN 'deleted'
  WHEN entity."archivedAt" IS NOT NULL THEN 'archived' ELSE 'active' END`;
const NO_CONTEXT = Prisma.sql`NULL::text AS sublabel, NULL::text AS "boardId",
  NULL::text AS "columnId", NULL::text AS color`;

function optionSource(query: AdminFilterOptionsQuery): Prisma.Sql {
  // Only picker searches apply parent scopes. Existing ids resolve unscoped
  // so chips can distinguish a parent conflict from a missing entity.
  const scope: Pick<
    AdminFilterOptionsQuery,
    "boardId" | "columnId" | "cardId"
  > = query.ids === undefined ? query : {};
  switch (query.type) {
    case "board":
      return Prisma.sql`
        SELECT entity.id, entity.title AS label, ${NO_CONTEXT}, ${ARCHIVABLE_STATE} AS state
        FROM "Board" entity`;
    case "column":
      return Prisma.sql`
        SELECT entity.id, entity.title AS label, board.title AS sublabel,
          entity."boardId", NULL::text AS "columnId", NULL::text AS color,
          ${ACTIVE_OR_DELETED} AS state
        FROM "Column" entity JOIN "Board" board ON board.id = entity."boardId"
        ${scope.boardId ? Prisma.sql`WHERE entity."boardId" = ${scope.boardId}` : Prisma.empty}`;
    case "label":
      return Prisma.sql`
        SELECT entity.id, entity.name AS label, board.title AS sublabel,
          entity."boardId", NULL::text AS "columnId", entity.color,
          ${ACTIVE_OR_DELETED} AS state
        FROM "Label" entity JOIN "Board" board ON board.id = entity."boardId"
        ${scope.boardId ? Prisma.sql`WHERE entity."boardId" = ${scope.boardId}` : Prisma.empty}`;
    case "card":
      return Prisma.sql`
        SELECT entity.id, entity.title AS label, concat(board.title, ' / ', col.title) AS sublabel,
          col."boardId", entity."columnId", NULL::text AS color, ${ARCHIVABLE_STATE} AS state
        FROM "Card" entity JOIN "Column" col ON col.id = entity."columnId"
          JOIN "Board" board ON board.id = col."boardId"
        WHERE TRUE
          ${scope.boardId ? Prisma.sql`AND col."boardId" = ${scope.boardId}` : Prisma.empty}
          ${scope.columnId ? Prisma.sql`AND entity."columnId" = ${scope.columnId}` : Prisma.empty}`;
    case "checklist":
      return Prisma.sql`
        SELECT entity.id, entity.title AS label, concat(board.title, ' / ', card.title) AS sublabel,
          col."boardId", NULL::text AS "columnId", NULL::text AS color, ${ACTIVE_OR_DELETED} AS state
        FROM "Checklist" entity JOIN "Card" card ON card.id = entity."cardId"
          JOIN "Column" col ON col.id = card."columnId"
          JOIN "Board" board ON board.id = col."boardId"
        WHERE TRUE
          ${scope.boardId ? Prisma.sql`AND col."boardId" = ${scope.boardId}` : Prisma.empty}
          ${scope.columnId ? Prisma.sql`AND card."columnId" = ${scope.columnId}` : Prisma.empty}
          ${scope.cardId ? Prisma.sql`AND entity."cardId" = ${scope.cardId}` : Prisma.empty}`;
    case "user":
      return Prisma.sql`
        SELECT id, email AS label, "displayName" AS sublabel,
          NULL::text AS "boardId", NULL::text AS "columnId", NULL::text AS color,
          CASE WHEN "disabledAt" IS NOT NULL THEN 'disabled' ELSE 'active' END AS state
        FROM "User"`;
    case "auditActor":
      return Prisma.sql`
        SELECT DISTINCT ON ("adminId") "adminId" AS id, "adminEmail" AS label,
          ${NO_CONTEXT}, NULL::text AS state
        FROM "AdminAuditLog" log
        WHERE "adminId" IS NOT NULL
          ${query.ids ? Prisma.sql`AND "adminId" IN (${Prisma.join(query.ids)})` : Prisma.empty}
        ORDER BY "adminId", "createdAt" DESC, log.id DESC`;
    case "action":
      return codeOptions(
        Prisma.sql`SELECT DISTINCT action AS code FROM "AdminAuditLog"`,
      );
    case "commandType":
      return codeOptions(
        Prisma.sql`SELECT DISTINCT type AS code FROM "Command"`,
      );
    case "activityType":
      return codeOptions(
        Prisma.sql`SELECT DISTINCT type AS code FROM "Activity"`,
      );
    case "targetType":
      return codeOptions(
        Prisma.sql`SELECT DISTINCT "targetType" AS code FROM "AdminAuditLog" WHERE "targetType" IS NOT NULL`,
      );
  }
}

function codeOptions(codes: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`SELECT code AS id, code AS label, ${NO_CONTEXT}, NULL::text AS state FROM (${codes}) codes`;
}

@Injectable()
export class AdminFilterOptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AdminFilterOptionsQuery): Promise<AdminFilterOptionsDto> {
    const ids = query.ids && canonicalAdminFilterValues(query.ids);
    const source = optionSource({ ...query, ids });
    const q = query.q ?? "";
    const limit = query.limit ?? ADMIN_FILTER_OPTION_LIMITS.default;
    const where = ids
      ? Prisma.sql`WHERE id IN (${Prisma.join(ids)})`
      : q
        ? Prisma.sql`WHERE strpos(lower(id), lower(${q})) > 0
          OR strpos(lower(label), lower(${q})) > 0
          ${
            query.type === "user"
              ? Prisma.sql`OR strpos(lower(sublabel), lower(${q})) > 0`
              : Prisma.empty
          }`
        : Prisma.empty;

    const rows = await this.prisma.$queryRaw<OptionRow[]>`
      SELECT * FROM (${source}) options ${where}
      ORDER BY (id = ${q}) DESC, lower(label), id
      ${ids ? Prisma.empty : Prisma.sql`LIMIT ${limit + 1}`}
    `;
    const items = (ids ? rows : rows.slice(0, limit)).map(
      ({ color, ...row }) => (color === null ? row : { ...row, color }),
    );
    const found = new Set(items.map((item) => item.id));
    return {
      items,
      missing: ids?.filter((id) => !found.has(id)) ?? [],
      hasMore: ids === undefined && rows.length > limit,
    };
  }
}
