import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "@/common/prisma/prisma.service";
import { env } from "@/config/env";
import { toAuthUser } from "./auth-user.mapper";
import { USER_JWT_AUDIENCE } from "./auth.types";
import type { AuthUser } from "./auth.types";

interface AccessTokenPayload {
  sub: string;
  /** "admin" on master-account tokens — rejected here (§TASK-36). */
  typ?: string;
}

/** Validates the Bearer access token and loads the user it was issued for. */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: env.JWT_SECRET,
      // Audience isolation (TASK-36): admin tokens carry `janosik-admin`
      // and are refused before the payload is even looked at.
      audience: USER_JWT_AUDIENCE,
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthUser> {
    if (payload.typ === "admin") {
      throw new UnauthorizedException();
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || user.disabledAt !== null) {
      throw new UnauthorizedException();
    }
    return toAuthUser(user);
  }
}
