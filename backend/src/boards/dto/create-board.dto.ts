import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";
import {
  BOARD_STARTER_LOCALES,
  LIMITS,
  type BoardStarterLocale,
} from "@janosik/shared";

/** Body of `POST /boards` — one source of truth for the title bound. */
export class CreateBoardDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(LIMITS.boardTitle)
  title!: string;

  /**
   * TASK-177.16: first-run example. Omitted/empty creates an empty board as
   * before; `starter` adds three columns, a welcome card and a checklist.
   */
  @IsOptional()
  @IsIn(["starter"])
  template?: "starter";

  /** Copy language for the starter columns/card/checklist. Defaults to `en`. */
  @IsOptional()
  @IsIn(BOARD_STARTER_LOCALES)
  templateLocale?: BoardStarterLocale;
}
