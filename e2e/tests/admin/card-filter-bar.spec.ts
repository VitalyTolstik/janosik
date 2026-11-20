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
  apply: "Apply",
  periods: ["Any time", "24 hours", "7 days", "30 days"],
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
  apply: "Применить",
  periods: ["За всё время", "24 часа", "7 дней", "30 дней"],
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
      const isLabel = facet === copy.label;
      const input = dialog.getByRole(isLabel ? "searchbox" : "combobox", {
        name: `${copy.search} — ${facet}`,
      });
      const optionRole = isLabel ? "checkbox" : "option";
      await expect(input).toBeFocused();
      await input.fill(query);
      const shortId = (value: string) =>
        facet === copy.board ? value.slice(-8) : value.slice(0, 8);
      const option = dialog.getByRole(optionRole, {
        name: new RegExp(shortId(id)),
      });
      await expect(
        dialog.getByRole(optionRole, {
          name: new RegExp(shortId(duplicateId)),
        }),
      ).toBeVisible();
      if (mobile) {
        await expectInside(input, width, height, 44);
        await expectInside(
          isLabel ? option.locator("..") : option,
          width,
          height,
          44,
        );
      }
      if (mobile && isLabel) {
        await input.fill(id);
        await expect(dialog.getByRole("checkbox")).toHaveCount(1);
        await option.focus();
        await page.keyboard.press("Space");
      } else {
        await option.click();
      }
      if (isLabel) {
        await expect(option).toBeChecked();
        await expect(page).toHaveURL((url) => !url.searchParams.has("labelId"));
        const apply = dialog.getByRole("button", {
          name: copy.apply,
          exact: true,
        });
        if (mobile) await expectInside(apply, width, height, 44);
        await apply.press("Enter");
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
      mobile ? "Фильтры применены · найдено 1" : "Filters applied · 1 results",
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
    await expect(page.getByTestId("admin-filter-clear-columnId")).toBeFocused();
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
    for (const [key, name, id, parent, fullParent] of [
      ["boardId", boardTitle, board.id, "", ""],
      ["columnId", columnTitle, columnId, board.id.slice(-8), board.id],
      ["labelId", labelTitle, labelId, board.id.slice(-8), board.id],
      [
        "cardId",
        cardTitle,
        cardId,
        `${board.id.slice(-8)}/${columnId.slice(0, 8)}`,
        `${board.id}/${columnId}`,
      ],
    ]) {
      const chip = page.getByTestId(`admin-filter-${key}`);
      const remove = chip.getByRole("button");
      const title = chip.locator(".truncate");
      await expect(title).toHaveAttribute(
        "title",
        `${name} · ${id}${fullParent ? ` · ${fullParent}` : ""}`,
      );
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
      for (const status of [...copy.statuses, ...copy.periods]) {
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
    await expect(trigger).toBeFocused();
  });
}

test("names a conflicting column and removes only that filter", async ({
  page,
  board,
}) => {
  const columnId = await board.column("Matching column");
  const otherBoard = await board.api.post("/api/v1/boards", {
    data: { title: "Other board" },
  });
  expect(otherBoard.status()).toBe(201);
  const { id: otherBoardId } = (await otherBoard.json()) as { id: string };

  await loginAsMaster(page, ownerCredentials());
  await page.goto(
    adminPath(`boards?tab=cards&boardId=${otherBoardId}&columnId=${columnId}`),
  );
  const value = `Column — Matching column · ${columnId.slice(0, 8)}`;
  const conflict = page.getByRole("alert");
  await expect(conflict).toHaveCount(1);
  await expect(conflict).toHaveText(
    `${value} refers to a different board or column.`,
  );
  await expect(page).toHaveURL(
    (url) => url.searchParams.get("columnId") === columnId,
  );
  await expect(page.getByText("No cards match these filters.")).toBeVisible();
  await page
    .getByRole("button", { name: `Remove conflict: ${value}`, exact: true })
    .click();
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("boardId") === otherBoardId &&
      !url.searchParams.has("columnId"),
  );
  await expect(page.getByTestId("admin-filter-clear-boardId")).toBeFocused();
  await expect(conflict).toHaveCount(0);
});

