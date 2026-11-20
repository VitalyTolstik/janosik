import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateBy,
} from "class-validator";
import {
  ADMIN_FILTER_CODE_PATTERN,
  ADMIN_FILTER_MAX_VALUES,
  ADMIN_FILTER_OPTION_LIMITS,
  ADMIN_FILTER_OPTION_TYPES,
  ADMIN_FILTER_QUERY_MAX_LENGTH,
  ADMIN_ID_PATTERN,
  type AdminFilterOptionsQuery,
  type AdminFilterOptionType,
} from "@janosik/shared";

const trim = (value: unknown): unknown =>
  typeof value === "string" ? value.trim() : value;

export class AdminFilterOptionsQueryDto implements AdminFilterOptionsQuery {
  @IsIn(ADMIN_FILTER_OPTION_TYPES)
  type!: AdminFilterOptionType;

  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(ADMIN_FILTER_QUERY_MAX_LENGTH)
  q?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    (Array.isArray(value) ? value : [value]).map(trim),
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ADMIN_FILTER_MAX_VALUES)
  @ValidateBy({
    name: "filterOptionIds",
    validator: {
      validate(value: unknown, args) {
        const { type } = args?.object as AdminFilterOptionsQuery;
        const isCode =
          type === "action" ||
          type === "commandType" ||
          type === "activityType" ||
          type === "targetType";
        const pattern = isCode ? ADMIN_FILTER_CODE_PATTERN : ADMIN_ID_PATTERN;
        return (
          Array.isArray(value) &&
          value.every(
            (id: unknown) => typeof id === "string" && pattern.test(id),
          )
        );
      },
      defaultMessage: () => "ids must contain valid ids for this lookup type",
    },
  })
  ids?: string[];

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" && value.trim() !== "" ? Number(value) : value,
  )
  @IsInt()
  @Min(ADMIN_FILTER_OPTION_LIMITS.min)
  @Max(ADMIN_FILTER_OPTION_LIMITS.max)
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => trim(value))
  @Matches(ADMIN_ID_PATTERN)
  boardId?: string;

  @IsOptional()
  @Transform(({ value }) => trim(value))
  @Matches(ADMIN_ID_PATTERN)
  columnId?: string;

  @IsOptional()
  @Transform(({ value }) => trim(value))
  @Matches(ADMIN_ID_PATTERN)
  cardId?: string;
}
