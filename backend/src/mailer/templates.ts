import type { MailLocale } from "./mail.types";

/**
 * Email templates (TASK-51). Table-based HTML — mail clients (Outlook,
 * Gmail) strip modern CSS — plus a plain-text alternative. Palette mirrors
 * the app (indigo accent on white).
 */

const BRAND = "Janosik";

function shell(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f5f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:12px;border:1px solid #e4e4e7;">
        <tr><td style="padding:28px 32px 0 32px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">
          <span style="font-size:18px;font-weight:700;color:#4f46e5;">${BRAND}</span>
        </td></tr>
        <tr><td style="padding:12px 32px 0 32px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">
          <h1 style="margin:0 0 16px 0;font-size:20px;line-height:1.3;color:#18181b;">${title}</h1>
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:24px 32px 28px 32px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#a1a1aa;">${BRAND}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

const CODE_STYLES =
  "display:inline-block;margin:8px 0 16px 0;padding:14px 24px;border-radius:10px;background:#eef2ff;border:1px solid #c7d2fe;font-size:30px;letter-spacing:8px;font-weight:700;color:#3730a3;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;";

/**
 * The registration confirmation email (TASK-53) — the 6-digit code that
 * activates a freshly created account.
 */
export function verificationCodeEmail(
  code: string,
  minutes: number,
  locale: MailLocale,
): { subject: string; text: string; html: string } {
  if (locale === "ru") {
    const text = [
      "Подтверждение email",
      "",
      `Ваш код: ${code}`,
      "",
      `Код действует ${minutes} минут и работает один раз.`,
      "Если вы не создавали аккаунт — просто проигнорируйте это письмо.",
    ].join("\n");
    return {
      subject: `${BRAND}: код подтверждения ${code}`,
      text,
      html: shell(
        "Подтверждение email",
        `<p style="margin:0 0 8px 0;font-size:14px;color:#3f3f46;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">Введите этот код, чтобы активировать аккаунт:</p>
         <span ${codeStyleAttr()}>${code}</span>
         <p style="margin:0 0 8px 0;font-size:13px;line-height:1.6;color:#52525b;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">Код действует ${minutes} минут и работает один раз.<br>Если вы не создавали аккаунт — просто проигнорируйте письмо.</p>`,
      ),
    };
  }
  const text = [
    "Confirm your email",
    "",
    `Your code: ${code}`,
    "",
    `The code expires in ${minutes} minutes and works once.`,
    "If you did not create an account, ignore this message.",
  ].join("\n");
  return {
    subject: `${BRAND}: confirmation code ${code}`,
    text,
    html: shell(
      "Confirm your email",
      `<p style="margin:0 0 8px 0;font-size:14px;color:#3f3f46;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">Enter this code to activate your account:</p>
       <span ${codeStyleAttr()}>${code}</span>
       <p style="margin:0 0 8px 0;font-size:13px;line-height:1.6;color:#52525b;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">The code expires in ${minutes} minutes and works once.<br>If you did not create an account, ignore this message.</p>`,
    ),
  };
}

/** The verification code email — sent to the NEW address. */
export function emailChangeCodeEmail(
  code: string,
  minutes: number,
  locale: MailLocale,
): { subject: string; text: string; html: string } {
  if (locale === "ru") {
    const text = [
      "Код подтверждения смены email",
      "",
      `Ваш код: ${code}`,
      "",
      `Код действует ${minutes} минут и работает один раз.`,
      "Если вы не запрашивали смену email — просто проигнорируйте это письмо, адрес не изменится.",
    ].join("\n");
    return {
      subject: `${BRAND}: код подтверждения ${code}`,
      text,
      html: shell(
        "Код подтверждения смены email",
        `<p style="margin:0 0 8px 0;font-size:14px;color:#3f3f46;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">Введите этот код, чтобы подтвердить новый адрес:</p>
         <span ${codeStyleAttr()}>${code}</span>
         <p style="margin:0 0 8px 0;font-size:13px;line-height:1.6;color:#52525b;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">Код действует ${minutes} минут и работает один раз.<br>Если вы не запрашивали смену email — просто проигнорируйте письмо, адрес не изменится.</p>`,
      ),
    };
  }
  const text = [
    "Email change verification code",
    "",
    `Your code: ${code}`,
    "",
    `The code expires in ${minutes} minutes and works once.`,
    "If you did not request an email change, ignore this message — nothing will change.",
  ].join("\n");
  return {
    subject: `${BRAND}: verification code ${code}`,
    text,
    html: shell(
      "Email change verification code",
      `<p style="margin:0 0 8px 0;font-size:14px;color:#3f3f46;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">Enter this code to confirm your new email address:</p>
       <span ${codeStyleAttr()}>${code}</span>
       <p style="margin:0 0 8px 0;font-size:13px;line-height:1.6;color:#52525b;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">The code expires in ${minutes} minutes and works once.<br>If you did not request an email change, ignore this message — nothing will change.</p>`,
    ),
  };
}

function codeStyleAttr(): string {
  return `style="${CODE_STYLES.replace(/"/g, "&quot;")}"`;
}

/** The notice email — sent to the OLD address after the change. */
export function emailChangedNoticeEmail(
  newEmail: string,
  locale: MailLocale,
): { subject: string; text: string; html: string } {
  if (locale === "ru") {
    return {
      subject: `${BRAND}: email аккаунта изменён`,
      text: [
        "Email вашего аккаунта изменён.",
        "",
        `Старый адрес: этот`,
        `Новый адрес: ${newEmail}`,
        "",
        "Все прочие сессии завершены. Если это были не вы — срочно смените пароль и свяжитесь с администратором.",
      ].join("\n"),
      html: shell(
        "Email аккаунта изменён",
        `<p style="margin:0 0 8px 0;font-size:14px;color:#3f3f46;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">Вход теперь выполняется через <b>${escapeHtml(newEmail)}</b>. Все прочие сессии завершены.</p>
         <p style="margin:0;font-size:13px;line-height:1.6;color:#52525b;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">Если это были не вы — срочно смените пароль и свяжитесь с администратором.</p>`,
      ),
    };
  }
  return {
    subject: `${BRAND}: your account email was changed`,
    text: [
      "The email of your account was changed.",
      "",
      "Old address: this one",
      `New address: ${newEmail}`,
      "",
      "All other sessions were signed out. If this was not you, change your password immediately and contact your administrator.",
    ].join("\n"),
    html: shell(
      "Your account email was changed",
      `<p style="margin:0 0 8px 0;font-size:14px;color:#3f3f46;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">You now sign in with <b>${escapeHtml(newEmail)}</b>. All other sessions were signed out.</p>
       <p style="margin:0;font-size:13px;line-height:1.6;color:#52525b;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">If this was not you, change your password immediately and contact your administrator.</p>`,
    ),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