test("retries a failed lookup for an applied filter", async ({
  page,
  board,
}) => {
  const columnId = await board.column("Lookup column");
  const cardId = await board.card(columnId, "Lookup card");
  await loginAsMaster(page, ownerCredentials());
  await page.route(
    (url) =>
      url.pathname === "/api/v1/admin/filter-options" &&
      url.searchParams.get("type") === "column" &&
      url.searchParams.get("ids") === columnId,
    (route) => route.fulfill({ status: 500, json: {} }),
    { times: 1 },
  );
  await page.goto(adminPath(`boards?tab=cards&columnId=${columnId}`));
  const failure = page.getByRole("status").filter({
    hasText: /^Could not look up filter values\.$/,
  });
  await expect(failure).toBeVisible();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(failure).toHaveCount(0);
  await expect(page.getByTestId("admin-filter-columnId")).toContainText(
    "Lookup column",
  );
  await expect(page.getByTestId(`admin-card-row-${cardId}`)).toBeVisible();
  await expect(page).toHaveURL(
    (url) => url.searchParams.get("columnId") === columnId,
  );
});

test("announces and removes an unsupported filter", async ({ page, board }) => {
  const columnId = await board.column("Supported board column");
  const cardId = await board.card(columnId, "Supported board card");
  const labelId = await board.label("Unsupported label", "green");
  await loginAsMaster(page, ownerCredentials());
  await page.route(
    (url) =>
      url.pathname === "/api/v1/admin/entities/cards" &&
      url.searchParams.get("labelId") === labelId,
    (route) =>
      route.fulfill({
        status: 400,
        json: { code: "unsupported_filter", filter: "labelId" },
      }),
  );
  await page.goto(
    adminPath(`boards?tab=cards&boardId=${board.id}&labelId=${labelId}`),
  );
  const alert = page.getByRole("alert");
  await expect(alert).toHaveText(
    "This list does not support the filter “Label”.",
  );
  const cardRow = page.getByTestId(`admin-card-row-${cardId}`);
  await expect(cardRow).toHaveCount(0);
  await page
    .getByRole("button", { name: "Remove filter: Label", exact: true })
    .click();
  await expect(cardRow).toBeVisible();
  await expect(alert).toHaveCount(0);
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("boardId") === board.id &&
      !url.searchParams.has("labelId"),
  );
  await expect(page.getByTestId("admin-filter-clear-boardId")).toBeFocused();
});

test("announces invalid filters and restores focus after clearing them", async ({
  page,
  board,
}) => {
  const columnId = await board.column("Valid column");
  const cardId = await board.card(columnId, "Valid card");
  await loginAsMaster(page, ownerCredentials());
  await page.goto(
    adminPath(`boards?tab=cards&boardId=${board.id}&boardId=duplicate-board`),
  );
  const empty = page.getByTestId("admin-empty-state");
  await expect(empty.getByRole("alert")).toHaveText(
    "The URL contains invalid filters.",
  );
  const cardRow = page.getByTestId(`admin-card-row-${cardId}`);
  await expect(cardRow).toHaveCount(0);
  await empty.getByRole("button", { name: english.clear, exact: true }).click();
  await expect(page).toHaveURL((url) => !url.searchParams.has("boardId"));
  await expect(empty.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Filters", exact: true }),
  ).toBeFocused();
  await expect(cardRow).toBeVisible();
});

test("Escape closes an open facet picker and returns focus to Filters", async ({
  page,
  board,
}) => {
  const columnId = await board.column("Escape column");
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath(`boards?tab=cards&boardId=${board.id}`));
  const trigger = page.getByRole("button", { name: "Filters 1", exact: true });
  await trigger.press("Enter");
  const dialog = page.getByRole("dialog", { name: english.dialog });
  await dialog
    .getByRole("button", { name: "Column", exact: true })
    .press("Enter");
  const input = dialog.getByRole("combobox", {
    name: "Search options — Column",
  });
  await expect(input).toBeFocused();
  await expect(
    dialog.getByRole("button", { name: "Back to Column" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("option", { name: new RegExp(columnId.slice(0, 8)) }),
  ).toBeVisible();
  await input.press("ArrowDown");
  await expect(input).toHaveAttribute("aria-activedescendant", /.+/);
  await input.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page).toHaveURL((url) => !url.searchParams.has("columnId"));
});

