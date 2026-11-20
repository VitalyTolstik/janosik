import type { Locator } from "@playwright/test";
import { test, expect } from "@/fixtures/admin.js";
import { adminPath, loginAsMaster } from "@/helpers/admin.js";

const english = {
  comments: "Comments",
  attachments: "Attachments",
  commentsDialog: "Filters for comments",
  attachmentsDialog: "Filters for attachments",
  trigger: /^Filters(?: \d+)?$/,
  author: "Author",
  kind: "Comment kind",
  blocker: "Blocker",
  question: "Question",
  apply: "Apply",
  uploader: "Uploader",
  mime: "File type",
  mimeGroup: "File type filter",
  documents: "Documents",
  transcode: "Video processing",
  transcodeGroup: "Video processing filter",
  none: "No transcoding",
  any: "Any",
  inline: "Inline",
  detached: "Detached",
  periods: ["Any time", "24 hours", "7 days", "30 days"],
  statuses: ["All", "Active", "Deleted"],
  total: "Filters applied · Results: 2",
  noMatches: "No attachments match these filters.",
};

const russian: typeof english = {
  comments: "Комментарии",
  attachments: "Вложения",
  commentsDialog: "Фильтры комментариев",
  attachmentsDialog: "Фильтры вложений",
  trigger: /^Фильтры(?: \d+)?$/,
  author: "Автор",
  kind: "Тип комментария",
  blocker: "Блокер",
  question: "Вопрос",
  apply: "Применить",
  uploader: "Кто загрузил",
  mime: "Тип файла",
  mimeGroup: "Фильтр по типу файла",
  documents: "Документы",
  transcode: "Обработка видео",
  transcodeGroup: "Фильтр по обработке видео",
  none: "Без перекодирования",
  any: "Любой вариант",
  inline: "Встроено",
  detached: "Отсоединено",
  periods: ["За всё время", "24 часа", "7 дней", "30 дней"],
  statuses: ["Все", "Активен", "Удалён"],
  total: "Фильтры применены · Результатов: 2",
  noMatches: "Нет вложений, соответствующих этим фильтрам.",
};

async function expectInside(
  control: Locator,
  viewportWidth: number,
  minHeight = 0,
) {
  await control.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => {
      const box = await control.boundingBox();
      return (
        box !== null &&
        box.x >= -0.1 &&
        box.y >= -0.1 &&
        box.x + box.width <= viewportWidth + 0.1 &&
        box.y + box.height <= 900.1 &&
        box.height >= minHeight
      );
    })
    .toBe(true);
}

