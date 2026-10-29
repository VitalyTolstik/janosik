import { Injectable, Logger, Module, type OnModuleInit } from "@nestjs/common";
import { HttpAdapterHost, ModuleRef } from "@nestjs/core";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { getQueueToken } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import type { Request, Response, NextFunction } from "express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { PrismaService } from "@/common/prisma/prisma.service";
import { env } from "@/config/env";
import { isIpAllowed } from "@/admin/security.service";
import { QUEUE_NAMES, queuesEnabled } from "@/ops/queue-core";
import {
  ADMIN_JWT_AUDIENCE,
  ADMIN_QUEUES_JWT_AUDIENCE,
  ADMIN_QUEUES_TOKEN_TYPE,
  ADMIN_TOKEN_TYPE,
} from "@/admin/admin.types";

/** httpOnly cookie the panel sets before opening the dashboard tab. */
export const ADMIN_QUEUES_COOKIE = "admin_queues";
export const ADMIN_QUEUES_PATH = "/api/v1/admin/queues";
/** Ticket lifetime — long enough to open a tab, short enough to stay safe. */
export const ADMIN_QUEUES_TICKET_TTL = "10m";

/**
 * Whether this admin may open the queue dashboard from `ip` (TASK-147, B6).
 * The dashboard is mounted straight on Express, outside Nest's guard
 * pipeline, so it never passes through `AdminJwtAuthGuard` — the IP allowlist
 * that protects every `/admin/*` route has to be applied here too, or the
 * board is a way around it.
 */
export function queueDashboardOwner(
  admin: {
    role: string;
    disabledAt: Date | null;
    ipAllowlist: string | null;
  },
  ip: string | null,
): boolean {
  return (
    admin.disabledAt === null &&
    admin.role === "OWNER" &&
    isIpAllowed(admin.ipAllowlist, ip)
  );
}

/**
 * TASK-73 — the Bull Board queue dashboard. Mounted at
 * `/api/v1/admin/queues` only when `QUEUES_DASHBOARD=true` and Redis is
 * configured. The SPA is a separate app (its own JS/CSS), so it is mounted
 * on the Express instance rather than as a Nest route; access is gated by a
 * short-lived, httpOnly ticket cookie (`POST /admin/queue-ticket`, OWNER
 * only) or a live admin Bearer token — a plain browser navigation cannot
 * send the Authorization header, hence the cookie.
 */
@Injectable()
export class QueuesBoardService implements OnModuleInit {
  private readonly logger = new Logger(QueuesBoardService.name);

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly moduleRef: ModuleRef,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  /** Resolve a queue registered in another module (registerQueue tokens). */
  private resolve(name: string): Queue | undefined {
    try {
      return this.moduleRef.get<Queue>(getQueueToken(name), { strict: false });
    } catch {
      return undefined;
    }
  }

  onModuleInit(): void {
    if (!queuesEnabled || !env.QUEUES_DASHBOARD) return;
    const queues = Object.values(QUEUE_NAMES)
      .map((name) => this.resolve(name))
      .filter((queue): queue is Queue => queue !== undefined);
    if (queues.length === 0) return;

    const serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath(ADMIN_QUEUES_PATH);
    createBullBoard({
      queues: queues.map((queue) => new BullMQAdapter(queue)),
      serverAdapter,
    });
    const router = serverAdapter.getRouter();
    const app = this.adapterHost.httpAdapter.getInstance();
    app.use(
      ADMIN_QUEUES_PATH,
      (req: Request, res: Response, next: NextFunction) =>
        void this.authorize(req, res, next),
      router,
    );
    this.logger.log(`Queue dashboard mounted at ${ADMIN_QUEUES_PATH}`);
  }

  /** Ticket cookie or admin Bearer token; must be an OWNER master. */
  private async authorize(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const ticket = (req.cookies as Record<string, string> | undefined)?.[
      ADMIN_QUEUES_COOKIE
    ];
    const bearer = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : undefined;
    if (!ticket && !bearer) {
      res
        .status(401)
        .json({ message: "Queue dashboard requires an admin ticket" });
      return;
    }
    try {
      // TASK-90: a cookie ticket carries the queues-only audience/typ and is
      // useless on `/admin/*`; a Bearer token is a real admin access token.
      const payload = ticket
        ? await this.jwt.verifyAsync<{ sub: string; typ?: string }>(ticket, {
            secret: env.JWT_SECRET,
            audience: ADMIN_QUEUES_JWT_AUDIENCE,
          })
        : await this.jwt.verifyAsync<{ sub: string; typ?: string }>(bearer!, {
            secret: env.JWT_SECRET,
            audience: ADMIN_JWT_AUDIENCE,
          });
      const expectedTyp = ticket ? ADMIN_QUEUES_TOKEN_TYPE : ADMIN_TOKEN_TYPE;
      if (payload.typ !== expectedTyp) throw new Error("wrong token type");
      const admin = await this.prisma.adminUser.findUnique({
        where: { id: payload.sub },
      });
      if (!admin || !queueDashboardOwner(admin, req.ip ?? null)) {
        throw new Error("not an allowed owner");
      }
      next();
    } catch {
      res.status(401).json({ message: "Queue dashboard access denied" });
    }
  }
}

@Module({
  imports: [JwtModule.register({ secret: env.JWT_SECRET })],
  providers: [QueuesBoardService],
})
export class QueuesModule {}
