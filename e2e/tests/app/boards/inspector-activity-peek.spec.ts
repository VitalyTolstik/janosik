import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { setTimeout as wait } from "node:timers/promises";

import { test, expect } from "@/fixtures/board.js";

const axeSource = readFileSync(
  createRequire(import.meta.url).resolve("axe-core"),
  "utf8",
);
const inspectorToggle = '[aria-controls="board-inspector"]';

test("board clicks select only with the inspector open, and Enter, double-click and the peek open the editor", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const first = await board.card(todo, "Release checklist");
  await board.card(todo, "Follow-up");
  await page.setViewportSize({ width: 1440, height: 900 });
  await board.open(page);
  const card = page
    .getByTestId("card-title")
    .filter({ hasText: "Release checklist" });
  const editor = page.getByRole("dialog", { name: "Card details" });
  const toggle = page.locator(inspectorToggle);

  await card.click();
  await expect(editor).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();

  await toggle.click();
  await page.getByRole("tab", { name: "Card", exact: true }).click();
  await card.click();
  await expect(editor).toBeHidden();
  await expect(page).not.toHaveURL(/[?&]card=/);
  const selection = page.getByRole("group", {
    name: "Release checklist",
    exact: true,
  });
  await expect(selection).toHaveAttribute("aria-current", "true");
  const inspector = page.locator(".board-inspector");
  await expect(
    inspector.getByRole("heading", { name: "Release checklist" }),
  ).toBeVisible();

  await selection.press("Enter");
  await expect(editor).toBeVisible();
  await expect(inspector).toHaveAttribute("inert", "");
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();

  await card.dblclick();
  await expect(editor).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();

  await inspector.getByRole("button", { name: "Open full card" }).click();
  await expect(editor).toBeVisible();
  await expect(editor.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();

  await inspector.getByRole("tab", { name: "Activity" }).click();
  const activity = inspector.getByRole("tabpanel", { name: "Activity" });
  await expect(activity.getByRole("listitem")).toHaveCount(1);
  await expect(activity).not.toContainText("Follow-up");
  await activity.getByRole("button", { name: "Board activity" }).click();
  await expect(activity).toContainText("Follow-up");
  await expect(selection).not.toHaveAttribute("aria-current");
  await card.click();

  await board.command({ type: "DELETE_CARD", cardId: first });
  await inspector.getByRole("tab", { name: "Card", exact: true }).click();
  await expect(inspector).toContainText("This card is no longer available.");
  await expect(
    inspector.getByRole("button", { name: "Open full card" }),
  ).toHaveCount(0);
});

