import {
  announcementEmail,
  announcementFallbackNotice,
  announcementFallbackSubjectPrefix,
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
