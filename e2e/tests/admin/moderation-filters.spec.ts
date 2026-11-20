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
  evidence: "Evidence",
  apply: "Apply",
  cancel: "Cancel",
  uploader: "Uploader",
  mime: "File type",
  mimeGroup: "File type filter",
  documents: "Documents",
  transcode: "Video processing",
  transcodeGroup: "Video processing filter",
  none: "No transcoding",
  transcodeStates: ["Pending", "Failed", "Done"],
  any: "Any",
  inline: "Inline",
  detached: "Detached",
  periods: ["Any time", "24 hours", "7 days", "30 days"],
  statuses: ["All", "Active", "Deleted"],
  total: "Filters applied · Results: 2",
  noComments: "No comments match these filters.",
  noAttachments: "No attachments match these filters.",
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
  evidence: "Подтверждение",
  apply: "Применить",
  cancel: "Отмена",
  uploader: "Кто загрузил",
  mime: "Тип файла",
  mimeGroup: "Фильтр по типу файла",
  documents: "Документы",
  transcode: "Обработка видео",
  transcodeGroup: "Фильтр по обработке видео",
  none: "Без перекодирования",
  transcodeStates: [
    "Обработка: в очереди",
    "Обработка: ошибка",
    "Обработка: готово",
  ],
  any: "Любой вариант",
  inline: "Встроено",
  detached: "Отсоединено",
  periods: ["За всё время", "24 часа", "7 дней", "30 дней"],
  statuses: ["Все", "Активен", "Удалён"],
  total: "Фильтры применены · Результатов: 2",
  noComments: "Нет комментариев, соответствующих этим фильтрам.",
  noAttachments: "Нет вложений, соответствующих этим фильтрам.",
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
    const files = [
      {
        query: "inline=1",
        name: `inline-moderation-${"filename".repeat(14)}.txt`,
        badge: copy.inline,
      },
      {
        query: "description=1",
        name: `detached-moderation-${"filename".repeat(14)}.txt`,
        badge: copy.detached,
      },
    ];
    for (const { query, name } of files) {
      const response = await board.api.post(
        `/api/v1/cards/${cardId}/attachments?${query}`,
        {
          multipart: {
            file: {
              name,
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

    const filteredComments = page.url();
    const kindDraft = await openFacet(copy.commentsDialog, copy.kind);
    await kindDraft.getByRole("checkbox", { name: copy.blocker }).uncheck();
    await kindDraft.getByRole("checkbox", { name: copy.evidence }).check();
    await kindDraft
      .getByRole("button", { name: copy.cancel, exact: true })
      .click();
    await expect(kindDraft).toBeHidden();
    await expect(page).toHaveURL(filteredComments);
    await expect(page.getByTestId("admin-filter-results")).toHaveText(
      copy.total,
    );

    const noMatchesDraft = await openFacet(copy.commentsDialog, copy.kind);
    const blockerChoice = noMatchesDraft.getByRole("checkbox", {
      name: copy.blocker,
    });
    const evidenceChoice = noMatchesDraft.getByRole("checkbox", {
      name: copy.evidence,
    });
    await expect(blockerChoice).toBeChecked();
    await expect(evidenceChoice).not.toBeChecked();
    await blockerChoice.uncheck();
    await noMatchesDraft
      .getByRole("checkbox", { name: copy.question })
      .uncheck();
    await evidenceChoice.check();
    await noMatchesDraft
      .getByRole("button", { name: copy.apply, exact: true })
      .click();
    await expect(page.getByText(copy.noComments)).toBeVisible();
    expect(new URL(page.url()).searchParams.getAll("kind")).toEqual([
      "evidence",
    ]);
    await page.goBack();
    await expect(page).toHaveURL(filteredComments);
    await expect(page.getByTestId("admin-filter-results")).toHaveText(
      copy.total,
    );

    await page
      .getByTestId("admin-filter-clear-kind")
      .and(page.locator('[data-filter-value="blocker"]'))
      .click();
    expect(new URL(page.url()).searchParams.getAll("kind")).toEqual([
      "question",
    ]);
    await expect(page.getByText("Who can look?")).toBeVisible();
    await expect(page.getByText("Blocked on review")).toHaveCount(0);
    await page.getByTestId("admin-filter-clear-authorId").click();
    await expect(page.getByTestId("admin-filter-authorId")).toHaveCount(0);
    expect(new URL(page.url()).searchParams.has("authorId")).toBe(false);
    expect(new URL(page.url()).searchParams.getAll("kind")).toEqual([
      "question",
    ]);
    await page.goBack();
    await page.goBack();
    await expect(page).toHaveURL(filteredComments);
    await expect(page.getByTestId("admin-filter-authorId")).toContainText(
      board.email,
    );
    await expect(page.getByTestId("admin-filter-kind")).toHaveCount(2);

    await attachments.click();
    await expect(
      page.getByRole("heading", { name: copy.attachments, exact: true }),
    ).toBeVisible();
    expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({
      tab: "attachments",
      boardId: board.id,
      returnTo: "/admin",
    });
    for (const { name, badge } of files) {
      const fileCell = page.getByRole("cell").filter({ hasText: name });
      await expect(fileCell).toContainText(badge);
      await expect(
        fileCell.getByRole("button", { name, exact: true }),
      ).toBeVisible();
      if (mobile)
        expect((await fileCell.boundingBox())?.width).toBeLessThanOrEqual(320);
    }
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
    await expect(statuses.getByRole("radio")).toHaveText([
      copy.any,
      ...copy.transcodeStates,
      copy.none,
    ]);
    await expect(statuses.getByRole("radio", { name: copy.any })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(
      statuses.getByRole("radio", { name: copy.transcodeStates[0] }),
    ).toBeFocused();
    await page.keyboard.press("End");
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
    await expect(page.getByText(copy.noAttachments)).toBeVisible();

    const recent = page.getByRole("button", {
      name: copy.periods[1],
      exact: true,
    });
    await recent.click();
    await page.reload();
    await expect(recent).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(copy.noAttachments)).toBeVisible();
    await expect(page.getByTestId("admin-filter-transcode")).toHaveText(
      copy.none,
    );
    const filteredAttachments = page.url();
    await page.getByTestId("admin-filter-clear-uploadedById").click();
    await expect(page.getByTestId("admin-filter-uploadedById")).toHaveCount(0);
    expect(new URL(page.url()).searchParams.has("uploadedById")).toBe(false);
    expect(new URL(page.url()).searchParams.get("mime")).toBe("pdf");
    await page.goBack();
    await expect(page).toHaveURL(filteredAttachments);
    await expect(page.getByTestId("admin-filter-uploadedById")).toContainText(
      board.email,
    );
    await comments.click();
    await expect(page.getByText("Ordinary note")).toBeVisible();
    expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({
      tab: "comments",
      boardId: board.id,
      returnTo: "/admin",
    });
    const unfilteredComments = page.url();
    await page.goBack();
    await expect(page).toHaveURL(filteredAttachments);
    await expect(attachments).toHaveAttribute("aria-selected", "true");
    await expect(recent).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("admin-filter-uploadedById")).toContainText(
      board.email,
    );
    await expect(page.getByText(copy.noAttachments)).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(unfilteredComments);
    await expect(comments).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Ordinary note")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}
