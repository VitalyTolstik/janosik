import { Module } from "@nestjs/common";
import { AuthModule } from "@/auth/auth.module";
import { InvitationsController } from "./invitations.controller";
import { InvitationsService } from "./invitations.service";

/** Pending invitations feed: list / accept / decline (TASK-35 addendum). */
@Module({
  imports: [AuthModule],
  controllers: [InvitationsController],
  providers: [InvitationsService],
})
export class InvitationsModule {}
