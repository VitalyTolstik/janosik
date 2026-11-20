import {
  BadRequestException,
  createParamDecorator,
  NotFoundException,
  UnprocessableEntityException,
  ValidationPipe,
} from "@nestjs/common";
import type { Request } from "express";
import {
  ADMIN_ENTITIES,
  ADMIN_FILTER_KEYS,
  ENTITY_FILTERS,
  ENTITY_STATUS_VALUES,
  adminFilterEntries,
  adminFilterLimitError,
  canonicalAdminFilterValues,
  parseAdminFilterValue,
  type AdminFilterKey,
  type AdminListSurface,
} from "@janosik/shared";
import { AdminListQueryDto } from "./dto/admin-list-query.dto";

const LIST_KEYS = ["search", "status", "limit", "offset"];
const DATE_KEYS = ["from", "to"];

// The registry describes TASK-181's full contract. Reject a query explicitly
// until its rollout wave supplies the predicate.
const DEFERRED_FILTERS: Partial<
  Record<AdminListSurface, readonly (AdminFilterKey | "from" | "to")[]>
> = {
  users: ["verified", "from", "to"],
  boards: ["adminMemberId"],
  cards: [
    "assigneeId",
    "unassigned",
    "priority",
    "due",
    "hasAttachments",
    "from",
    "to",
  ],
  cardLinks: ["type"],
  comments: ["authorId", "kind"],
  attachments: ["uploadedById", "mime", "transcode", "from", "to"],
  activity: ["actorId", "type"],
  commands: ["actorId", "type"],
  audit: ["adminId", "action", "targetType", "targetId"],
};

function unsupportedFilter(surface: AdminListSurface, filter: string): never {
  throw new BadRequestException({
    error: "Bad Request",
    code: "unsupported_filter",
    filter,
    message: `Filter ${filter} is not supported for ${surface}`,
  });
}

export function assertSupportedFilters(
  surface: AdminListSurface,
  raw: Record<string, unknown>,
): void {
  const { supported, dateRange } = ENTITY_FILTERS[surface];
  const keys = new Set<string>([
    ...LIST_KEYS,
    ...supported,
    ...(dateRange ? DATE_KEYS : []),
  ]);
  for (const key of Object.keys(raw)) {
    if (!keys.has(key)) unsupportedFilter(surface, key);
  }
  if (
    typeof raw.status === "string" &&
    !ENTITY_STATUS_VALUES[surface].includes(raw.status)
  ) {
    unsupportedFilter(surface, "status");
  }
  if (surface !== "cards" && Array.isArray(raw.labelId)) {
    throw new BadRequestException("labelId must be a single valid value");
  }
}

const validation = new ValidationPipe({
  transform: true,
  whitelist: true,
  validateCustomDecorators: true,
});

async function parseListQuery(
  surface: AdminListSurface,
  raw: Request["query"],
): Promise<AdminListQueryDto> {
  assertSupportedFilters(surface, raw);
  const query = (await validation.transform(raw, {
    type: "custom",
    metatype: AdminListQueryDto,
  })) as AdminListQueryDto;

  if (
    query.type?.some(
      (value) => parseAdminFilterValue("type", value, surface) === undefined,
    )
  ) {
    throw new BadRequestException(
      "type must contain valid values for this list",
    );
  }
  for (const key of ADMIN_FILTER_KEYS) {
    const value = query[key];
    if (Array.isArray(value))
      Object.assign(query, { [key]: canonicalAdminFilterValues(value) });
  }
  if (surface === "cards" && typeof query.labelId === "string")
    query.labelId = [query.labelId];
  if (query.labelMatch === "any" || (query.labelId?.length ?? 0) < 2)
    query.labelMatch = undefined;
  if (query.unassigned === false) query.unassigned = undefined;
  const error = adminFilterLimitError(adminFilterEntries(query, surface));
  if (error) throw new BadRequestException(error);

  const deferred = DEFERRED_FILTERS[surface]?.find(
    (key) => query[key] !== undefined,
  );
  if (deferred) {
    throw new UnprocessableEntityException({
      code: "filter_unavailable",
      filter: deferred,
      message: `Filter ${deferred} is not available yet for ${surface}`,
    });
  }
  return query;
}

/** Validate the raw query before Nest's global whitelist can discard keys. */
export const AdminListQuery = createParamDecorator(
  (
    fixedSurface: AdminListSurface | undefined,
    context,
  ): Promise<AdminListQueryDto> => {
    const request = context.switchToHttp().getRequest<Request>();
    const surface = fixedSurface ?? request.params.entity;
    if (
      fixedSurface === undefined &&
      !(ADMIN_ENTITIES as readonly unknown[]).includes(surface)
    ) {
      throw new NotFoundException(`Unknown entity: ${String(surface)}`);
    }
    return parseListQuery(surface as AdminListSurface, request.query);
  },
);
