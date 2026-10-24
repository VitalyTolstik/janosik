import {
  IsBoolean,
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

  /** Number of demo agents (and cards). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  users?: number;

  /** Let the agents act immediately; `false` seeds and waits. */
  @IsOptional()
  @IsBoolean()
  run?: boolean;
}
