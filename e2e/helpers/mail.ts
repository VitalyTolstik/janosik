import { expect, type APIRequestContext } from "@playwright/test";
import { mailUrl } from "./urls.js";

export async function waitForCodes(
  request: APIRequestContext,
  email: string,
  count: number,
) {
  let codes: string[] = [];
  await expect
    .poll(
      async () => {
        const response = await request.get(
          new URL("api/v1/messages", mailUrl).href,
        );
        if (!response.ok()) return 0;
        const body = (await response.json()) as {
          messages: Array<{ To: Array<{ Address: string }>; Subject: string }>;
        };
        codes = body.messages
          .filter((message) =>
            message.To.some((recipient) => recipient.Address === email),
          )
          .map((message) => message.Subject.match(/\b\d{6}\b/)?.[0] ?? "")
          .filter(Boolean);
        return codes.length;
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThanOrEqual(count);
  return codes;
}

export async function waitForRecoveryCode(
  request: APIRequestContext,
  email: string,
) {
  let code = "";
  await expect
    .poll(
      async () => {
        const response = await request.get(
          new URL("api/v1/messages", mailUrl).href,
        );
        if (!response.ok()) return false;
        const body = (await response.json()) as {
          messages: Array<{
            ID: string;
            To: Array<{ Address: string }>;
            Subject: string;
          }>;
        };
        const message = body.messages.find(
          (item) =>
            item.Subject.includes("Reset your password") &&
            item.To.some((to) => to.Address === email),
        );
        if (!message) return false;
        const detail = await request.get(
          new URL(`api/v1/message/${message.ID}`, mailUrl).href,
        );
        if (!detail.ok()) return false;
        const payload = (await detail.json()) as { Text: string };
        code = payload.Text.match(/\b[a-f0-9]{32}\b/)?.[0] ?? "";
        return Boolean(code);
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  return code;
}
