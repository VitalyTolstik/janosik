/** App and site may be on separate origins in development. */
export const siteUrl = process.env.E2E_SITE_URL ?? "http://127.0.0.1:4300/";
export const appUrl = process.env.E2E_APP_URL ?? new URL("app/", siteUrl).href;
export const mailUrl = process.env.E2E_MAIL_URL ?? "http://127.0.0.1:4802/";