const cardFacetCopy = {
  en: {
    assignee: "Assignee",
    unassignedControl: "Unassigned assignee",
    unassigned: "Unassigned",
    cancel: "Cancel",
    anyLabel: "Any label",
    allLabels: "All labels",
    labelMode: "Label match mode",
    labelChip: "Label match: All",
    removeMode: "Remove filter: Label match — All",
    priority: "Priority",
    medium: "Medium",
    high: "High",
    due: "Due date",
    dueGroup: "Due date filter",
    dueChoices: ["Overdue", "Due in 24 hours", "No due date"],
    attachments: "Card attachments",
    attachmentsGroup: "Card attachment filter",
    attachmentChoices: ["Has card attachments", "No card attachments"],
    any: "Any",
    results: (total: number) => `Filters applied · ${total} results`,
  },
  ru: {
    assignee: "Исполнитель",
    unassignedControl: "Карточки без исполнителя",
    unassigned: "Без исполнителя",
    cancel: "Отмена",
    anyLabel: "Любая метка",
    allLabels: "Все метки",
    labelMode: "Режим совпадения меток",
    labelChip: "Совпадение меток: все",
    removeMode: "Удалить фильтр: Совпадение меток — Все",
    priority: "Приоритет",
    medium: "Средний",
    high: "Высокий",
    due: "Срок",
    dueGroup: "Фильтр по сроку",
    dueChoices: ["Просрочено", "Срок в течение 24 часов", "Без срока"],
    attachments: "Файлы карточки",
    attachmentsGroup: "Фильтр по файлам карточки",
    attachmentChoices: ["С файлами карточки", "Без файлов карточки"],
    any: "Любой вариант",
    results: (total: number) => `Фильтры применены · найдено ${total}`,
  },
};

