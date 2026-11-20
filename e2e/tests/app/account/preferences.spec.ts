import { test, expect } from "@/fixtures/account.js";
import { openAccount } from "@/helpers/account.js";
import { appUrl } from "@/helpers/urls.js";

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

test("a language handoff is consumed before later URL writes and survives reload", async ({
  page,
  account,
}) => {
  await account.open(page);
  const boardId = await account.createBoard("Language handoff board");
  await page.goto(new URL(`board/${boardId}?lng=ru`, appUrl).href);
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");

  await openAccount(page, "preferences");
  await page.getByTestId("pref-language").click();
  await page.getByRole("menuitem", { name: "English" }).click();
  await expect(page.getByTestId("pref-language")).toContainText("English");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("account-dialog")).toBeHidden();
  await expect(page).toHaveURL((url) => !url.searchParams.has("lng"), {
    timeout: 10_000,
  });

  // The board filter rebuilds its URL from useSearchParams. A stale router
  // location would copy `lng=ru` back and re-pin Russian on reload.
  await page
    .getByRole("textbox", { name: "Search cards" })
    .fill("Language handoff");
  await expect(page).toHaveURL((url) => {
    const params = url.searchParams;
    return params.get("f.q") === "Language handoff" && !params.has("lng");
  });

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("textbox", { name: "Search cards" })).toHaveValue(
    "Language handoff",
  );
  expect(await page.evaluate(() => localStorage.getItem("janosik-lang"))).toBe(
    "en",
  );
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
