import { type Locator, type Page } from "@playwright/test";

import { expect, test, type BoardFixture } from "@/fixtures/board.js";
import { expectNoPageOverflow } from "@/helpers/touch.js";

/**
 * TASK-177.18 (U-07): mobile safe-area opt-in and card-label readability.
 *
 * `env(safe-area-inset-*)` resolves to 0 in headless Chromium, so the geometry
 * assertions below pin the *fallback*: the phone header keeps its 6 px / 12 px
 * spacing (no double padding) while the viewport meta opts into `cover` for a
 * real standalone iOS window. The label checks cover both input modalities —
 * touch hides the hover quick actions, hover shows them on the due row so
 * they can never sit on top of a label chip. 1440 px is the desktop control.
 */

async function seededCard(page: Page, board: BoardFixture) {
  const todo = await board.column("Todo");
  const labelId = await board.label("Design", "blue");
  const cardId = await board.card(todo, "Safe-area card");
  await board.command({ type: "SET_CARD_LABEL", cardId, labelId, on: true });
  await board.open(page);

  const title = page
    .getByTestId("card-title")
    .filter({ hasText: "Safe-area card" });
  await expect(title).toBeVisible();
  const card = title.locator("xpath=ancestor::article");
  const labels = card.getByTestId("card-labels");
  const chip = labels.getByText("Design", { exact: true });
  await expect(chip).toBeVisible();
  return { card, labels, chip, title };
}

async function expectLabelInsideLane(
  labels: Locator,
  chip: Locator,
  { full = true }: { full?: boolean } = {},
) {
  const [lane, label] = await Promise.all([
    labels.boundingBox(),
    chip.boundingBox(),
  ]);
  expect(lane, "label lane has no box").not.toBeNull();
  expect(label, "label chip has no box").not.toBeNull();
  if (!lane || !label) return;
  // The chip starts inside the lane in every layout.
  expect(label.x).toBeGreaterThanOrEqual(lane.x - 0.5);
  expect(label.x).toBeLessThan(lane.x + lane.width);
  if (full) {
    // Phone: the whole chip fits. It keeps its intrinsic width (`shrink-0`);
    // if it were clipped by the lane/mask, its box would poke past the right
    // edge.
    expect(label.x + label.width).toBeLessThanOrEqual(
      lane.x + lane.width + 0.5,
    );
  }
  // The chip must never start outside the lane. A full-width lane must also
  // fit it horizontally; the old clipped 25% lane was a desktop-only design
  // that no longer applies to labelled cards.
  expect(label.y).toBeGreaterThanOrEqual(lane.y - 0.5);
  expect(label.y + label.height).toBeLessThanOrEqual(
    lane.y + lane.height + 0.5,
  );
}

async function expectOutsideActions(
  labels: Locator,
  chip: Locator,
  actions: Locator[],
) {
  const [lane, label] = await Promise.all([
    labels.boundingBox(),
    chip.boundingBox(),
  ]);
  if (!lane || !label) throw new Error("label lane or chip has no box");
  for (const action of actions) {
    const box = await action.boundingBox();
    if (!box) continue;
    const overlaps =
      label.x < box.x + box.width &&
      label.x + label.width > box.x &&
      label.y < box.y + box.height &&
      label.y + label.height > box.y;
    expect(
      overlaps,
      `label chip [${Math.round(label.x)}..${Math.round(label.x + label.width)}] ` +
        `is covered by a quick action [${Math.round(box.x)}..${Math.round(box.x + box.width)}]`,
    ).toBe(false);
  }
}

test.describe("390 px touch", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("opts into viewport-fit=cover and keeps the header and label on screen", async ({
    page,
    board,
  }) => {
    const { card, labels, chip } = await seededCard(page, board);
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
      "content",
      /viewport-fit=cover/,
    );
    await expectNoPageOverflow(page, "390 board");

    const header = page.locator("header").first();
    const padding = await header.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        top: Number.parseFloat(style.paddingTop),
        left: Number.parseFloat(style.paddingLeft),
      };
    });
    // `max()` fallback: env() is 0 here, so this is the old py-1.5 / px-3
    // token, not the safe-area value added on top of it.
    expect(padding.top).toBeCloseTo(6, 0);
    expect(padding.left).toBeCloseTo(12, 0);

    await expect(card).toBeInViewport();
    await expectLabelInsideLane(labels, chip);

    // Touch devices keep the quick actions out of the way entirely, so the
    // label owns the first row.
    await expect(card.getByTestId("card-archive")).toBeHidden();
    await expect(
      card.getByRole("button", { name: "Duplicate card" }),
    ).toBeHidden();
  });
});

test.describe("390 px hover", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("hover actions stay clear of the label chip", async ({
    page,
    board,
  }) => {
    const { card, labels, chip } = await seededCard(page, board);
    await expectNoPageOverflow(page, "390 hover board");
    await card.hover();

    const archive = card.getByTestId("card-archive");
    const duplicate = card.getByRole("button", { name: "Duplicate card" });
    await expect(archive).toBeVisible();
    await expect(duplicate).toBeVisible();
    await expect
      .poll(() =>
        archive.evaluate((element) => getComputedStyle(element).opacity),
      )
      .toBe("1");

    await expectLabelInsideLane(labels, chip);
    // The archive confirmation replaces the archive button in the same slot
    // and only exists after arming it; it adds no coverage to this hover
    // geometry check, so assert only the two visible quick actions.
    await expect(card.getByTestId("card-archive-confirm")).toHaveCount(0);
    await expectOutsideActions(labels, chip, [archive, duplicate]);
  });
});

test.describe("1440 px desktop control", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("keeps the label lane and the desktop header unchanged", async ({
    page,
    board,
  }) => {
    const { card, labels, chip, title } = await seededCard(page, board);
    await expectNoPageOverflow(page, "1440 board");
    await card.hover();

    const header = page.locator("header").first();
    const paddingTop = await header.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).paddingTop),
    );
    // sm:py-0 — the safe-area padding must not leak into the desktop header.
    expect(paddingTop).toBeCloseTo(0, 0);

    // Labelled cards give the title the full row and move the chips to a
    // dedicated lane below it; the old 75/25 split only applies to cards
    // without labels now.
    const titleBox = await title.boundingBox();
    const titleRowBox = await title.locator("xpath=..").boundingBox();
    expect(titleBox, "title has no box").not.toBeNull();
    expect(titleRowBox, "title row has no box").not.toBeNull();
    if (titleBox && titleRowBox) {
      expect(titleBox.width / titleRowBox.width).toBeGreaterThan(0.95);
    }

    await expectLabelInsideLane(labels, chip);
    await expectOutsideActions(labels, chip, [
      card.getByTestId("card-archive"),
      card.getByRole("button", { name: "Duplicate card" }),
    ]);
  });
});
