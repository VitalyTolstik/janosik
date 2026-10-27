import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "@/common/prisma/prisma.service";
import { env } from "@/config/env";
import { ADMIN_JWT_AUDIENCE, ADMIN_TOKEN_TYPE } from "./admin.types";
import { isIpAllowed } from "./security.service";
import type { AdminPrincipal } from "./admin.types";

interface AdminTokenPayload {
  sub: string;
  typ?: string;
}

/**
 * Master-token strategy (TASK-36). The audience pin plus the `typ` claim
 * mean a regular user token (signed with `janosik-user`) is rejected here
 * before any database work, and this strategy's tokens are equally useless
 * on user routes.
 *
 * The master's IP allowlist (TASK-65) is enforced here on *every* request,
 * not only at sign-in: a token lifted from an allowed network must not keep
 * working from anywhere else for the rest of its lifetime.
 */
@Injectable()
export class AdminJwtStrategy extends PassportStrategy(Strategy, "admin-jwt") {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: env.JWT_SECRET,
      audience: ADMIN_JWT_AUDIENCE,
      passReqToCallback: true,
    });
  }

  async validate(
    req: Request,
    payload: AdminTokenPayload,
  ): Promise<AdminPrincipal> {
    if (payload.typ !== ADMIN_TOKEN_TYPE) {
      throw new UnauthorizedException();
    }
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: payload.sub },
    });
    if (!admin || admin.disabledAt !== null) {
      throw new UnauthorizedException();
    }
    if (!isIpAllowed(admin.ipAllowlist, req.ip ?? null)) {
      throw new ForbiddenException("Access from this IP is not allowed");
    }
    return {
      id: admin.id,
      email: admin.email,
      displayName: admin.displayName,
      role: admin.role,
      createdAt: admin.createdAt.getTime(),
      lastLoginAt: admin.lastLoginAt?.getTime() ?? null,
    };
  }
}
