import { Global, Module } from "@nestjs/common";
import { SecurityAuditService } from "./security-audit.service";

/**
 * Global like `PrismaModule`: token, board, account and run lifecycle events
 * are written from several feature modules without threading the provider
 * through each one.
 */
@Global()
@Module({
  providers: [SecurityAuditService],
  exports: [SecurityAuditService],
})
export class SecurityAuditModule {}
