import type { Locator, Page } from "@playwright/test";

import { test, expect } from "@/fixtures/board.js";

/**
 * The global toast stack is portalled next to the body, so it cannot rely on
 * the agent sheet's stacking context. These browser checks pin the actual
 * geometry: a phone/tablet toast must clear both the sheet close control and
 * the Live footer action, and the Runs footer reserve must survive the
 * cascade that sets the 50 px base.
 */

async function openControl(page: Page) {
  await page.getByTestId("agent-control-trigger").click();
  const dialog = page.getByTestId("agent-control-dialog");
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(250);
  return dialog;
}

async function showBoardPauseToast(page: Page) {
  const dialog = await openControl(page);
  await dialog.getByTestId("agent-pause-tab").click();
  await expect(dialog.getByTestId("agent-live-empty")).toBeVisible();
  await dialog.getByTestId("board-pause").click();
  await page.getByTestId("board-pause-reason").fill("Toast geometry probe");
  await page.getByTestId("board-pause-confirm").click();
  const toast = page.locator(".janosik-toast").last();
  await expect(toast).toBeVisible();
  return { dialog, toast };
}

type Box = { x: number; y: number; width: number; height: number };

function intersect(a: Box, b: Box) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

async function expectToastClear(page: Page, dialog: Locator, toast: Locator) {
  const toastBox = await toast.boundingBox();
  const closeBox = await dialog
    .getByRole("button", { name: "Close" })
    .first()
    .boundingBox();
  const footerBox = await page.getByTestId("board-resume").boundingBox();
  expect(toastBox).not.toBeNull();
  expect(closeBox).not.toBeNull();
  expect(footerBox).not.toBeNull();

  const state = await page.evaluate(() => ({
    open: document.documentElement.dataset.agentControlOpen ?? null,
    offset: getComputedStyle(document.documentElement).getPropertyValue(
      "--agent-control-toast-offset",
    ),
    bottom: getComputedStyle(
      document.querySelector<HTMLElement>(".janosik-toast-region")!,
    ).bottom,
  }));
  expect(intersect(toastBox!, closeBox!), `toast ∩ close ${state.open}`).toBe(
    false,
  );
  expect(
    intersect(toastBox!, footerBox!),
    `toast ${JSON.stringify(toastBox)} ∩ footer ${JSON.stringify(footerBox)} ${JSON.stringify(state)}`,
  ).toBe(false);

  // Hit-test the control centres: a transparent toast wrapper could still
  // intercept a tap even when the visual card looks clear.
  for (const [name, box] of [
    ["close", closeBox!],
    ["footer", footerBox!],
  ] as const) {
    const covered = await page.evaluate(
      ({ x, y }) => {
        const hit = document.elementFromPoint(x, y);
        return hit?.closest(".janosik-toast") !== null;
      },
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    );
    expect(covered, `${name} hit-test`).toBe(false);
  }
}

test("390 toast clears the agent sheet close and Live footer", async ({
  page,
  board,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await board.open(page);
  const { dialog, toast } = await showBoardPauseToast(page);
  await expectToastClear(page, dialog, toast);
});

test("768 toast clears the agent sheet close and Live footer", async ({
  page,
  board,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await board.open(page);
  const { dialog, toast } = await showBoardPauseToast(page);
  await expectToastClear(page, dialog, toast);
});

test("1366×768 toast clears the short desktop sheet footer", async ({
  page,
  board,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await board.open(page);
  const { dialog, toast } = await showBoardPauseToast(page);
  await expectToastClear(page, dialog, toast);
});

test("1440×820 toast clears the short desktop sheet footer", async ({
  page,
  board,
}) => {
  await page.setViewportSize({ width: 1440, height: 820 });
  await board.open(page);
  const { dialog, toast } = await showBoardPauseToast(page);
  await expectToastClear(page, dialog, toast);
});

test("1600×900 toast clears the centred desktop sheet footer", async ({
  page,
  board,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await board.open(page);
  const { dialog, toast } = await showBoardPauseToast(page);
  await expectToastClear(page, dialog, toast);
});

test("768 Runs footer reserves the tablet action row", async ({
  page,
  board,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await board.open(page);
  const dialog = await openControl(page);
  await dialog.getByTestId("agent-runs-tab").click();
  await expect(dialog.getByTestId("agent-runs-panel")).toBeVisible();

  const padding = await page
    .locator(".ac-body--overlay-footer")
    .evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).paddingBottom),
    );
  expect(padding).toBeGreaterThanOrEqual(61);
});
