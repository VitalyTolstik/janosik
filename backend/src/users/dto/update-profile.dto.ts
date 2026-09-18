import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import {
  DISPLAY_NAME_MAX,
  USER_AVATAR_COLORS,
  type UserAvatarColor,
} from "@janosik/shared";

/**
 * Body of `PATCH /users/me` (TASK-36.1): only provided keys are written.
 * `@IsOptional()` skips validation for `null` too, so `null` clears a field
 * (display name back to the email fallback, avatar color back to default).
 */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(DISPLAY_NAME_MAX)
  displayName?: string | null;

  @IsOptional()
  @IsIn(USER_AVATAR_COLORS)
  avatarColor?: UserAvatarColor | null;
}
