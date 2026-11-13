import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import type {
  AnnouncementDismissResponse,
  AnnouncementDto,
} from "@janosik/shared";
import { CurrentUser } from "@/auth/current-user.decorator";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import type { AuthUser } from "@/auth/auth.types";
import { CommsService } from "./comms.service";
import { DismissAnnouncementDto } from "./dto/dismiss-announcement.dto";

/**
 * In-app announcements (TASK-62) the signed-in user sees as a banner. Lives
 * in the admin module next to `CommsService` (its only source) but is reached
 * through the ordinary user auth contour — so a signed-out visitor gets
 * nothing, and a user only sees announcements addressed to them.
 *
 * Locale priority: explicit `?locale=` (the UI's current language) → the
 * account's canonical `User.locale` → `Accept-Language` → English. The query
 * parameter wins because the banner re-fetches when the interface language
 * changes, even before the profile PATCH has landed.
 */
@Controller("announcements")
export class AnnouncementsController {
  constructor(private readonly comms: CommsService) {}

  @UseGuards(JwtAuthGuard)
  @Get("active")
  active(
    @CurrentUser() user: AuthUser,
    @Query("locale") locale?: string,
    @Headers("accept-language") acceptLanguage?: string,
  ): Promise<AnnouncementDto[]> {
    return this.comms.activeFor(user.id, user.email, {
      locale,
      userLocale: user.locale ?? null,
      acceptLanguage,
    });
  }

  /**
   * Close one announcement for the signed-in user. The dismissal is stored
   * server-side and survives a new device, browser or session; the body
   * carries the version the banner showed so an announcement edited in the
   * meantime is not silently lost (409 with `currentVersion`).
   */
  @UseGuards(JwtAuthGuard)
  @Post(":id/dismiss")
  @HttpCode(HttpStatus.OK)
  dismiss(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: DismissAnnouncementDto,
  ): Promise<AnnouncementDismissResponse> {
    return this.comms.dismissAnnouncement(id, user.id, user.email, dto.version);
  }
}
