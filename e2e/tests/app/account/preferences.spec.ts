import { test, expect } from "@/fixtures/account.js";
import { openAccount } from "@/helpers/account.js";

test("choosing a theme applies it immediately and keeps it after a reload", async ({
  page,
  account,
}) => {
  await account.open(page);
  await openAccount(page, "preferences");

  await page.getByTestId("pref-theme-light").click();
  await expect(page.locator("html")).toHaveClass(/light/);
  expect(await page.evaluate(() => localStorage.getItem("janosik-theme"))).toBe(
    "light",
  );

  await page.reload();
  await expect(page.locator("html")).toHaveClass(/light/);
});

test("choosing a language translates the panel and survives a reload", async ({
  page,
  account,
}) => {
  await account.open(page);
  await openAccount(page, "preferences");

  await page.getByTestId("pref-language").click();
  await page.getByRole("menuitem", { name: "Русский" }).click();
  await expect(page.getByTestId("pref-language")).toContainText("Русский");
  await expect(page.getByRole("heading", { name: "Настройки" })).toBeVisible();

  await page.reload();
  await openAccount(page, "preferences");
  await expect(page.getByTestId("pref-language")).toContainText("Русский");
  await expect(page.getByRole("heading", { name: "Настройки" })).toBeVisible();
});

test("choosing a time format persists across a reload", async ({
  page,
  account,
}) => {
  await account.open(page);
  await openAccount(page, "preferences");

  await page.getByTestId("pref-time-format").click();
  await page.getByRole("menuitem", { name: "24-hour" }).click();
  await expect(page.getByTestId("pref-time-format")).toContainText("24-hour");

  await page.reload();
  await openAccount(page, "preferences");
  await expect(page.getByTestId("pref-time-format")).toContainText("24-hour");
});

test("choosing a board background persists across a reload", async ({
  page,
  account,
}) => {
  await account.open(page);
  await openAccount(page, "preferences");

  await page.getByTestId("pref-background").click();
  await page.getByRole("menuitem", { name: "Dots" }).click();
  await expect(page.getByTestId("pref-background")).toContainText("Dots");
  expect(
    await page.evaluate(() => localStorage.getItem("janosik-board-bg")),
  ).toBe("dots");

  await page.reload();
  await openAccount(page, "preferences");
  await expect(page.getByTestId("pref-background")).toContainText("Dots");
});
