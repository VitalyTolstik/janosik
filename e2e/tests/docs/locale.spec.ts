import { expect, test } from "@playwright/test";

import { docsUrl, languageSelect, openDocs } from "@/helpers/docs.js";

const englishBoards = new URL(docsUrl("user-guide/boards/")).pathname;
const russianBoards = new URL(docsUrl("user-guide/boards/", "ru")).pathname;

test("switches an English docs page to Russian without losing the page", async ({
  page,
}) => {
  await openDocs(page, "user-guide/boards/");

  await expect(languageSelect(page)).toHaveValue(englishBoards);
  await languageSelect(page).selectOption(russianBoards);

  await expect(page).toHaveURL(docsUrl("user-guide/boards/", "ru"));
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(languageSelect(page)).toHaveValue(russianBoards);
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

test("switches admin, API and user-guide pages between both locales", async ({
  page,
}) => {
  const sections = [
    {
      path: "user-guide/boards/",
      en: "Boards, columns and cards",
      ru: "Доски, колонки и карточки",
    },
    {
      path: "admin/",
      en: "Admin panel",
      ru: "Панель администратора",
    },
    {
      path: "api/",
      en: "API reference",
      ru: "Справочник по API",
    },
  ] as const;

  for (const section of sections) {
    const english = new URL(docsUrl(section.path)).pathname;
    const russian = new URL(docsUrl(section.path, "ru")).pathname;

    await openDocs(page, section.path);
    await expect(languageSelect(page)).toHaveValue(english);
    await expect(
      page.getByRole("heading", { level: 1, name: section.en }),
    ).toBeVisible();

    await languageSelect(page).selectOption(russian);
    await expect(page).toHaveURL(docsUrl(section.path, "ru"));
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    await expect(languageSelect(page)).toHaveValue(russian);
    await expect(
      page.getByRole("heading", { level: 1, name: section.ru }),
    ).toBeVisible();

    await languageSelect(page).selectOption(english);
    await expect(page).toHaveURL(docsUrl(section.path));
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(languageSelect(page)).toHaveValue(english);
    await expect(
      page.getByRole("heading", { level: 1, name: section.en }),
    ).toBeVisible();
  }
});

test("switches a Russian docs page back to English without losing the page", async ({
  page,
}) => {
  await openDocs(page, "user-guide/boards/", "ru");

  await expect(languageSelect(page)).toHaveValue(russianBoards);
  await languageSelect(page).selectOption(englishBoards);

  await expect(page).toHaveURL(docsUrl("user-guide/boards/"));
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(languageSelect(page)).toHaveValue(englishBoards);
  await expect(
    page.getByRole("heading", { level: 1, name: "Boards, columns and cards" }),
  ).toBeVisible();
  await expect(page.locator("main")).toContainText(
    "A board is an ordered strip of columns",
  );
});
