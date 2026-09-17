import { IsString, Matches } from "class-validator";

/**
 * Body of the presence heartbeat (TASK-36): the tab-scoped id the SSE
 * stream was opened with. Validated strictly — the id is only ever a map
 * key and must not become a free-form payload.
 */
export class PresencePingDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{8,64}$/, {
    message: "clientId must be 8-64 URL-safe characters",
  })
  clientId!: string;
}