for (const width of [390, 1024]) {
  test.describe(() => {
    test.use({ hasTouch: width === 390 });
    test(`opens the full card from the ${width}px inspector and hands off focus`, async ({
      page,
      board,
    }) => {
      const column = await board.column("Todo");
      await board.card(column, "Release checklist");
      await page.setViewportSize({ width, height: 900 });
      await board.open(page);

      if (width === 390) {
        await page.getByRole("button", { name: "Peek in inspector" }).tap();
      } else {
        await page.getByTestId("card-title").click({ button: "right" });
        await page.getByRole("menuitem", { name: "Peek in inspector" }).click();
      }

      const panel = page.getByRole("dialog", { name: "Inspector" });
      await expect(panel).toBeVisible();
      await expect(
        panel.getByRole("tab", { name: "Card", exact: true }),
      ).toBeFocused();
      await panel.getByRole("button", { name: "Open full card" }).click();
      const editor = page.getByRole("dialog", { name: "Card details" });
      await expect(editor).toBeVisible();
      await expect(editor.locator(":focus")).toHaveCount(1);
      await expect(page.locator(".inspector-scrim")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(editor).toBeHidden();
      if (width === 390) {
        await expect(panel).toBeHidden();
        await expect(page.locator(inspectorToggle)).toHaveAttribute(
          "aria-expanded",
          "false",
        );
        // The sheet closed before the editor opened, so its "Open full card"
        // button is gone; the toggle is the panel's surviving doorway (H5).
        await expect(page.locator(inspectorToggle)).toBeFocused();
      } else {
        await expect(panel).toBeVisible();
        await expect(panel).toBeFocused();
      }
    });
  });
}

test("Watch and Activity share one request per interval, and the last consumer and hidden tabs pause the feed", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  await board.card(todo, "First card");
  await page.setViewportSize({ width: 1440, height: 900 });
  await board.open(page);
  await page.emulateMedia({ reducedMotion: "reduce" });

  let requests = 0;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === `/api/v1/boards/${board.id}/activity`
    )
      requests += 1;
  });
  const views = page.getByRole("group", { name: "View", exact: true });
  await views.getByRole("button", { name: "Watch" }).click();
  await expect(page.getByTestId("watch-feed")).toBeVisible();
  const toggle = page.locator(inspectorToggle);
  await toggle.click();
  const panel = page.locator(".board-inspector");
  await panel.getByRole("tab", { name: "Activity" }).click();
  await expect(panel.getByRole("listitem").first()).toBeVisible();
  expect(requests).toBe(1);
  await panel.getByRole("tab", { name: "People" }).click();
  await panel.getByRole("tab", { name: "Activity" }).click();
  expect(requests).toBe(1);
  await expect.poll(() => requests).toBe(2);

  await toggle.click();
  await expect(panel).toBeHidden();
  await expect.poll(() => requests).toBe(3);
  await views.getByRole("button", { name: "Board", exact: true }).click();
  await expect(page.getByTestId("watch-view")).toHaveCount(0);
  await wait(3200);
  expect(requests).toBe(3);

  await toggle.click();
  await expect.poll(() => requests).toBe(4);
  async function setHidden(hidden: boolean) {
    await page.evaluate((value) => {
      Object.defineProperty(document, "hidden", { configurable: true, value });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);
  }
  await setHidden(true);
  await wait(3200);
  expect(requests).toBe(4);
  await setHidden(false);
  await expect.poll(() => requests).toBe(5);

  await board.card(todo, "New card from another client");
  const activity = panel.getByRole("tabpanel", { name: "Activity" });
  const newActivity = activity.getByRole("button", { name: "New activity" });
  await expect(newActivity).toBeVisible({ timeout: 10000 });
  await expect(activity).not.toContainText("New card from another client");
  await expect(activity.getByRole("status")).toBeEmpty();
  await newActivity.click();
  await expect(activity.getByRole("listitem").first()).toContainText(
    "New card from another client",
  );
  await expect(activity.getByRole("status")).toHaveText("New activity shown.");
});

