import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Лёгкая проверка живости БД для /health. */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }

  logError(message: string, error: unknown): void {
    this.logger.error(message, error instanceof Error ? error.stack : error);
  }
}