for (const width of [1440, 1024, 390]) {
  test(`operator uses moderation filters at ${width}px`, async ({
    page,
    board,
    operator,
  }) => {
    const mobile = width === 390;
    const copy = mobile ? russian : english;
    const boardTitle = `${board.title} ${"Long board title ".repeat(5)}`.slice(
      0,
      100,
    );
    const cardTitle = "Card with a long title "
      .repeat(14)
      .slice(0, 300)
      .trimEnd();
    await board.command({ type: "RENAME_BOARD", title: boardTitle });
    const columnId = await board.column(
      "Long column title ".repeat(6).slice(0, 100),
    );
    const cardId = await board.card(columnId, cardTitle);
    for (const [kind, text] of [
      ["blocker", "Blocked on review"],
      ["question", "Who can look?"],
      ["note", "Ordinary note"],
    ]) {
      const response = await board.api.post(
        `/api/v1/cards/${cardId}/comments`,
        {
          data: { kind, text },
        },
      );
      expect(response.status()).toBe(201);
    }
    for (const [query, fileName] of [
      ["inline=1", "inline-moderation.txt"],
      ["description=1", "detached-moderation.txt"],
    ]) {
      const response = await board.api.post(
        `/api/v1/cards/${cardId}/attachments?${query}`,
        {
          multipart: {
            file: {
              name: fileName,
              mimeType: "text/plain",
              buffer: Buffer.from("moderation fixture"),
            },
          },
        },
      );
      expect(response.status()).toBe(201);
    }

    await page.setViewportSize({ width, height: 900 });
    await loginAsMaster(page, operator);
    await page.goto(
      adminPath(
        `moderation?tab=comments&boardId=${board.id}&cardId=${cardId}&period=7d&returnTo=%2Fadmin${mobile ? "&lng=ru" : ""}`,
      ),
    );

    const trigger = page.getByRole("button", { name: copy.trigger });
    const tabs = page.getByTestId("admin-hub-tabs");
    const comments = tabs.getByRole("tab", { name: copy.comments });
    const attachments = tabs.getByRole("tab", { name: copy.attachments });
    await expect(comments).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("button", { name: copy.periods[2], exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("row").filter({ hasText: "Blocked on review" }),
    ).toContainText(copy.blocker);

    const openFacet = async (title: string, facet: string) => {
      await trigger.focus();
      await page.keyboard.press("Space");
      const dialog = page.getByRole("dialog", { name: title });
      await expect(dialog).toBeVisible();
      expect((await dialog.boundingBox())?.width).toBeLessThanOrEqual(
        mobile ? 390 : 320,
      );
      const button = dialog.getByRole("button", { name: facet, exact: true });
      if (mobile) await expectInside(button, width, 44);
      await button.click();
      return dialog;
    };

    const author = await openFacet(copy.commentsDialog, copy.author);
    const search = author.getByRole("combobox");
    await search.fill(board.email);
    const option = author.getByRole("option", {
      name: new RegExp(board.email),
    });
    await expect(option).toBeVisible();
    if (mobile) await expectInside(option, width, 44);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(trigger).toBeFocused();
    await expect(page.getByTestId("admin-filter-authorId")).toContainText(
      board.email,
    );

    const kind = await openFacet(copy.commentsDialog, copy.kind);
    await kind.getByRole("checkbox", { name: copy.blocker }).check();
    await kind.getByRole("checkbox", { name: copy.question }).check();
    expect(new URL(page.url()).searchParams.has("kind")).toBe(false);
    const apply = kind.getByRole("button", { name: copy.apply, exact: true });
    if (mobile) await expectInside(apply, width, 44);
    await apply.click();
    await expect(page.getByTestId("admin-filter-results")).toHaveText(
      copy.total,
    );
    expect(new URL(page.url()).searchParams.getAll("kind")).toEqual([
      "blocker",
      "question",
    ]);
    await expect(page.getByText("Ordinary note")).toHaveCount(0);

    if (mobile) {
      for (const tab of [comments, attachments]) await expectInside(tab, width);
      for (const label of [...copy.statuses, ...copy.periods]) {
        await expectInside(
          page.getByRole("button", { name: label, exact: true }),
          width,
          44,
        );
      }
      for (const chip of await page
        .getByTestId(/admin-filter-clear-(boardId|cardId|authorId|kind)/)
        .all()) {
        await expectInside(chip, width, 24);
        const box = await chip.locator("..").boundingBox();
        expect(box?.width).toBeLessThanOrEqual(320);
      }
      expect(
        await page.getByTestId("admin-filter-cardId").getAttribute("title"),
      ).toContain(cardTitle);
      expect(
        await page.getByTestId("admin-filter-boardId").getAttribute("title"),
      ).toContain(boardTitle);
      const cardChip = page.getByTestId("admin-filter-clear-cardId");
      await expect(cardChip).toHaveAccessibleName(new RegExp(cardTitle));
      await cardChip.focus();
      await page.keyboard.press("Enter");
      await expect(cardChip).toHaveCount(0);
    }

    await attachments.click();
    await expect(
      page.getByRole("heading", { name: copy.attachments, exact: true }),
    ).toBeVisible();
    expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({
      tab: "attachments",
      boardId: board.id,
      returnTo: "/admin",
    });
    await expect(
      page.getByRole("row").filter({ hasText: "inline-moderation.txt" }),
    ).toContainText(copy.inline);
    await expect(
      page.getByRole("row").filter({ hasText: "detached-moderation.txt" }),
    ).toContainText(copy.detached);
    await expect(page.getByTestId("admin-filter-boardId")).toContainText(
      boardTitle,
    );

    const uploader = await openFacet(copy.attachmentsDialog, copy.uploader);
    await uploader.getByRole("combobox").fill(board.email);
    await uploader
      .getByRole("option", { name: new RegExp(board.email) })
      .click();
    await expect(page.getByTestId("admin-filter-uploadedById")).toContainText(
      board.email,
    );
    const mime = await openFacet(copy.attachmentsDialog, copy.mime);
    const types = mime.getByRole("radiogroup", { name: copy.mimeGroup });
    if (mobile) {
      for (const radio of await types.getByRole("radio").all())
        await expectInside(radio, width, 44);
    }
    await types.getByRole("radio", { name: copy.documents }).click();
    await expect(page.getByTestId("admin-filter-mime")).toHaveText(
      copy.documents,
    );

    const transcode = await openFacet(copy.attachmentsDialog, copy.transcode);
    const statuses = transcode.getByRole("radiogroup", {
      name: copy.transcodeGroup,
    });
    await expect(statuses.getByRole("radio", { name: copy.any })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Space");
    await expect(trigger).toBeFocused();
    await expect(page.getByTestId("admin-filter-transcode")).toHaveText(
      copy.none,
    );
    await expect(page.getByTestId("admin-filter-results")).toHaveText(
      copy.total,
    );
    const media = await openFacet(copy.attachmentsDialog, copy.mime);
    await media.getByRole("radio", { name: "PDF" }).click();
    await expect(page.getByText(copy.noMatches)).toBeVisible();

    const recent = page.getByRole("button", {
      name: copy.periods[1],
      exact: true,
    });
    await recent.click();
    await page.reload();
    await expect(recent).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(copy.noMatches)).toBeVisible();
    await expect(page.getByTestId("admin-filter-transcode")).toHaveText(
      copy.none,
    );
    await comments.click();
    await expect(page.getByText("Ordinary note")).toBeVisible();
    expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({
      tab: "comments",
      boardId: board.id,
      returnTo: "/admin",
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}
