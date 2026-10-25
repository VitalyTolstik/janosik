import { Controller, Get, UseGuards } from "@nestjs/common";
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
 */
@Controller("announcements")
export class AnnouncementsController {
  constructor(private readonly comms: CommsService) {}

  @UseGuards(JwtAuthGuard)
  @Get("active")
  active(@CurrentUser() user: AuthUser): Promise<AnnouncementDto[]> {
    return this.comms.activeFor(user.email);
  }
}
