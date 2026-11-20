import { randomUUID } from "node:crypto";
import type { Locator } from "@playwright/test";
import { test, expect } from "@/fixtures/admin.js";
import {
  adminPath,
  createUserViaAdmin,
  loginAsMaster,
  ownerCredentials,
  uniqueToken,
} from "@/helpers/admin.js";

const en = {
  filters: /^Filters(?: \d+)?$/,
  titles: [
    "Filters for boards",
    "Filters for columns",
    "Filters for labels",
    "Filters for checklists",
    "Filters for card links",
  ],
  admin: "Admin member",
  board: "Board",
  card: "Card",
  type: "Link type",
  types: ["Blocks", "Relates to", "Duplicates"],
  close: "Close",
  apply: "Apply",
  archived: "(archived)",
  total: "Filters applied · Results: 1",
  bothLinks: "Filters applied · Results: 2",
};

const ru: typeof en = {
  filters: /^Фильтры(?: \d+)?$/,
  titles: [
    "Фильтры досок",
    "Фильтры колонок",
    "Фильтры меток",
    "Фильтры чек-листов",
    "Фильтры связей карточек",
  ],
  admin: "Администратор доски",
  board: "Доска",
  card: "Карточка",
  type: "Тип связи",
  types: ["Блокирует", "Связана с", "Дублирует"],
  close: "Закрыть",
  apply: "Применить",
  archived: "(в архиве)",
  total: "Фильтры применены · Результатов: 1",
  bothLinks: "Фильтры применены · Результатов: 2",
};

async function expectInside(control: Locator, width: number, minHeight = 0) {
  await control.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => {
      const box = await control.boundingBox();
      return (
        box !== null &&
        box.x >= -0.1 &&
        box.x + box.width <= width + 0.1 &&
        box.y >= -0.1 &&
        box.y + box.height <= 900.1 &&
        box.height >= minHeight
      );
    })
    .toBe(true);
}

