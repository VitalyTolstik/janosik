import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import type { ActivityFeedPage } from "@janosik/shared";
import { CardAccessGuard } from "@/common/card-access.guard";
import { MembershipGuard } from "@/common/membership.guard";
import { ActivityService } from "./activity.service";

/**
 * Activity feeds (§7.4, TASK-28): the board feed and the per-card history.
 * Readable by every member, VIEWER included.
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
  ): Promise<ActivityFeedPage> {
    return this.activity.boardFeed(id, cursor, limit);
  }

  @UseGuards(CardAccessGuard)
  @Get("cards/:cardId/activity")
  cardFeed(
    @Param("cardId") cardId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<ActivityFeedPage> {
    return this.activity.cardFeed(cardId, cursor, limit);
  }
}
