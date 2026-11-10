import { IsOptional, IsString, MaxLength } from "class-validator";

/** `POST /users/me/delete/request-code` (TASK-166 §12.5). */
export class RequestAccountDeletionCodeDto {
  /**
   * An access token minted by an OAuth login, at most ten minutes old. A
   * password JWT or a PAT is not accepted as proof.
   */
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  oauthProof?: string;
}
