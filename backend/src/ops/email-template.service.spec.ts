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
  function service(key = "attention_card_assigned") {
    const fallback = EMAIL_TEMPLATE_DEFAULTS[key]!;
    const prisma = {
      emailTemplate: {
        findUnique: jest.fn().mockResolvedValue({
          key,
          subject: fallback.subject,
          bodyHtml: fallback.bodyHtml,
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

  it("renders a saved digest default with a singular count", async () => {
    const rendered = await service("digest").digestEmail("Board", 1, 24, "en");
    expect(rendered.subject).toContain("1 change");
    expect(rendered.subject).not.toContain("1 changes");
    expect(rendered.text).toContain(": 1 change.");
    expect(rendered.text).not.toContain("1 changes");
  });

  it("renders a saved due-reminder default with a singular count", async () => {
    const rendered = await service("due_reminder").dueReminderEmail(
      1,
      "<li>Ship it</li>",
      "en",
    );
    expect(rendered.subject).toContain("1 task due soon");
    expect(rendered.subject).not.toContain("1 tasks");
    expect(rendered.text).toContain("Due soon: 1 task");
    expect(rendered.text).not.toContain("Tasks due soon");
  });
});
