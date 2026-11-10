import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { ActivityFeedPage } from "@janosik/shared";
import { CardAccessGuard } from "@/common/card-access.guard";
import { MembershipGuard } from "@/common/membership.guard";
import { ActivityService, type ActivityFilters } from "./activity.service";

/**
 * Activity feeds (§7.4, TASK-28): the board feed and the per-card history.
 * Readable by every member, VIEWER included. TASK-166 adds audit filters
 * (`actorType`, `apiTokenId`, `agentSessionId`, `runId`, `type`, `from`,
 * `to`) shared by Watch and the future Audit UI.
 */
@Controller()
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @UseGuards(MembershipGuard)
  @Get("boards/:id/activity")
  boardFeed(
    @Param("id") id: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
    @Query("actorType") actorType?: string,
    @Query("apiTokenId") apiTokenId?: string,
    @Query("agentSessionId") agentSessionId?: string,
    @Query("runId") runId?: string,
    @Query("type") type?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ): Promise<ActivityFeedPage> {
    return this.activity.boardFeed(
      id,
      cursor,
      limit,
      filters({ actorType, apiTokenId, agentSessionId, runId, type, from, to }),
    );
  }

  @UseGuards(CardAccessGuard)
  @Get("cards/:cardId/activity")
  cardFeed(
    @Param("cardId") cardId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
    @Query("actorType") actorType?: string,
    @Query("apiTokenId") apiTokenId?: string,
    @Query("agentSessionId") agentSessionId?: string,
    @Query("runId") runId?: string,
    @Query("type") type?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ): Promise<ActivityFeedPage> {
    return this.activity.cardFeed(
      cardId,
      cursor,
      limit,
      filters({ actorType, apiTokenId, agentSessionId, runId, type, from, to }),
    );
  }
}

function filters(raw: {
  actorType?: string;
  apiTokenId?: string;
  agentSessionId?: string;
  runId?: string;
  type?: string;
  from?: string;
  to?: string;
}): ActivityFilters {
  return {
    ...(nonEmpty(raw.actorType) ? { actorType: raw.actorType } : {}),
    ...(nonEmpty(raw.apiTokenId) ? { apiTokenId: raw.apiTokenId } : {}),
    ...(nonEmpty(raw.agentSessionId)
      ? { agentSessionId: raw.agentSessionId }
      : {}),
    ...(nonEmpty(raw.runId) ? { runId: raw.runId } : {}),
    ...(nonEmpty(raw.type) ? { type: raw.type } : {}),
    ...(nonEmpty(raw.from) ? { from: parseTime(raw.from, "from") } : {}),
    ...(nonEmpty(raw.to) ? { to: parseTime(raw.to, "to") } : {}),
  };
}

function nonEmpty(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

/** Accept Unix ms or an ISO-8601 timestamp; anything else is a 400. */
function parseTime(raw: string, field: string): Date {
  const numeric = Number(raw);
  const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${field} must be a timestamp`);
  }
  return date;
}
