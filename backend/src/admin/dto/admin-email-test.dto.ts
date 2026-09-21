import { IsEmail, MaxLength } from "class-validator";

/** `POST /admin/email-settings/test` (TASK-52) — probe delivery address. */
export class AdminEmailTestDto {
  @IsEmail()
  @MaxLength(255)
  to!: string;
}
