import type { Locator } from "@playwright/test";
import { test, expect } from "@/fixtures/admin.js";
import { adminPath, loginAsMaster, ownerCredentials } from "@/helpers/admin.js";

const english = {
  filters: "Filters",
  dialog: "Filters for cards",
  board: "Board",
  column: "Column",
  label: "Label",
  search: "Search options",
  remove: "Remove filter",
  close: "Close",
  clear: "Clear search and filters",
  back: "Back",
  archived: "(archived)",
  statuses: ["All", "Active", "Archived", "Deleted"],
};

const russian: typeof english = {
  filters: "Фильтры",
  dialog: "Фильтры карточек",
  board: "Доска",
  column: "Колонка",
  label: "Метка",
  search: "Найти значение",
  remove: "Удалить фильтр",
  close: "Закрыть",
  clear: "Сбросить поиск и фильтры",
  back: "Назад",
  archived: "(в архиве)",
  statuses: ["Все", "Активные", "В архиве", "Удалённые"],
};

async function expectInside(
  control: Locator,
  width: number,
  height: number,
  minHeight: number,
) {
  await expect(control).toBeVisible();
  await expect
    .poll(async () => {
      const box = await control.boundingBox();
      return (
        box !== null &&
        box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= width + 0.1 &&
        box.y + box.height <= height + 0.1 &&
        box.height >= minHeight
      );
    })
    .toBe(true);
}

