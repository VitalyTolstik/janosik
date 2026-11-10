import {
  announcementEmail,
  announcementFallbackNotice,
  announcementFallbackSubjectPrefix,
  attentionEmail,
  digestEmail,
} from "./templates";

describe("announcementEmail", () => {
  it("sends the exact language without a fallback notice", () => {
    const mail = announcementEmail({
      title: "Плановые работы",
      body: "Сервер будет недоступен",
      contentLocale: "ru",
      recipientLocale: "ru",
      isFallback: false,
    });
    expect(mail.subject).toBe("Плановые работы");
    expect(mail.text).toContain("Сервер будет недоступен");
    expect(mail.text).not.toContain("доступно только");
    expect(mail.html).toContain('lang="ru"');
    expect(mail.html).not.toContain("available in Russian only");
  });

  it("adds the localized notice and subject prefix on fallback", () => {
    const mail = announcementEmail({
      title: "Плановые работы",
      body: "Сервер будет недоступен",
      contentLocale: "ru",
      recipientLocale: "en",
      isFallback: true,
    });
    expect(mail.subject).toBe("Announcement (Russian only): Плановые работы");
    expect(mail.text).toContain(
      "This announcement is available in Russian only.",
    );
    expect(mail.html).toContain(
      "This announcement is available in Russian only.",
    );
    expect(mail.html).toContain('lang="ru"');
    expect(mail.html).toContain('lang="en"');
  });

  it("uses the Russian notice when an English letter reaches a RU viewer", () => {
    const mail = announcementEmail({
      title: "Maintenance",
      body: "Tonight",
      contentLocale: "en",
      recipientLocale: "ru",
      isFallback: true,
    });
    expect(mail.subject).toBe("Объявление (только на английском): Maintenance");
    expect(mail.text).toContain(
      "Это объявление доступно только на английском.",
    );
  });

  it("escapes text and strips newlines from the subject", () => {
    const mail = announcementEmail({
      title: "Maintenance\r\nBcc: evil@example.com",
      body: "<script>alert(1)</script>",
      contentLocale: "en",
      recipientLocale: "en",
      isFallback: false,
    });
    expect(mail.subject).toBe("Maintenance Bcc: evil@example.com");
    expect(mail.text).toContain("<script>alert(1)</script>");
    expect(mail.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(mail.html).not.toContain("<script>alert(1)</script>");
  });

  it("keeps legacy content language-neutral in the email shell", () => {
    const mail = announcementEmail({
      title: "Старое объявление",
      body: "Без известного языка",
      contentLocale: null,
      recipientLocale: "en",
      isFallback: false,
    });
    expect(mail.subject).toBe("Старое объявление");
    expect(mail.html).not.toContain("<html lang=");
    expect(mail.html).not.toContain('<div lang="en"');
  });

  it("keeps complete fallback phrases per locale", () => {
    expect(announcementFallbackNotice("en", "ru")).toBe(
      "This announcement is available in Russian only.",
    );
    expect(announcementFallbackNotice("ru", "en")).toBe(
      "Это объявление доступно только на английском.",
    );
    expect(announcementFallbackSubjectPrefix("en", "ru")).toBe(
      "Announcement (Russian only): ",
    );
    expect(announcementFallbackSubjectPrefix("ru", "en")).toBe(
      "Объявление (только на английском): ",
    );
  });
});

describe("attentionEmail", () => {
  const vars = {
    board: "Launch",
    card: "Ship it",
    summary: "Apply DELETE_CARD (1 command)",
    action: "DELETE_CARD",
    risk: "high",
    status: "approved",
    agent: "builder",
    limit: 2,
    current: 2,
    expiresAt: "2026-11-10T12:00:00.000Z",
    runId: "run-1",
    token: "CI key",
  };

  it("renders every category in English", () => {
    for (const type of [
      "approval.requested",
      "approval.decided",
      "approval.cancelled",
      "approval.consumed",
      "approval.expired",
      "agent.blocked",
      "agent.needs_human",
      "claim.expired",
      "quota.exceeded",
      "token.revoked",
    ] as const) {
      const mail = attentionEmail(type, vars, "en");
      expect(mail.subject).toContain("Janosik:");
      expect(mail.html).toContain('<html lang="en">');
      expect(mail.text.length).toBeGreaterThan(10);
    }
  });

  it("renders every category in Russian", () => {
    for (const type of [
      "approval.requested",
      "approval.decided",
      "approval.cancelled",
      "approval.consumed",
      "approval.expired",
      "agent.blocked",
      "agent.needs_human",
      "claim.expired",
      "quota.exceeded",
      "token.revoked",
    ] as const) {
      const mail = attentionEmail(type, vars, "ru");
      expect(mail.subject).toContain("Janosik:");
      expect(mail.html).toContain('<html lang="ru">');
      expect(mail.text).toMatch(/[А-Яа-я]/);
    }
  });

  it("escapes board-controlled text instead of injecting markup", () => {
    const mail = attentionEmail(
      "agent.blocked",
      { ...vars, board: "<script>x</script>", card: "A&B" },
      "en",
    );
    expect(mail.html).not.toContain("<script>x</script>");
    expect(mail.html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(mail.html).toContain("A&amp;B");
  });

  it("names the decision and the expiry in the right language", () => {
    expect(attentionEmail("approval.decided", vars, "en").subject).toContain(
      "approval approved",
    );
    expect(attentionEmail("approval.decided", vars, "ru").subject).toContain(
      "запрос одобрен",
    );
    expect(attentionEmail("approval.expired", vars, "en").subject).toContain(
      "expired",
    );
    expect(attentionEmail("approval.cancelled", vars, "en").subject).toContain(
      "cancelled",
    );
    expect(attentionEmail("approval.consumed", vars, "en").subject).toContain(
      "applied",
    );
    expect(attentionEmail("approval.consumed", vars, "en").text).toContain(
      "run-1",
    );
    expect(attentionEmail("token.revoked", vars, "en").subject).toContain(
      "API key revoked",
    );
    expect(attentionEmail("token.revoked", vars, "ru").subject).toContain(
      "API-ключ отозван",
    );
  });
});

describe("digestEmail attention summary", () => {
  it("keeps the original body when there is no attention", () => {
    const mail = digestEmail("Board", 2, 24, "en");
    expect(mail.text).toBe(
      'In "Board" there were 2 change(s) in the last 24 h.',
    );
    expect(mail.html).not.toContain("Needs attention");
  });

  it("adds aggregated categories in both locales", () => {
    const en = digestEmail("Board", 2, 24, "en", [
      { type: "approval.requested", count: 2 },
      { type: "agent.blocked", count: 1 },
    ]);
    expect(en.text).toContain("Needs attention:");
    expect(en.text).toContain("approvals requested: 2");
    expect(en.text).toContain("blocked agents: 1");
    const ru = digestEmail("Доска", 0, 24, "ru", [
      { type: "claim.expired", count: 1 },
    ]);
    expect(ru.text).toContain("Требует внимания:");
    expect(ru.text).toContain("истёкших захватов: 1");

    const tokens = digestEmail("Board", 0, 24, "en", [
      { type: "token.revoked", count: 1 },
      { type: "approval.consumed", count: 2 },
    ]);
    expect(tokens.text).toContain("revoked API keys: 1");
    expect(tokens.text).toContain("applied approvals: 2");
  });
});
