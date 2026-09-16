import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";

export interface HealthReport {
  status: "ok" | "error";
  db: "up" | "down";
}

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<HealthReport> {
    try {
      await this.prisma.ping();
      return { status: "ok", db: "up" };
    } catch (error) {
      this.prisma.logError("health: db ping failed", error);
      throw new HttpException(
        { status: "error", db: "down" } satisfies HealthReport,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