test("the peek fits the minimum and maximum dock widths at 1920px", async ({
  page,
  board,
}) => {
  const column = await board.column("Todo");
  const title = "UnbrokenTitle".repeat(13);
  await board.card(column, title);
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await board.open(page);
  await page.locator(inspectorToggle).click();
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await inspector.getByRole("tab", { name: "Card", exact: true }).click();
  await page.getByTestId("card-title").filter({ hasText: title }).click();
  await expect(
    inspector.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  const separator = inspector.getByRole("separator");
  for (const [key, width] of [
    ["Home", 320],
    ["End", 480],
  ] as const) {
    await separator.press(key);
    await expect(inspector).toHaveCSS("width", `${width}px`);
    const overflow = await inspector
      .getByRole("tabpanel")
      .evaluate((body) => body.scrollWidth - body.clientWidth);
    expect(overflow).toBe(0);
  }
});

const labels = {
  en: { card: "Card", activity: "Activity", peek: "Peek in inspector" },
  ru: {
    card: "Карточка",
    activity: "Активность",
    peek: "Просмотреть в инспекторе",
  },
};

for (const width of [390, 1440]) {
  for (const mode of ["light", "dark"] as const) {
    for (const lang of ["en", "ru"] as const) {
      test(`Card and Activity at ${width}px in ${mode} ${lang} have no overflow or axe violations`, async ({
        page,
        board,
      }, testInfo) => {
        const title =
          lang === "ru"
            ? "Уточнить сообщения об ошибках при оплате"
            : "Refine checkout error states";
        const foldedTitle = `${title} · ${"preproduction".repeat(7)}`;
        const titleColumn = lang === "ru" ? "В работе" : "In progress";
        const column = await board.column(titleColumn);
        await board.column(lang === "ru" ? "Запланировано" : "Backlog");
        await board.column(lang === "ru" ? "Проверка" : "Review");
        const card = await board.card(column, foldedTitle);
        await board.card(
          column,
          lang === "ru"
            ? "Проверить оформление заказа"
            : "Review checkout flow",
        );
        const label = await board.label(
          lang === "ru" ? "Пользовательский интерфейс" : "User experience",
          "red",
        );
        await board.command({
          type: "SET_CARD_LABEL",
          cardId: card,
          labelId: label,
          on: true,
        });
        await board.command({
          type: "SET_CARD_ASSIGN",
          cardId: card,
          assigneeId: board.userId,
        });
        await board.command({
          type: "SET_CARD_DUE_DATE",
          cardId: card,
          dueDate: Date.now() + 604800000,
        });
        await board.command({
          type: "SET_CARD_PRIORITY",
          cardId: card,
          priority: "high",
        });
        await board.command({
          type: "UPDATE_CARD",
          cardId: card,
          description:
            lang === "ru"
              ? "Объяснить, почему платёж не прошёл, списаны ли средства и что делать дальше."
              : "Explain why payment failed, whether money moved, and what the customer can do next.",
        });
        const checklistId = randomUUID();
        const itemId = randomUUID();
        await board.command({
          type: "ADD_CHECKLIST",
          cardId: card,
          newChecklistId: checklistId,
          title: "Checks",
        });
        await board.command({
          type: "ADD_CHECKLIST_ITEM",
          cardId: card,
          checklistId,
          newItemId: itemId,
          text: "Verify payment",
        });
        await board.command({
          type: "SET_CHECKLIST_ITEM_DONE",
          cardId: card,
          checklistId,
          itemId,
          done: true,
        });

        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: mode, reducedMotion: "reduce" });
        await board.open(page);
        await page.evaluate(
          (theme) => localStorage.setItem("janosik-theme", theme),
          mode,
        );
        const localized = new URL(page.url());
        localized.searchParams.set("lng", lang);
        await page.goto(localized.href);
        await expect(page.locator("html")).toHaveClass(new RegExp(mode));
        await expect(page.locator("html")).toHaveAttribute("lang", lang);

        const face = page.getByTestId("card-title").filter({ hasText: title });
        const panel = page.locator(".board-inspector");
        if (width === 390) {
          await page
            .getByRole("group", { name: foldedTitle, exact: true })
            .getByRole("button", { name: labels[lang].peek })
            .click();
        } else {
          await page.locator(inspectorToggle).click();
          await panel
            .getByRole("tab", { name: labels[lang].card, exact: true })
            .click();
          await face.click();
        }
        await expect(
          panel.getByRole("heading", { name: foldedTitle, exact: true }),
        ).toBeVisible();
        await expect(
          panel.getByText(/payment failed|платёж не прошёл/),
        ).toBeVisible();
        const peek = panel.getByRole("tabpanel", { name: labels[lang].card });
        await expect(
          peek.locator(
            "input, select, textarea, [contenteditable], [draggable], [role=checkbox]",
          ),
        ).toHaveCount(0);
        await expect(peek.getByRole("button")).toHaveCount(1);

        await page.evaluate(axeSource as unknown as () => void);
        for (const view of ["card", "activity"] as const) {
          await panel
            .getByRole("tab", { name: labels[lang][view], exact: true })
            .click();
          const body = panel.getByRole("tabpanel", {
            name: labels[lang][view],
          });
          if (view === "activity")
            await expect(body.getByRole("listitem").first()).toBeVisible();
          const overflow = await body.evaluate((element) => ({
            panel: element.scrollWidth - element.clientWidth,
            document: document.documentElement.scrollWidth - window.innerWidth,
          }));
          expect(overflow).toEqual({ panel: 0, document: 0 });
          const clip = await page.screenshot({
            path: testInfo.outputPath(`${width}-${mode}-${lang}-${view}.png`),
          });
          await testInfo.attach(`${view} at ${width}px in ${mode} ${lang}`, {
            body: clip,
            contentType: "image/png",
          });
          const violations = await page.evaluate(async () => {
            const { axe } = window as unknown as {
              axe: typeof import("axe-core");
            };
            return (
              await axe.run(document, {
                runOnly: {
                  type: "tag",
                  values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
                },
              })
            ).violations.map(({ id, nodes }) => ({
              id,
              targets: nodes.map(({ target }) => target),
            }));
          });
          expect.soft(violations).toEqual([]);
        }
      });
    }
  }
}
