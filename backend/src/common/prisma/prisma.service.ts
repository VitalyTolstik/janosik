import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { env } from "@/config/env";
import { currentRequestId } from "@/common/request-context";

/**
 * Add a Prisma pool cap to a connection string unless one is already there
 * (TASK-153, B14). Returns the URL untouched for a non-URL value so a
 * misconfigured DSN still reaches Prisma's own error message.
 */
export function withConnectionLimit(url: string, limit: number): string {
  if (limit <= 0) return url;
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("connection_limit")) return url;
    parsed.searchParams.set("connection_limit", String(limit));
    return parsed.toString();
  } catch {
    return url;
  }
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      datasources: {
        db: {
          url: withConnectionLimit(env.DATABASE_URL, env.DB_CONNECTION_LIMIT),
        },
      },
      // TASK-153: slow queries are logged (and a request id travels with them
      // through the request context) instead of silently happening. Query
      // events are always subscribed; the listener filters by `SLOW_QUERY_MS`.
      log: [{ emit: "event", level: "query" }],
    });
    // The constructor's conditional log config widens Prisma's event typing,
    // so the listener signature is stated here instead of inferred.
    const onQuery = this.$on.bind(this) as (
      event: "query",
      listener: (event: Prisma.QueryEvent) => void,
    ) => void;
    onQuery("query", (event) => {
      if (event.duration >= env.SLOW_QUERY_MS) {
        const requestId = currentRequestId();
        this.logger.warn(
          `slow query ${event.duration} ms${
            requestId !== undefined ? ` [request ${requestId}]` : ""
          }: ${event.query.slice(0, 300)}`,
        );
      }
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Lightweight DB liveness probe for /health. */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }

  logError(message: string, error: unknown): void {
    this.logger.error(message, error instanceof Error ? error.stack : error);
  }
}
