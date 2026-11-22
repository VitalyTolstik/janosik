import {
  announcementEmail,
  announcementFallbackNotice,
  announcementFallbackSubjectPrefix,
  attentionEmail,
  digestAttentionHtml,
  digestEmail,
  dueReminderEmail,
  htmlToText,
  mentionInboxBody,
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
    actor: "Alice",
    cards: "Ship it, Release",
    count: 2,
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
      "comment.mention",
      "card.assigned",
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
      "comment.mention",
      "card.assigned",
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

    const assigned = attentionEmail(
      "card.assigned",
      { ...vars, board: "A&B", cards: "<script>cards</script>" },
      "en",
    );
    expect(assigned.html).not.toContain("<script>cards</script>");
    expect(assigned.html).toContain("&lt;script&gt;cards&lt;/script&gt;");
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
    expect(attentionEmail("comment.mention", vars, "en").text).toContain(
      "Alice mentioned you",
    );
    expect(attentionEmail("comment.mention", vars, "en").text).not.toContain(
      "Ping @Bob",
    );
    expect(attentionEmail("comment.mention", vars, "ru").subject).toContain(
      "вас упомянули",
    );
    expect(
      attentionEmail(
        "card.assigned",
        { ...vars, cards: "Ship it, Release, QA" },
        "en",
      ).text,
    ).toContain("Ship it, Release, QA");
    expect(
      attentionEmail("card.assigned", { ...vars, cards: "Ship it" }, "ru")
        .subject,
    ).toContain("новое назначение");
    expect(
      attentionEmail(
        "card.assigned",
        { ...vars, cards: "Ship it", count: 1, actor: "Alice" },
        "en",
      ).text,
    ).toContain("Alice assigned you a card");
    expect(
      attentionEmail(
        "card.assigned",
        { ...vars, cards: "Ship it, Release", count: 2 },
        "en",
      ).text,
    ).toContain("assigned you 2 cards");
    const ruAssigned = attentionEmail(
      "card.assigned",
      { ...vars, cards: "Ship it, Release", count: 2, actor: "Алиса" },
      "ru",
    );
    expect(ruAssigned.text).toContain("новые карточки (2)");
    expect(ruAssigned.text).toContain("Алиса");
    expect(ruAssigned.text).not.toContain("2 карточек");
  });

  it("labels assignment attention in the digest in both languages (TASK-177.20)", () => {
    expect(
      digestAttentionHtml([{ type: "card.assigned", count: 2 }], "en"),
    ).toContain("assignment updates: <b>2</b>");
    expect(
      digestAttentionHtml([{ type: "card.assigned", count: 2 }], "ru"),
    ).toContain("обновлений о назначениях: <b>2</b>");
  });

  it("keeps due-reminder URLs and list line breaks in the text alternative", () => {
    const tasks =
      '<ul><li><a href="https://kb.example/app/board/b-1?card=c-1">Ship it</a> — due 1 Jan 2026, 10:00 UTC</li><li><a href="https://kb.example/app/board/b-1?card=c-2">Fix it</a></li></ul>';
    const mail = dueReminderEmail(2, tasks, "en");
    expect(mail.text).toContain(
      "Ship it (https://kb.example/app/board/b-1?card=c-1)",
    );
    expect(mail.text).toContain(
      "Fix it (https://kb.example/app/board/b-1?card=c-2)",
    );
    expect(mail.text).toContain("\n");
  });

  it("decodes entities in a trusted href before the plain-text URL", () => {
    const html =
      '<p><a href="https://kb.example/app/board/b-1?card=c-1&amp;comment=x">Ship it</a></p>';
    expect(htmlToText(html)).toContain(
      "Ship it (https://kb.example/app/board/b-1?card=c-1&comment=x)",
    );
  });

  it("never turns an escaped user anchor into a trusted link", () => {
    const escapedTitle =
      '&lt;a href="https://evil.example"&gt;Evil card&lt;/a&gt;';
    const tasks = `<ul><li><a href="https://kb.example/app/board/b-1?card=c-1">${escapedTitle}</a> — due 1 Jan 2026, 10:00 UTC</li></ul>`;
    const due = dueReminderEmail(1, tasks, "en");
    expect(due.text).toContain(
      "Evil card (https://kb.example/app/board/b-1?card=c-1)",
    );
    expect(due.text).not.toContain("https://evil.example");

    const assigned = attentionEmail(
      "card.assigned",
      {
        ...vars,
        count: 1,
        board: '<a href="https://evil.example/board">Evil board</a>',
        actor: '<a href="https://evil.example/actor">Eve</a>',
        cards: '<a href="https://evil.example">Evil card</a>',
      },
      "en",
    );
    expect(assigned.text).toContain("Evil card");
    expect(assigned.text).not.toContain("https://evil.example");
  });

  it("keeps comment text out of the mention letter but in the inbox body", () => {
    const excerpt = "Ping @Bob about the private release";
    const mail = attentionEmail("comment.mention", vars, "en");
    expect(mail.text).not.toContain(excerpt);
    expect(mail.html).not.toContain(excerpt);

    const inbox = mentionInboxBody(
      { board: "Launch", card: "Ship it", actor: "Alice", excerpt },
      "en",
    );
    expect(inbox).toContain(excerpt);
    expect(inbox).toContain("Alice mentioned you");
    expect(inbox).toContain("Ship it");
    expect(inbox).toContain("Launch");
    expect(
      mentionInboxBody(
        { board: "Launch", card: "Ship it", actor: "Alice", excerpt: "" },
        "ru",
      ),
    ).not.toContain("«»");
  });

  it("decodes entities in the subject and plain-text body", () => {
    const mail = attentionEmail(
      "comment.mention",
      { ...vars, board: 'A "quoted" & B', card: "Café" },
      "en",
    );
    expect(mail.subject).toContain('A "quoted" & B');
    expect(mail.subject).not.toContain("&quot;");
    expect(mail.subject).not.toContain("&amp;");

    expect(htmlToText("<p>&quot;hi&quot; &amp; &#39;there&#39;</p>")).toBe(
      `"hi" & 'there'`,
    );
    // Entities decode before tags are stripped, so an encoded tag cannot
    // reappear in the plain-text output.
    expect(htmlToText("<p>&lt;b&gt;bold&lt;/b&gt; x</p>")).toBe("bold x");
  });
});

