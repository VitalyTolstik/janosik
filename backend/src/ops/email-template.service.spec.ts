import type { PrismaService } from "@/common/prisma/prisma.service";
import { EMAIL_TEMPLATE_DEFAULTS } from "@/mailer/templates";
import { EmailTemplateService } from "./email-template.service";

/**
 * TASK-177.20: an operator who saves the built-in assignment template without
 * editing it must not get “1 cards” or a board-only closing line. The default
 * is deliberately neutral for every count, and the text alternative keeps
 * escaped card titles literal instead of turning them into links.
 */
describe("EmailTemplateService saved defaults", () => {
  function service(
    key = "attention_card_assigned",
    overrides: { subject?: string; bodyHtml?: string } = {},
  ) {
    const fallback = EMAIL_TEMPLATE_DEFAULTS[key]!;
    const prisma = {
      emailTemplate: {
        findUnique: jest.fn().mockResolvedValue({
          key,
          subject: overrides.subject ?? fallback.subject,
          bodyHtml: overrides.bodyHtml ?? fallback.bodyHtml,
        }),
      },
    } as unknown as PrismaService;
    return new EmailTemplateService(prisma);
  }

  it("renders a saved one-card default without plural or board-only copy", async () => {
    const rendered = await service().attentionEmail(
      "card.assigned",
      { board: "Board", cards: "Ship it", count: 1, actor: "Alice" },
      "en",
    );

    expect(rendered.text).toContain("Card assignment on board");
    expect(rendered.text).toContain("Ship it");
    expect(rendered.text).toContain("Open the card or board");
    expect(rendered.text).not.toContain("1 cards");
    expect(rendered.text).not.toContain("{{count}}");
  });

  it("renders the saved default without an empty actor phrase", async () => {
    const rendered = await service().attentionEmail(
      "card.assigned",
      { board: "Board", cards: "Ship it", count: 1 },
      "en",
    );

    expect(rendered.text).toContain("Card assignment on board");
    expect(rendered.text).not.toContain("from  on");
    expect(rendered.text).not.toContain("{{actor}}");
  });

  it("does not advertise the removed count placeholder", () => {
    expect(
      EMAIL_TEMPLATE_DEFAULTS.attention_card_assigned!.placeholders,
    ).not.toContain("count");
    expect(
      EMAIL_TEMPLATE_DEFAULTS.attention_card_assigned!.bodyHtml,
    ).not.toContain("{{count}}");
  });

  it("keeps an escaped anchor in a saved default literal", async () => {
    const rendered = await service().attentionEmail(
      "card.assigned",
      {
        board: "Board",
        cards: '<a href="https://evil.example">Evil card</a>',
        count: 1,
        actor: "Alice",
      },
      "en",
    );

    expect(rendered.text).toContain("Evil card");
    expect(rendered.text).not.toContain("https://evil.example");
  });

  it("renders an unchanged saved digest default with a singular count", async () => {
    const rendered = await service("digest").digestEmail("Board", 1, 24, "en");
    expect(rendered.subject).toContain("1 change");
    expect(rendered.subject).not.toContain("1 changes");
    expect(rendered.text).toContain("there was 1 change");
    expect(rendered.text).not.toContain("1 changes");
  });

  it("renders an unchanged saved due-reminder default with a singular count", async () => {
    const rendered = await service("due_reminder").dueReminderEmail(
      1,
      "<li>Ship it</li>",
      "en",
    );
    expect(rendered.subject).toContain("1 task due soon");
    expect(rendered.subject).not.toContain("1 tasks");
    expect(rendered.text).toContain("Task due soon:");
    expect(rendered.text).not.toContain("1 tasks");
  });

  it("delegates an unchanged saved default to the RU direct builder", async () => {
    const digest = await service("digest").digestEmail("Доска", 1, 24, "ru", [
      { type: "claim.expired", count: 1 },
    ]);
    expect(digest.subject).toContain("изменений: 1");
    expect(digest.text).toContain("В доске «Доска»");
    expect(digest.text).toContain("было 1 изменение");
    expect(digest.text).toContain("истёкших захватов: 1");
    expect(digest.text).not.toContain("Board activity");

    const due = await service("due_reminder").dueReminderEmail(
      21,
      "<li><strong>Задача</strong> — срок 24 ноя 2026, 09:30 UTC</li>",
      "ru",
    );
    expect(due.subject).toContain("21 задача с приближающимся сроком");
    expect(due.text).toContain("Задачи с приближающимся сроком:");
    expect(due.text).toContain("Задача");
    expect(due.text).not.toContain("Due soon");
  });

  it("keeps unchanged saved-default counts plural-aware", async () => {
    const digest = await service("digest").digestEmail("Board", 2, 24, "en");
    expect(digest.subject).toContain("2 changes");
    expect(digest.text).toContain("there were 2 changes");
    const due = await service("due_reminder").dueReminderEmail(
      2,
      "<li>Ship it</li>",
      "en",
    );
    expect(due.subject).toContain("2 tasks due soon");
    expect(due.text).toContain("Tasks due soon:");
  });

  it("renders a genuinely customized body with the provided data", async () => {
    const rendered = await service("digest", {
      subject: "Custom {{count}}",
      bodyHtml: "<p>Custom body: {{countLabel}} on {{board}}</p>",
    }).digestEmail("Board", 1, 24, "en");
    expect(rendered.subject).toBe("Custom 1");
    expect(rendered.text).toContain("Custom body: 1 change on Board");
  });

  it("does not advertise raw count when the default uses countLabel", () => {
    expect(EMAIL_TEMPLATE_DEFAULTS.digest!.placeholders).not.toContain("count");
    expect(EMAIL_TEMPLATE_DEFAULTS.digest!.placeholders).toContain(
      "countLabel",
    );
    expect(EMAIL_TEMPLATE_DEFAULTS.due_reminder!.placeholders).not.toContain(
      "count",
    );
    expect(EMAIL_TEMPLATE_DEFAULTS.due_reminder!.placeholders).toContain(
      "countLabel",
    );
  });
});
