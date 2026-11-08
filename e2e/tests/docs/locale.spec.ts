import { expect, test } from "@playwright/test";

import { docsUrl, languageSelect, openDocs } from "@/helpers/docs.js";

test("switches an English docs page to Russian without losing the page", async ({
  page,
}) => {
  await openDocs(page, "user-guide/boards/");

  await expect(languageSelect(page)).toHaveValue("/docs/user-guide/boards/");
  await languageSelect(page).selectOption("/ru/docs/user-guide/boards/");

  await expect(page).toHaveURL(docsUrl("user-guide/boards/", "ru"));
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(languageSelect(page)).toHaveValue("/ru/docs/user-guide/boards/");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Доски, колонки и карточки",
    }),
  ).toBeVisible();
  await expect(page.locator("main")).toContainText(
    "Доска состоит из колонок, расположенных в заданном порядке.",
  );
});

test("switches a Russian docs page back to English without losing the page", async ({
  page,
}) => {
  await openDocs(page, "user-guide/boards/", "ru");

  await expect(languageSelect(page)).toHaveValue("/ru/docs/user-guide/boards/");
  await languageSelect(page).selectOption("/docs/user-guide/boards/");

  await expect(page).toHaveURL(docsUrl("user-guide/boards/"));
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(languageSelect(page)).toHaveValue("/docs/user-guide/boards/");
  await expect(
    page.getByRole("heading", { level: 1, name: "Boards, columns and cards" }),
  ).toBeVisible();
  await expect(page.locator("main")).toContainText(
    "A board is an ordered strip of columns",
  );
});