for (const width of [1440, 1024, 390]) {
  test(`cards filters at ${width}px`, async ({ page, board }) => {
    const mobile = width === 390;
    const copy = mobile ? russian : english;
    const height = 900;
    const boardTitle =
      `${board.title} ${"Long board title ".repeat(8)}`.slice(0, 99) + "x";
    const columnTitle =
      "Column with a long title ".repeat(5).slice(0, 99) + "x";
    const labelTitle = "Label with a long name "
      .repeat(3)
      .slice(0, 50)
      .trimEnd();
    const cardTitle = "Card with a long title "
      .repeat(14)
      .slice(0, 300)
      .trimEnd();
    await board.command({ type: "RENAME_BOARD", title: boardTitle });
    const columnId = await board.column(columnTitle);
    const duplicateColumnId = await board.column(columnTitle);
    const labelId = await board.label(labelTitle, "indigo");
    const duplicateLabelId = await board.label(labelTitle, "green");
    const cardId = await board.card(columnId, cardTitle);
    await board.command({ type: "SET_CARD_LABEL", cardId, labelId, on: true });
    await board.command({ type: "ARCHIVE_CARD", cardId });
    const sameTitle = await board.api.post("/api/v1/boards", {
      data: { title: boardTitle },
    });
    expect(sameTitle.status()).toBe(201);
    const { id: otherBoardId } = (await sameTitle.json()) as { id: string };

    await loginAsMaster(page, ownerCredentials());
    await page.setViewportSize({ width, height });
    const list = adminPath(
      `boards?tab=cards&returnTo=%2Fadmin${mobile ? "&lng=ru" : ""}`,
    );
    await page.goto(list);
    const trigger = page.getByRole("button", {
      name: new RegExp(`^${copy.filters}(?: \\d+)?$`),
    });
    const dialog = page.getByRole("dialog", { name: copy.dialog });
    await expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    await trigger.focus();
    await page.keyboard.press("Space");
    await expect(dialog).toBeVisible();
    expect((await dialog.boundingBox())?.width).toBeLessThanOrEqual(
      mobile ? width : 320,
    );
    if (mobile) {
      await expect(dialog).toHaveAttribute("aria-modal", "true");
      expect((await dialog.boundingBox())?.height).toBeLessThanOrEqual(
        height * 0.7,
      );
      for (const name of [copy.board, copy.column, copy.label, copy.close]) {
        await expectInside(
          dialog.getByRole("button", { name, exact: true }),
          width,
          height,
          44,
        );
      }
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    async function pick(
      facet: string,
      query: string,
      id: string,
      duplicateId: string,
    ) {
      await trigger.click();
      await dialog.getByRole("button", { name: facet, exact: true }).click();
      const input = dialog.getByRole("combobox", {
        name: `${copy.search} — ${facet}`,
      });
      await expect(input).toBeFocused();
      await input.fill(query);
      const shortId = (value: string) =>
        facet === copy.board ? value.slice(-8) : value.slice(0, 8);
      const option = dialog.getByRole("option", {
        name: new RegExp(shortId(id)),
      });
      await expect(
        dialog.getByRole("option", {
          name: new RegExp(shortId(duplicateId)),
        }),
      ).toBeVisible();
      if (mobile) {
        await expectInside(input, width, height, 44);
        await expectInside(option, width, height, 44);
      }
      if (mobile && facet === copy.label) {
        await input.fill(id);
        await expect(dialog.getByRole("option")).toHaveCount(1);
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Enter");
      } else {
        await option.click();
      }
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
    }

    await pick(copy.board, boardTitle, board.id, otherBoardId);
    await pick(copy.column, columnTitle, columnId, duplicateColumnId);
    await pick(copy.label, labelTitle, labelId, duplicateLabelId);
    const cardRow = page.getByTestId(`admin-card-row-${cardId}`);
    await expect(cardRow).toBeVisible();
    await expect(page.getByTestId("admin-filter-results")).toHaveText(
      mobile
        ? "Фильтры применены · Результатов: 1"
        : "Filters applied · Results: 1",
    );
    await expect(page).toHaveURL(
      (url) =>
        url.searchParams.get("boardId") === board.id &&
        url.searchParams.get("columnId") === columnId &&
        url.searchParams.getAll("labelId").join() === labelId &&
        url.searchParams.get("returnTo") === "/admin",
    );
    const focusedList = page.url();
    await page.reload();
    await expect(cardRow).toBeVisible();
    const labelRemove = page.getByRole("button", {
      name: new RegExp(`${copy.remove}: ${copy.label}.*${labelId.slice(0, 8)}`),
    });
    await labelRemove.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL((url) => !url.searchParams.has("labelId"));
    await page.goBack();
    await expect(page).toHaveURL(focusedList);
    await expect(labelRemove).toBeVisible();
    await page.goForward();
    await expect(labelRemove).toHaveCount(0);
    await page.goBack();
    await expect(cardRow).toBeVisible();
    await cardRow.press("Enter");
    await expect(page).toHaveURL((url) =>
      url.pathname.endsWith(`/admin/cards/${cardId}`),
    );
    await page.getByRole("link", { name: copy.back, exact: true }).click();
    await expect(page).toHaveURL(focusedList);

    // Card is an existing deep-link-only filter.
    const deepLink = new URL(focusedList);
    deepLink.searchParams.set("cardId", cardId);
    await page.goto(deepLink.href);
    for (const [key, name, id, parent] of [
      ["boardId", boardTitle, board.id, ""],
      ["columnId", columnTitle, columnId, board.id.slice(-8)],
      ["labelId", labelTitle, labelId, board.id.slice(-8)],
      [
        "cardId",
        cardTitle,
        cardId,
        `${board.id.slice(-8)}/${columnId.slice(0, 8)}`,
      ],
    ]) {
      const chip = page.getByTestId(`admin-filter-${key}`);
      const remove = chip.getByRole("button");
      const title = chip.locator(".truncate");
      await expect(title).toHaveAttribute("title", name);
      const shortId = key === "boardId" ? id.slice(-8) : id.slice(0, 8);
      await expect(chip).toContainText(shortId);
      if (parent) await expect(chip).toContainText(parent);
      await expect(remove).toHaveAccessibleName(new RegExp(shortId));
      if (mobile) {
        await expectInside(chip, width, height, 44);
        await expectInside(remove, width, height, 44);
        expect((await chip.boundingBox())?.width).toBeLessThanOrEqual(320);
        expect(
          await title.evaluate(
            (element) =>
              getComputedStyle(element).textOverflow === "ellipsis" &&
              element.scrollWidth > element.clientWidth,
          ),
        ).toBe(true);
      }
    }
    await expect(page.getByTestId("admin-filter-cardId")).toContainText(
      copy.archived,
    );
    if (mobile) {
      for (const status of copy.statuses) {
        await expectInside(
          page.getByRole("button", { name: status, exact: true }),
          width,
          height,
          44,
        );
      }
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.getByRole("button", { name: copy.clear, exact: true }).click();
    await expect(page).toHaveURL(
      (url) =>
        !["boardId", "columnId", "labelId", "cardId"].some((id) =>
          url.searchParams.has(id),
        ),
    );
  });
}
