import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  AdminAnnouncementDto,
  AdminCreateAnnouncementRequest,
  AdminEmailTemplateDto,
  AdminSendEmailResponse,
  AdminUpdateAnnouncementRequest,
  AnnouncementDto,
} from "@janosik/shared";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";
import { MailerService } from "@/mailer/mailer.service";
import { BroadcastQueueService } from "@/ops/broadcast-queue.service";
import { EmailTemplateService } from "@/ops/email-template.service";

/**
 * Communications (TASK-62): user mail, in-app announcements and the editable
 * mail templates. Sending reuses the single mailer (TASK-52 transport); the
 * templates layer (TASK-62) overrides the built-in letters at send time.
 */
@Injectable()
export class CommsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly templates: EmailTemplateService,
    private readonly broadcasts: BroadcastQueueService,
  ) {}

  // --------------------------------------------------------- announcements

  private toAnnouncement(row: {
    id: string;
    title: string;
    body: string;
    level: string;
    audience: string;
    segment: string | null;
    active: boolean;
    sendEmail: boolean;
    startsAt: Date | null;
    endsAt: Date | null;
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
  }): AdminAnnouncementDto {
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      level: row.level as AdminAnnouncementDto["level"],
      audience: row.audience as AdminAnnouncementDto["audience"],
      segment: row.segment,
      active: row.active,
      sendEmail: row.sendEmail,
      startsAt: row.startsAt?.getTime() ?? null,
      endsAt: row.endsAt?.getTime() ?? null,
      createdBy: row.createdBy,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    };
  }

  async listAnnouncements(): Promise<AdminAnnouncementDto[]> {
    const rows = await this.prisma.announcement.findMany({
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.toAnnouncement(row));
  }

  async createAnnouncement(
    dto: AdminCreateAnnouncementRequest,
    createdBy: string,
  ): Promise<AdminAnnouncementDto> {
    const row = await this.prisma.announcement.create({
      data: {
        title: dto.title,
        body: dto.body,
        level: dto.level ?? "info",
        audience: dto.audience ?? "all",
        segment: dto.segment ?? null,
        active: dto.active ?? true,
        sendEmail: dto.sendEmail ?? false,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        createdBy,
      },
    });
    // Optional email fan-out (TASK-62): queued in the background so the
    // request returns immediately; a no-op when the mailer is in log mode.
    if (row.sendEmail && this.mailer.enabled) {
      const emails = await this.recipientEmails(row.audience, row.segment);
      this.broadcasts.enqueue({
        emails,
        subject: row.title,
        text: row.body,
        html: this.broadcastHtml(row.title, row.body),
      });
    }
    return this.toAnnouncement(row);
  }

  /** Resolves the inbox list an announcement should reach. */
  private async recipientEmails(
    audience: string,
    segment: string | null,
  ): Promise<string[]> {
    if (audience === "segment") {
      return (segment ?? "")
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry.length > 0);
    }
    const users = await this.prisma.user.findMany({
      where: { disabledAt: null },
      select: { email: true },
    });
    return users.map((user) => user.email);
  }

  private broadcastHtml(title: string, body: string): string {
    const escape = (value: string) =>
      value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    return `<div><h2>${escape(title)}</h2>${body
      .split("\n")
      .map((line) => `<p>${escape(line)}</p>`)
      .join("")}</div>`;
  }

  async updateAnnouncement(
    id: string,
    dto: AdminUpdateAnnouncementRequest,
  ): Promise<AdminAnnouncementDto> {
    const data: Prisma.AnnouncementUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.body !== undefined) data.body = dto.body;
    if (dto.level !== undefined) data.level = dto.level;
    if (dto.audience !== undefined) data.audience = dto.audience;
    if (dto.segment !== undefined) data.segment = dto.segment;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.startsAt !== undefined)
      data.startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
    if (dto.endsAt !== undefined)
      data.endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    const exists = await this.prisma.announcement.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException("Announcement not found");
    const row = await this.prisma.announcement.update({ where: { id }, data });
    return this.toAnnouncement(row);
  }

  async deleteAnnouncement(id: string): Promise<void> {
    await this.prisma.announcement.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("Announcement not found");
    });
  }

  /** Active announcements for the signed-in user's app banner. */
  async activeFor(email: string): Promise<AnnouncementDto[]> {
    const now = new Date();
    const rows = await this.prisma.announcement.findMany({
      where: {
        active: true,
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
      },
      orderBy: { createdAt: "desc" },
    });
    return rows
      .filter(
        (row) =>
          row.audience === "all" ||
          (row.segment ?? "")
            .split(",")
            .map((entry) => entry.trim().toLowerCase())
            .includes(email.toLowerCase()),
      )
      .map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        level: row.level as AnnouncementDto["level"],
      }));
  }

  // ------------------------------------------------------------------- mail

  async sendEmail(
    to: string,
    subject: string,
    body: string,
  ): Promise<AdminSendEmailResponse> {
    const html = `<div>${body
      .split("\n")
      .map(
        (line) => `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`,
      )
      .join("")}</div>`;
    try {
      await this.mailer.send({ to, subject, text: body, html });
      return { ok: true, error: null };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Send failed",
      };
    }
  }

  async listTemplates(): Promise<AdminEmailTemplateDto[]> {
    return this.templates.list();
  }

  async updateTemplate(
    key: string,
    patch: { subject: string; bodyHtml: string },
    updatedBy: string,
  ): Promise<AdminEmailTemplateDto> {
    const row = await this.templates.update(key, patch, updatedBy);
    const catalog = await this.templates.list();
    const label = catalog.find((entry) => entry.key === key)?.label ?? key;
    return { ...row, label };
  }
}
