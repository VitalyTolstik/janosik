import { Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

/** Guard for routes behind the JWT access token (§7.2). */
@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {}
