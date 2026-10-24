import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";

/** Body of `POST /admin/demo/start` (TASK-57). */
export class AdminDemoStartDto {
  /** Board to populate; a dedicated "Демо" board is created when omitted. */
  @IsOptional()
  @IsString()
  boardId?: string;

  /** Account that will own the dedicated demo board (watch it in the app). */
  @IsOptional()
  @IsEmail()
  watcherEmail?: string;

  /** Number of demo agents. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  users?: number;

  /** Number of cards to seed (defaults to the agent count). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  cards?: number;

  /** Let the agents act immediately; `false` seeds and waits. */
  @IsOptional()
  @IsBoolean()
  run?: boolean;
}
