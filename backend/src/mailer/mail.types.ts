/**
 * One outgoing email. E2E tests and the suppressed-transport log both read
 * this shape; nothing here ever leaves the process except via SMTP.
 */
export interface SentEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Connection settings for a live SMTP transport (TASK-52). */
export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
}

/** UI locales the templates exist for. */
export type MailLocale = "en" | "ru";

/**
 * `Accept-Language` → template locale. Only `en` and `ru` exist; anything
 * else (or a missing header) falls back to `en`.
 */
export function pickLocale(acceptLanguage?: string): MailLocale {
  if (!acceptLanguage) return "en";
  const parts = acceptLanguage
    .split(",")
    .map((chunk) => {
      const [tag, q] = chunk.trim().split(";q=");
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { tag } of parts) {
    if (tag.startsWith("ru")) return "ru";
    if (tag.startsWith("en")) return "en";
  }
  return "en";
}