for (const locale of ["en", "ru"] as const) {
  test(`full cards facets with ${locale} controls and exact totals`, async ({
    page,
    board,
  }) => {
    const mobile = locale === "ru";
    const copy = mobile ? russian : english;
    const facet = cardFacetCopy[locale];
    const width = mobile ? 390 : 1024;
    const height = 900;
    const column = await board.column("Facet checks");
    const assigned = await board.card(column, "Assigned and overdue");
    const soon = await board.card(column, "Due soon");
    await board.card(column, "Without a due date");
    const labelA = await board.label("Facet label alpha");
    const labelB = await board.label("Facet label beta");
    for (const [cardId, labelId] of [
      [assigned, labelA],
      [assigned, labelB],
      [soon, labelA],
    ]) {
      await board.command({
        type: "SET_CARD_LABEL",
        cardId,
        labelId,
        on: true,
      });
    }
    await board.command({
      type: "SET_CARD_ASSIGN",
      cardId: assigned,
      assigneeId: board.userId,
    });
    await board.command({
      type: "SET_CARD_PRIORITY",
      cardId: soon,
      priority: "high",
    });
    const now = Date.now();
    await board.command({
      type: "SET_CARD_DUE_DATE",
      cardId: assigned,
      dueDate: now - 3_600_000,
    });
    await board.command({
      type: "SET_CARD_DUE_DATE",
      cardId: soon,
      dueDate: now + 3_600_000,
    });
    const uploaded = await board.api.post(
      `/api/v1/cards/${assigned}/attachments`,
      {
        multipart: {
          file: {
            name: "card-face.txt",
            mimeType: "text/plain",
            buffer: Buffer.from("Card face attachment"),
          },
        },
      },
    );
    expect(uploaded.status(), await uploaded.text()).toBe(201);

    await loginAsMaster(page, ownerCredentials());
    await page.setViewportSize({ width, height });
    await page.goto(
      adminPath(`boards?tab=cards&boardId=${board.id}&lng=${locale}`),
    );
    const trigger = page.getByRole("button", {
      name: new RegExp(`^${copy.filters}(?: \\d+)?$`),
    });
    const dialog = page.getByRole("dialog", { name: copy.dialog });
    const results = page.getByTestId("admin-filter-results");

    async function openFacet(name: string) {
      await trigger.press("Enter");
      const item = dialog.getByRole("button", { name, exact: true });
      await item.scrollIntoViewIfNeeded();
      if (mobile) await expectInside(item, width, height, 44);
      await item.press("Enter");
    }

    async function apply() {
      const button = dialog.getByRole("button", {
        name: copy.apply,
        exact: true,
      });
      if (mobile) await expectInside(button, width, height, 44);
      await button.press("Enter");
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
    }

    await expect(results).toHaveText(facet.results(3));
    for (const dismiss of [facet.cancel, "Escape"]) {
      await openFacet(facet.assignee);
      const unassigned = dialog.getByRole("checkbox", {
        name: facet.unassignedControl,
      });
      await expect(unassigned).not.toBeChecked();
      await unassigned.press("Space");
      await expect(unassigned).toBeChecked();
      await expect(page).toHaveURL(
        (url) => !url.searchParams.has("unassigned"),
      );
      if (dismiss === "Escape") await page.keyboard.press("Escape");
      else
        await dialog
          .getByRole("button", { name: dismiss, exact: true })
          .press("Enter");
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
    }
    await openFacet(facet.assignee);
    const assigneeSearch = dialog.getByRole("searchbox", {
      name: `${copy.search} — ${facet.assignee}`,
    });
    await assigneeSearch.fill(board.email);
    const assignee = dialog.getByRole("checkbox", {
      name: new RegExp(board.email.replaceAll(".", "\\.")),
    });
    await expect(assignee).toBeVisible();
    await assignee.press("Space");
    const unassigned = dialog.getByRole("checkbox", {
      name: facet.unassignedControl,
    });
    if (mobile) await expectInside(unassigned.locator(".."), width, height, 44);
    await unassigned.press("Space");
    await apply();
    await expect(page).toHaveURL(
      (url) =>
        url.searchParams.get("unassigned") === "true" &&
        url.searchParams.get("assigneeId") === board.userId,
    );
    const unassignedChip = page.getByTestId("admin-filter-unassigned");
    await expect(unassignedChip).toHaveText(facet.unassigned);
    const removeUnassigned = unassignedChip.getByRole("button", {
      name: `${copy.remove}: ${facet.unassigned}`,
      exact: true,
    });
    if (mobile) await expectInside(removeUnassigned, width, height, 44);
    await removeUnassigned.press("Enter");
    await expect(results).toHaveText(facet.results(1));
    await page.getByTestId("admin-filter-clear-assigneeId").press("Enter");

    await openFacet(copy.label);
    await dialog
      .getByRole("checkbox", { name: /Facet label alpha/ })
      .press("Space");
    await dialog
      .getByRole("checkbox", { name: /Facet label beta/ })
      .press("Space");
    const mode = dialog.getByRole("radiogroup", { name: facet.labelMode });
    const anyLabel = mode.getByRole("radio", { name: facet.anyLabel });
    const allLabels = mode.getByRole("radio", { name: facet.allLabels });
    await anyLabel.press("End");
    await expect(allLabels).toBeFocused();
    await page.keyboard.press("Space");
    await expect(allLabels).toHaveAttribute("aria-checked", "true");
    await expect(page).toHaveURL((url) => !url.searchParams.has("labelMatch"));
    await apply();
    await expect(page).toHaveURL(
      (url) =>
        url.searchParams.get("labelMatch") === "all" &&
        url.searchParams.getAll("labelId").length === 2,
    );
    await expect(results).toHaveText(facet.results(1));
    const modeChip = page.getByTestId("admin-filter-labelMatch");
    await expect(modeChip).toHaveText(facet.labelChip);
    const removeMode = modeChip.getByRole("button", {
      name: facet.removeMode,
      exact: true,
    });
    if (mobile) await expectInside(removeMode, width, height, 44);
    await removeMode.press("Enter");
    await expect(results).toHaveText(facet.results(2));
    await expect(page).toHaveURL((url) => !url.searchParams.has("labelMatch"));
    for (const name of [/Facet label alpha/, /Facet label beta/]) {
      await page
        .getByTestId("admin-filter-labelId")
        .getByRole("button", { name })
        .press("Enter");
    }

    await expect(page).toHaveURL((url) => !url.searchParams.has("labelId"));
    await expect(results).toHaveText(facet.results(3));

    await openFacet(facet.priority);
    const prioritySearch = dialog.getByRole("searchbox", {
      name: `${copy.search} — ${facet.priority}`,
    });
    if (mobile) await expectInside(prioritySearch, width, height, 44);
    await expect(prioritySearch).toBeFocused();
    for (const name of [facet.medium, facet.high]) {
      await dialog.getByRole("checkbox", { name, exact: true }).press("Space");
    }
    await apply();
    await expect(page).toHaveURL(
      (url) => url.searchParams.getAll("priority").join() === "high,medium",
    );
    for (const name of [facet.medium, facet.high]) {
      await page
        .getByRole("button", { name: `${copy.remove}: ${name}`, exact: true })
        .press("Enter");
    }
    await expect(page).toHaveURL((url) => !url.searchParams.has("priority"));

    for (const choice of [
      {
        key: "due",
        name: facet.due,
        group: facet.dueGroup,
        choices: facet.dueChoices,
        values: ["overdue", "soon", "none"],
        totals: [1, 1, 1],
      },
      {
        key: "hasAttachments",
        name: facet.attachments,
        group: facet.attachmentsGroup,
        choices: facet.attachmentChoices,
        values: ["true", "false"],
        totals: [1, 2],
      },
    ]) {
      await openFacet(choice.name);
      const radios = dialog.getByRole("radiogroup", { name: choice.group });
      const any = radios.getByRole("radio", { name: facet.any, exact: true });
      await expect(any).toBeFocused();
      await page.keyboard.press("End");
      await expect(radios.getByRole("radio").last()).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL((url) => !url.searchParams.has(choice.key));

      for (const [index, label] of choice.choices.entries()) {
        await openFacet(choice.name);
        const option = radios.getByRole("radio", { name: label, exact: true });
        if (mobile) await expectInside(option, width, height, 44);
        await option.press("Space");
        await expect(dialog).toBeHidden();
        await expect(trigger).toBeFocused();
        await expect(page).toHaveURL(
          (url) => url.searchParams.get(choice.key) === choice.values[index],
        );
        await expect(results).toHaveText(facet.results(choice.totals[index]));
        const chip = page.getByTestId(`admin-filter-${choice.key}`);
        await expect(chip).toHaveText(label);
        const remove = chip.getByRole("button", {
          name: `${copy.remove}: ${label}`,
          exact: true,
        });
        if (mobile) await expectInside(remove, width, height, 44);
        if (index === 0) {
          await openFacet(choice.name);
          await page.keyboard.press("Home");
          await expect(any).toBeFocused();
          await page.keyboard.press("Enter");
          await expect(dialog).toBeHidden();
        } else {
          await remove.press("Enter");
        }
        await expect(chip).toHaveCount(0);
        await expect(page).toHaveURL(
          (url) => !url.searchParams.has(choice.key),
        );
        await expect(results).toHaveText(facet.results(3));
      }
    }
    const recent = page.getByRole("button", {
      name: copy.periods[1],
      exact: true,
    });
    if (mobile) await expectInside(recent, width, height, 44);
    await recent.press("Enter");
    await expect(page).toHaveURL(
      (url) => url.searchParams.get("period") === "24h",
    );
    await page.reload();
    await expect(recent).toHaveAttribute("aria-pressed", "true");
    await expect(results).toHaveText(facet.results(3));
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}
