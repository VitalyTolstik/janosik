import { Global, Module } from "@nestjs/common";
import { AttachmentsModule } from "@/attachments/attachments.module";
import { BoardsModule } from "@/boards/boards.module";
import { AccountDeletionService } from "./account-deletion.service";

/**
 * TASK-166: account erasure is used by the account panel, the master panel
 * and the maintenance sweep. Global so the ops scheduler can call it without
 * importing the user API module.
 */
@Global()
@Module({
  imports: [AttachmentsModule, BoardsModule],
  providers: [AccountDeletionService],
  exports: [AccountDeletionService],
})
export class AccountDeletionModule {}
