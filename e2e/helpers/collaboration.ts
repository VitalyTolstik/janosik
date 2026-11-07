import { expect, type Locator, type Page } from "@playwright/test";
import { cardTitle, columnSection } from "@/helpers/history.js";

/** Shared UI steps for the two-account collaboration suite. */

export function membersDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: /^Members/ });
}

export async function openMembers(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Members", exact: true }).click();
  const dialog = membersDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

export function memberRow(page: Page, email: string): Locator {
  return page.getByTestId("board-member-row").filter({ hasText: email });
}

export async function inviteMember(
  page: Page,
  email: string,
  role: "Admin" | "Member" | "Viewer" = "Member",
): Promise<void> {
  const dialog = await openMembers(page);
  await dialog.getByRole("textbox", { name: "Email" }).fill(email);
  if (role !== "Member") {
    await dialog.getByRole("button", { name: "Role", exact: true }).click();
    await page.getByRole("radio", { name: role, exact: true }).click();
  }
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/members") &&
      response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Invite", exact: true }).click();
  expect((await saved).status()).toBe(201);
  await expect(dialog.getByRole("textbox", { name: "Email" })).toHaveValue("");
}

export async function changeMemberRole(
  page: Page,
  email: string,
  role: "Admin" | "Member" | "Viewer",
): Promise<void> {
  const dialog = await openMembers(page);
  const row = memberRow(page, email);
  await expect(row).toBeVisible();
  await row.getByTestId("role-trigger").click();
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes("/members/") &&
      response.request().method() === "PATCH",
  );
  await page.getByRole("radio", { name: role, exact: true }).click();
  expect((await saved).ok()).toBeTruthy();
  await expect(row.getByTestId("role-trigger")).toHaveText(role);
  await expect(dialog).toBeVisible();
}

export async function removeMember(page: Page, email: string): Promise<void> {
  const dialog = await openMembers(page);
  const row = memberRow(page, email);
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: `Remove — ${email}` }).click();
  const removed = page.waitForResponse(
    (response) =>
      response.url().includes("/members/") &&
      response.request().method() === "DELETE",
  );
  await row.getByRole("button", { name: "Yes, remove" }).click();
  expect((await removed).ok()).toBeTruthy();
  await expect(row).toHaveCount(0);
  await expect(dialog).toBeVisible();
}

export async function openInvitations(page: Page): Promise<Locator> {
  await page.getByTestId("notifications-bell").click();
  await expect(page.getByTestId("invitations-panel")).toBeVisible();
  return page.getByTestId("invitations-panel");
}

export function invitationRow(page: Page, boardTitle: string): Locator {
  return page.getByTestId("invitation-row").filter({ hasText: boardTitle });
}

export async function acceptInvitation(
  page: Page,
  boardTitle: string,
): Promise<void> {
  await openInvitations(page);
  const row = invitationRow(page, boardTitle);
  const accepted = page.waitForResponse(
    (response) =>
      response.url().includes("/invitations/") &&
      response.url().endsWith("/accept") &&
      response.request().method() === "POST",
  );
  await row.getByTestId("invitation-accept").click();
  expect((await accepted).ok()).toBeTruthy();
  await expect(row).toHaveCount(0);
}

export async function declineInvitation(
  page: Page,
  boardTitle: string,
): Promise<void> {
  await openInvitations(page);
  const row = invitationRow(page, boardTitle);
  const declined = page.waitForResponse(
    (response) =>
      response.url().includes("/invitations/") &&
      response.url().endsWith("/decline") &&
      response.request().method() === "POST",
  );
  await row.getByTestId("invitation-decline").click();
  expect((await declined).ok()).toBeTruthy();
  await expect(row).toHaveCount(0);
}

export async function addCard(
  page: Page,
  column: string,
  title: string,
): Promise<void> {
  const section = columnSection(page, column);
  await section.locator("[data-composer-trigger]").click();
  const composer = section.locator('[name="card-composer"]');
  await composer.fill(title);
  await composer.press("Enter");
  await expect(cardTitle(page, title)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(composer).toBeHidden();
}

export function presenceStack(page: Page): Locator {
  return page.getByTestId("presence-stack");
}

export function presenceAvatars(page: Page): Locator {
  return page.getByTestId("presence-avatar");
}

export async function expectPresence(
  page: Page,
  count: number,
  timeout = 15_000,
): Promise<void> {
  if (count < 2) {
    await expect(presenceStack(page)).toBeHidden({ timeout });
    return;
  }
  await expect(presenceAvatars(page)).toHaveCount(count, { timeout });
}
