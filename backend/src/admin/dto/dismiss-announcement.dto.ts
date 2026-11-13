import { IsInt, Min } from "class-validator";

/**
 * Body of `POST /announcements/:id/dismiss` — the announcement version the
 * banner showed. A stale version (an admin edited the row meanwhile) is
 * answered with `409 currentVersion`; the UI then refetches and shows the
 * updated text instead of silently closing it.
 */
export class DismissAnnouncementDto {
  @IsInt()
  @Min(1)
  version!: number;
}
