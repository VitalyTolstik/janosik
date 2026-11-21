import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "@/app.module";
import { setupApp } from "@/common/app-setup";
import { PrismaService } from "@/common/prisma/prisma.service";
import { wipeAll } from "./support/wipe";

const INDEXES = [
  "Attachment_createdAt_idx",
  "Attachment_uploadedById_createdAt_idx",
  "Attachment_mimeFamily_createdAt_idx",
  "Attachment_transcodeStatus_createdAt_idx",
  "Attachment_boardId_createdAt_idx",
  "Card_columnId_deletedAt_idx",
  "Card_id_deletedAt_idx",
  "Card_createdAt_idx",
  "Card_priority_updatedAt_idx",
  "Card_attachmentCount_updatedAt_idx",
  "Card_columnId_id_idx",
  "CardLabel_labelId_cardId_idx",
  "CardLink_createdAt_idx",
  "CardLink_type_createdAt_idx",
  "CardLink_boardId_type_createdAt_idx",
  "Column_boardId_id_idx",
  "Comment_authorId_createdAt_idx",
  "Comment_kind_createdAt_idx",
  "Comment_createdAt_idx",
  "User_createdAt_idx",
  "AdminAuditLog_targetType_createdAt_idx",
];

/**
 * TASK-181.7 — the MIME family column/trigger and the measured indexes are
 * schema objects, not just migration text. This pins the upgrade result.
 */
describe("Admin MIME family migration (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await wipeAll(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it("has the column, trigger and every measured index", async () => {
    const [column] = await prisma.$queryRaw<
      { is_nullable: string; column_default: string | null }[]
    >`SELECT is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Attachment'
        AND column_name = 'mimeFamily'`;
    expect(column?.is_nullable).toBe("NO");
    expect(column?.column_default).toContain("other");

    const triggers = await prisma.$queryRaw<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger
      WHERE tgname = 'Attachment_mime_family_trigger'`;
    expect(triggers).toHaveLength(1);

    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`;
    const names = new Set(rows.map((row) => row.indexname));
    for (const index of INDEXES) expect(names.has(index)).toBe(true);
  });

  it("maps mixed-case MIME types and follows a mimeType update", async () => {
    await prisma.board.create({
      data: { id: "mime-migration-board", title: "MIME migration" },
    });
    await prisma.column.create({
      data: {
        id: "mime-migration-column",
        boardId: "mime-migration-board",
        title: "Todo",
        position: 0,
      },
    });
    await prisma.card.create({
      data: {
        id: "mime-migration-card",
        columnId: "mime-migration-column",
        title: "MIME migration",
        position: 0,
      },
    });
    await prisma.user.create({
      data: {
        id: "mime-migration-user",
        email: "mime-migration@example.com",
        passwordHash: "unused",
      },
    });

    const family = async (mimeType: string) => {
      const safe = mimeType.replaceAll(/[^a-z0-9]/gi, "-");
      const row = await prisma.attachment.create({
        data: {
          id: `mime-${safe}`,
          cardId: "mime-migration-card",
          boardId: "mime-migration-board",
          fileName: "file",
          storedName: `stored-${safe}`,
          mimeType,
          sizeBytes: 1,
          uploadedById: "mime-migration-user",
        },
      });
      return row.mimeFamily;
    };

    await expect(family("IMAGE/PNG")).resolves.toBe("image");
    await expect(family("Video/MP4")).resolves.toBe("video");
    await expect(family("APPLICATION/PDF")).resolves.toBe("pdf");
    await expect(family("TEXT/PLAIN")).resolves.toBe("document");
    await expect(family("application/json")).resolves.toBe("other");

    await prisma.attachment.update({
      where: { id: "mime-APPLICATION-PDF" },
      data: { mimeType: "image/gif" },
    });
    const updated = await prisma.attachment.findUniqueOrThrow({
      where: { id: "mime-APPLICATION-PDF" },
    });
    expect(updated.mimeFamily).toBe("image");
  });
});
