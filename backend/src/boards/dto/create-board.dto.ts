import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";
import {
  BOARD_STARTER_LOCALES,
  BOARD_TEMPLATE_IDS,
  LIMITS,
  type BoardStarterLocale,
  type BoardTemplateSelection,
} from "@janosik/shared";

/** Body of `POST /boards` — one source of truth for the title bound. */
export class CreateBoardDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(LIMITS.boardTitle)
  title!: string;

  /**
   * TASK-177.16: first-run example. Omitted/empty creates an empty board as
   * before; `starter` keeps the legacy welcome board, the six catalog ids
   * create the curated structures.
   */
  @IsOptional()
  @IsIn([...BOARD_TEMPLATE_IDS, "starter"])
  template?: BoardTemplateSelection;

  /** Copy language for the template columns/cards/checklists. Defaults `en`. */
  @IsOptional()
  @IsIn(BOARD_STARTER_LOCALES)
  templateLocale?: BoardStarterLocale;

  /**
   * The client's local creation date (`YYYY-MM-DD`). Due offsets are counted
   * from this calendar date at 12:00 UTC, so browser preview and API creation
   * cannot disagree because they run in different timezones.
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  templateDate?: string;
}