describe("digestEmail attention summary", () => {
  it("keeps the original body when there is no attention", () => {
    const mail = digestEmail("Board", 2, 24, "en");
    expect(mail.text).toBe('In "Board" there were 2 changes in the last 24 h.');
    expect(mail.html).not.toContain("Needs attention");
  });

  it("uses English singular/plural without literal (s)", () => {
    const one = digestEmail("Board", 1, 24, "en");
    expect(one.subject).toContain("1 change");
    expect(one.subject).not.toContain("change(s)");
    expect(one.text).toContain("there was 1 change in");
    expect(digestEmail("Board", 2, 24, "en").text).toContain(
      "there were 2 changes in",
    );

    expect(dueReminderEmail(1, "<li>Ship it</li>", "en").subject).toBe(
      "Janosik: 1 task due soon",
    );
    expect(dueReminderEmail(2, "<li>Ship it</li>", "en").subject).toBe(
      "Janosik: 2 tasks due soon",
    );
    expect(dueReminderEmail(1, "<li>Ship it</li>", "en").text).toContain(
      "Task due soon:",
    );
    expect(dueReminderEmail(2, "<li>Ship it</li>", "en").text).toContain(
      "Tasks due soon:",
    );
    // The saved-default neutral branch must not leak into direct letters.
    expect(dueReminderEmail(1, "<li>Ship it</li>", "en").text).not.toContain(
      "Due soon: 1 task",
    );
    expect(digestEmail("Board", 1, 24, "en").text).not.toContain(
      "Board activity",
    );
  });

  it("uses Russian plural forms for one, few and many", () => {
    const one = digestEmail("Доска", 1, 24, "ru");
    expect(one.subject).toContain("изменений: 1");
    expect(one.text).toContain("было 1 изменение");
    expect(one.text).not.toContain("1 изменений");
    const two = digestEmail("Доска", 2, 24, "ru");
    expect(two.subject).toContain("изменений: 2");
    expect(two.text).toContain("было 2 изменения");
    expect(digestEmail("Доска", 5, 24, "ru").text).toContain(
      "было 5 изменений",
    );

    const dueOne = dueReminderEmail(1, "<li>Ship it</li>", "ru");
    expect(dueOne.subject).toContain("1 задача с приближающимся сроком");
    expect(dueOne.text).toContain("Задача с приближающимся сроком:");
    expect(dueOne.text).not.toContain("1 задач ");
    const dueTwo = dueReminderEmail(2, "<li>Ship it</li>", "ru");
    expect(dueTwo.subject).toContain("2 задачи с приближающимся сроком");
    expect(dueTwo.text).toContain("Задачи с приближающимся сроком:");
    expect(dueReminderEmail(5, "<li>Ship it</li>", "ru").subject).toContain(
      "5 задач с приближающимся сроком",
    );
    const due21 = dueReminderEmail(21, "<li>Ship it</li>", "ru");
    expect(due21.subject).toContain("21 задача с приближающимся сроком");
    expect(due21.text).toContain("Задачи с приближающимся сроком:");
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
