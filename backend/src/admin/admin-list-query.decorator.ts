import {
  BadRequestException,
  createParamDecorator,
  NotFoundException,
  ValidationPipe,
} from "@nestjs/common";
import type { Request } from "express";
import {
  ADMIN_ENTITIES,
  ENTITY_FILTERS,
  ENTITY_STATUS_VALUES,
  adminFilterEntries,
  adminFilterLimitError,
  parseAdminFilterValue,
  type AdminListSurface,
} from "@janosik/shared";
import { AdminListQueryDto } from "./dto/admin-list-query.dto";

const LIST_KEYS = ["search", "status", "limit", "offset"];
const DATE_KEYS = ["from", "to"];

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
  const { implemented, dateRange } = ENTITY_FILTERS[surface];
  const keys = new Set<string>([
    ...LIST_KEYS,
    ...implemented,
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
  if (surface === "cards" && Array.isArray(raw.labelId)) {
    unsupportedFilter(surface, "labelId");
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
  const error = adminFilterLimitError(adminFilterEntries(query, surface));
  if (error) throw new BadRequestException(error);
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
