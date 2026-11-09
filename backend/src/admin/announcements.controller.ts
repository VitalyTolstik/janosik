import { Controller, Get, Headers, Query, UseGuards } from "@nestjs/common";
import type { AnnouncementDto } from "@janosik/shared";
import { CurrentUser } from "@/auth/current-user.decorator";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import type { AuthUser } from "@/auth/auth.types";
import { CommsService } from "./comms.service";

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
    return this.comms.activeFor(user.email, {
      locale,
      userLocale: user.locale ?? null,
      acceptLanguage,
    });
  }
}
