import { Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

/** Guards every `/admin/*` route: master tokens only (TASK-36). */
@Injectable()
export class AdminJwtAuthGuard extends AuthGuard("admin-jwt") {}
