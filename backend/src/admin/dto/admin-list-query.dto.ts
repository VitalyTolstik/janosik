import { Transform } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateBy,
} from "class-validator";
import {
  ADMIN_FILTER_QUERY_MAX_LENGTH,
  ADMIN_PAGE_LIMITS,
  adminFilterValueLimit,
  parseAdminFilterValue,
  type AdminFilterKey,
  type AdminFilterValues,
  type AdminFilters,
} from "@janosik/shared";

export { ADMIN_ID_PATTERN } from "@janosik/shared";

function trim(value: unknown): unknown {
  return typeof value === "string" ? value.trim() : value;
}

function numberValue({ value }: { value: unknown }): unknown {
  return typeof value === "string" && value.trim() !== ""
    ? Number(value)
    : value;
}

function optionalNumberValue({ value }: { value: unknown }): unknown {
  return typeof value === "string" && value.trim() === ""
    ? undefined
    : numberValue({ value });
}

/** Normalize repeated values before validating their distinct count. */
function FilterField(
  key: AdminFilterKey,
  { optionalEmpty = false } = {},
): PropertyDecorator {
  const limit = adminFilterValueLimit(key);
  return (target, property) => {
    IsOptional()(target, property);
    Transform(({ value }: { value: unknown }) => {
      if (optionalEmpty && typeof value === "string" && value.trim() === "") {
        return undefined;
      }
      const parse = (entry: unknown) =>
        parseAdminFilterValue(key, entry) ?? entry;
      if (limit > 1) {
        return [
          ...new Set((Array.isArray(value) ? value : [value]).map(parse)),
        ];
      }
      return parse(value);
    })(target, property);
    ValidateBy({
      name: "adminFilterValue",
      validator: {
        validate(value: unknown) {
          if (!Array.isArray(value)) {
            return (
              limit === 1 && parseAdminFilterValue(key, value) !== undefined
            );
          }
          return (
            limit > 1 &&
            value.length > 0 &&
            value.length <= limit &&
            value.every(
              (entry) => parseAdminFilterValue(key, entry) !== undefined,
            )
          );
        },
        defaultMessage() {
          return limit === 1
            ? `${key} must be a single valid value`
            : `${key} must contain between 1 and ${limit} valid values`;
        },
      },
    })(target, property);
  };
}

export class AdminListQueryDto implements AdminFilters {
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(ADMIN_FILTER_QUERY_MAX_LENGTH)
  search?: string;

  @IsOptional()
  @Transform(numberValue)
  @IsInt()
  @Min(ADMIN_PAGE_LIMITS.min)
  @Max(ADMIN_PAGE_LIMITS.max)
  limit?: number;

  @IsOptional()
  @Transform(optionalNumberValue)
  @IsInt()
  @Min(0)
  @Max(ADMIN_PAGE_LIMITS.maxOffset)
  offset?: number;

  @IsOptional()
  @IsIn(["all", "active", "disabled", "archived", "deleted"])
  status?: "all" | "active" | "disabled" | "archived" | "deleted";

  /** Inclusive bounds on createdAt, in unix milliseconds. */
  @IsOptional()
  @Transform(optionalNumberValue)
  @IsInt()
  @Min(0)
  @Max(8.64e15)
  from?: number;

  @IsOptional()
  @Transform(optionalNumberValue)
  @IsInt()
  @Min(0)
  @Max(8.64e15)
  to?: number;

  @FilterField("boardId", { optionalEmpty: true })
  boardId?: string;

  @FilterField("columnId", { optionalEmpty: true })
  columnId?: string;

  @FilterField("labelId", { optionalEmpty: true })
  labelId?: string;

  /** Used by lists that retain TASK-176.6's single-label contract. */
  get singleLabelId(): string | undefined {
    return this.labelId;
  }

  @FilterField("cardId", { optionalEmpty: true })
  cardId?: string;

  @FilterField("commandId")
  commandId?: string;

  @FilterField("labelMatch")
  labelMatch?: AdminFilterValues["labelMatch"];

  @FilterField("assigneeId")
  assigneeId?: string[];

  @FilterField("unassigned")
  unassigned?: boolean;

  @FilterField("priority")
  priority?: AdminFilterValues["priority"];

  @FilterField("due")
  due?: AdminFilterValues["due"];

  @FilterField("hasAttachments")
  hasAttachments?: boolean;

  @FilterField("adminMemberId", { optionalEmpty: true })
  adminMemberId?: string;

  @FilterField("verified")
  verified?: boolean;

  @FilterField("authorId")
  authorId?: string[];

  @FilterField("kind")
  kind?: AdminFilterValues["kind"];

  @FilterField("uploadedById")
  uploadedById?: string[];

  @FilterField("mime")
  mime?: AdminFilterValues["mime"];

  @FilterField("transcode")
  transcode?: AdminFilterValues["transcode"];

  @FilterField("actorId")
  actorId?: string[];

  @FilterField("type")
  type?: string[];

  @FilterField("action")
  action?: string[];

  @FilterField("adminId")
  adminId?: string[];

  @FilterField("targetType")
  targetType?: string[];

  @FilterField("targetId")
  targetId?: string;
}