for (const width of [1440, 1024, 390]) {
  test(`Boards hub content filters at ${width}px`, async ({ page, board }) => {
    const mobile = width === 390;
    const copy = mobile ? ru : en;
    const boardTitle = `${board.title} ${"Board scope ".repeat(6)}`.slice(
      0,
      100,
    );
    const columnTitle = "Content column ".repeat(7).slice(0, 100);
    const cardTitle = "Card with a long title "
      .repeat(14)
      .slice(0, 300)
      .trimEnd();
    const labelTitle = "Label scope ".repeat(5).slice(0, 50);
    const checklistTitle = "Release checklist ".repeat(6).slice(0, 100);
    await board.command({ type: "RENAME_BOARD", title: boardTitle });
    const columnId = await board.column(columnTitle);
    const cardId = await board.card(columnId, cardTitle);
    const otherCardId = await board.card(columnId, "Other linked card");
    const sourceCardId = await board.card(columnId, "Incoming link source");
    const labelId = await board.label(labelTitle);
    await board.command({ type: "SET_CARD_LABEL", cardId, labelId, on: true });
    await board.command({
      type: "ADD_CHECKLIST",
      cardId,
      newChecklistId: randomUUID(),
      title: checklistTitle,
    });
    await board.command({
      type: "ADD_CARD_LINK",
      cardId,
      linkId: randomUUID(),
      targetCardId: otherCardId,
      linkType: "blocks",
    });
    await board.command({
      type: "ADD_CARD_LINK",
      cardId: sourceCardId,
      linkId: randomUUID(),
      targetCardId: cardId,
      linkType: "relates_to",
    });

    await page.setViewportSize({ width, height: 900 });
    await loginAsMaster(page, ownerCredentials());
    const detail = adminPath(`boards/${board.id}${mobile ? "?lng=ru" : ""}`);
    if (width === 1440) {
      for (const [testId, key, value, title, total] of [
        ["admin-board-counter-cards", "boardId", board.id, boardTitle, 3],
        [
          `admin-board-column-cards-${columnId}`,
          "columnId",
          columnId,
          columnTitle,
          3,
        ],
        [
          `admin-board-label-cards-${labelId}`,
          "labelId",
          labelId,
          labelTitle,
          1,
        ],
      ] as const) {
        await page.goto(detail);
        await page.getByTestId(testId).click();
        await expect(page).toHaveURL(
          (url) => url.searchParams.get(key) === value,
        );
        await expect(page.getByTestId(`admin-filter-${key}`)).toContainText(
          title,
        );
        await expect(page.getByTestId("admin-filter-results")).toHaveText(
          `Filters applied · Results: ${total}`,
        );
      }
    }
    await board.command({ type: "ARCHIVE_CARD", cardId });
    await page.goto(detail);
    await page.getByTestId("admin-board-counter-cards").click();
    const boardChip = page.getByTestId("admin-filter-boardId");
    await expect(boardChip).toContainText(boardTitle);
    const trigger = page.getByRole("button", { name: copy.filters });
    const tabs = page.getByTestId("admin-hub-tabs");
    await expect(tabs.getByRole("tab")).toHaveCount(6);
    await expectInside(tabs.getByTestId("admin-hub-tab-cards"), width);
    const tabCases = [
      ["boards", [copy.admin]],
      ["columns", [copy.board]],
      ["labels", [copy.board]],
      ["checklists", [copy.board, copy.card]],
      ["links", [copy.board, copy.card, copy.type]],
    ] as const;

    for (const [index, [tab, facets]] of tabCases.entries()) {
      const tabLink = tabs.getByTestId(`admin-hub-tab-${tab}`);
      await expectInside(tabLink, width);
      await tabLink.click();
      await expect(page).toHaveURL(
        (url) =>
          url.searchParams.get("tab") === tab &&
          url.searchParams.get("boardId") === board.id,
      );
      await expect(tabLink).toHaveAttribute("aria-selected", "true");
      await expect(boardChip).toContainText(boardTitle);
      await expectInside(boardChip, width);
      await expectInside(trigger, width, mobile ? 44 : 32);
      await trigger.click();
      const menu = page.getByRole("dialog", { name: copy.titles[index] });
      await expect(menu.getByRole("button")).toHaveText([
        ...facets,
        copy.close,
      ]);
      for (const facet of [...facets, copy.close]) {
        await expectInside(
          menu.getByRole("button", { name: facet, exact: true }),
          width,
          mobile ? 44 : 32,
        );
      }
      if (tab === "boards") {
        await menu.getByRole("button", { name: copy.admin }).click();
        const lookup = menu.getByRole("combobox");
        await lookup.fill(board.email);
        await menu
          .getByRole("option", { name: new RegExp(board.email) })
          .click();
        await expect(
          page.getByTestId("admin-filter-adminMemberId"),
        ).toContainText(board.email);
        await expect(page.getByTestId("admin-filter-results")).toHaveText(
          copy.total,
        );
      } else {
        await page.keyboard.press("Escape");
      }
      await expect(trigger).toBeFocused();
    }

    await trigger.click();
    const links = page.getByRole("dialog", { name: copy.titles[4] });
    await links.getByRole("button", { name: copy.card, exact: true }).click();
    const cardLookup = links.getByRole("combobox");
    await expectInside(cardLookup, width, mobile ? 44 : 32);
    await cardLookup.fill(cardTitle.slice(0, 45));
    await links.getByRole("option", { name: new RegExp(cardTitle) }).click();
    const cardChip = page.getByTestId("admin-filter-cardId");
    await expect(cardChip).toContainText(cardTitle);
    await expect(cardChip).toContainText(cardId.slice(0, 8));
    await expect(cardChip).toContainText(columnId.slice(0, 8));
    await expect(cardChip).toContainText(copy.archived);
    await expect(page.getByTestId("admin-filter-results")).toHaveText(
      copy.bothLinks,
    );
    await expectInside(cardChip, width);
    await expectInside(cardChip.getByRole("button"), width, 24);
    if (mobile) {
      const title = cardChip
        .locator("span.truncate")
        .filter({ hasText: cardTitle });
      await expect(title).toHaveAttribute("title", new RegExp(cardTitle));
      expect(
        await title.evaluate(
          (element) => element.scrollWidth > element.clientWidth,
        ),
      ).toBe(true);
    }

    await trigger.click();
    await links.getByRole("button", { name: copy.type }).click();
    for (const type of copy.types) {
      await expectInside(links.getByText(type, { exact: true }), width);
    }
    await links.getByRole("checkbox", { name: copy.types[1] }).check();
    await links.getByRole("button", { name: copy.apply }).click();
    await expect(page).toHaveURL(
      (url) => url.searchParams.get("type") === "relates_to",
    );
    await expect(page.getByTestId("admin-filter-type")).toHaveText(
      copy.types[1],
    );
    await expect(page.getByTestId("admin-filter-results")).toHaveText(
      copy.total,
    );
    await expect(
      page.getByRole("row").filter({ hasText: "relates_to" }),
    ).toContainText("Incoming link source");

    const removeType = page.getByTestId("admin-filter-clear-type");
    await expectInside(removeType, width, 24);
    await removeType.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("admin-filter-type")).toHaveCount(0);
    await expect(cardChip.getByRole("button")).toBeFocused();
    await page.goBack();
    await expect(page.getByTestId("admin-filter-type")).toHaveText(
      copy.types[1],
    );
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
  });
}

test("Users verification radio and period tabs at 390px in Russian", async ({
  page,
  admin,
}) => {
  const prefix = uniqueToken("verification");
  const verified = await createUserViaAdmin(admin, {
    email: `${prefix}-yes@example.com`,
    verified: true,
  });
  const unverified = await createUserViaAdmin(admin, {
    email: `${prefix}-no@example.com`,
    verified: false,
  });
  await page.setViewportSize({ width: 390, height: 900 });
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath(`users?lng=ru&search=${prefix}&period=24h`));
  for (const period of ["За всё время", "24 часа", "7 дней", "30 дней"]) {
    await expectInside(
      page.getByRole("button", { name: period, exact: true }),
      390,
      44,
    );
  }
  const trigger = page.getByRole("button", { name: ru.filters });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Фильтры пользователей" });
  await dialog.getByRole("button", { name: "Подтверждение почты" }).click();
  const group = dialog.getByRole("radiogroup", {
    name: "Фильтр по подтверждению почты",
  });
  await expect(
    group.getByRole("radio", { name: "Любой вариант" }),
  ).toBeFocused();
  await page.keyboard.press("End");
  await expect(
    group.getByRole("radio", { name: "Не подтверждён" }),
  ).toBeFocused();
  await page.keyboard.press("Space");
  await expect(trigger).toBeFocused();
  await expect(page.getByTestId("admin-filter-verified")).toHaveText(
    "Не подтверждён",
  );
  await expect(
    page.getByTestId(`admin-user-row-${unverified.id}`),
  ).toBeVisible();
  await expect(page.getByTestId(`admin-user-row-${verified.id}`)).toHaveCount(
    0,
  );
  await expect(page.getByTestId("admin-filter-results")).toHaveText(ru.total);
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("verified") === "false" &&
      url.searchParams.get("period") === "24h",
  );
});
