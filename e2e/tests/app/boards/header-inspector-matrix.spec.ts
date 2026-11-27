import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { test, expect } from "@/fixtures/board.js";
import { login } from "@/fixtures/auth.js";
import { boardColumn, dragCardToColumn } from "@/helpers/boards.js";
import { acceptInvitation, inviteMember } from "@/helpers/collaboration.js";
import { openMembers } from "@/helpers/header.js";

const axeSource = readFileSync(
  createRequire(import.meta.url).resolve("axe-core"),
  "utf8",
);
const inspectorToggle = '[aria-controls="board-inspector"]';

/**
 * H5 full matrix: 390–1920 × light/dark × EN/RU. Each cell checks the
 * document has no horizontal overflow, the People tab is still first, the
 * panel keeps its own overflow at zero, and axe (WCAG 2 A/AA) reports no
 * violations on the page with the board, the open inspector and Watch.
 *
 * The same cells write the header/panel after-screenshots under
 * `.artifacts/h5/visual/after/` (the before set lives next to them).
 */
const visualDir = fileURLToPath(
  new URL("../../../../.artifacts/h5/visual/after/", import.meta.url),
);
mkdirSync(visualDir, { recursive: true });

const labels = {
  en: {
    people: "People",
    activity: "Activity",
    card: "Card",
    close: "Close inspector",
    status: "Board status",
    peopleName: /^People/,
  },
  ru: {
    people: "Люди",
    activity: "Активность",
    card: "Карточка",
    close: "Закрыть инспектор",
    status: "Статус доски",
    peopleName: /^Люди/,
  },
} as const;

async function noOverflow(
  page: import("@playwright/test").Page,
  width: number,
) {
  expect(
    await page.evaluate(() => ({
      document: document.documentElement.scrollWidth - window.innerWidth,
      headerOverflow:
        document.querySelector("header")!.scrollWidth - window.innerWidth,
    })),
  ).toEqual({ document: 0, headerOverflow: 0 });
  expect(
    await page.evaluate(
      () => document.querySelector("header")!.getBoundingClientRect().width,
    ),
  ).toBeLessThanOrEqual(width);
}

async function documentAxe(page: import("@playwright/test").Page) {
  await page.evaluate(axeSource as unknown as () => void);
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
  expect(violations).toEqual([]);
}

for (const width of [390, 768, 1024, 1440, 1920]) {
  test(`H5 matrix at ${width}px: overflow, People-first tabs and full-page axe`, async ({
    page,
    board,
  }) => {
    test.setTimeout(180_000);
    const todo = await board.column("Todo");
    for (const name of ["Ready", "Done"]) await board.column(name);
    const card = await board.card(todo, "Matrix card");
    await board.command({
      type: "SET_CARD_ASSIGN",
      cardId: card,
      assigneeId: board.userId,
    });
    await page.setViewportSize({ width, height: 900 });
    await board.open(page);

    for (const theme of ["light", "dark"] as const) {
      for (const lang of ["en", "ru"] as const) {
        await page.emulateMedia({
          colorScheme: theme,
          reducedMotion: "reduce",
        });
        await page.evaluate(
          ({ theme, view }) => {
            localStorage.setItem("janosik-theme", theme);
            localStorage.setItem("janosik-board-view", view);
          },
          { theme, view: "board" },
        );
        const localized = new URL(page.url());
        localized.searchParams.set("lng", lang);
        await page.goto(localized.href);
        await expect(page.getByTestId("board-main")).toBeVisible();
        await expect(page.locator("html")).toHaveClass(
          new RegExp(`\\b${theme}\\b`),
        );
        await expect(page.locator("html")).toHaveAttribute("lang", lang);
        await page.evaluate(() => document.fonts.ready);
        await expect(page.getByTestId("people-trigger")).toHaveAttribute(
          "aria-label",
          labels[lang].peopleName,
        );

        await noOverflow(page, width);
        await page
          .locator("header")
          .first()
          .screenshot({
            path: `${visualDir}${width}-${theme}-${lang}-header.png`,
            animations: "disabled",
          });
        await documentAxe(page);

        await page.locator(inspectorToggle).click();
        const panel = page.locator(".board-inspector");
        await expect(panel).toBeVisible();
        await expect(panel).toHaveAttribute(
          "data-mode",
          width >= 1440 ? "dock" : width >= 768 ? "drawer" : "sheet",
        );
        expect(await panel.getByRole("tab").allTextContents()).toEqual([
          labels[lang].people,
          labels[lang].activity,
          labels[lang].card,
        ]);
        await expect(
          panel.getByRole("tab", { name: labels[lang].people, selected: true }),
        ).toBeVisible();
        expect(
          await panel
            .getByRole("tabpanel")
            .evaluate((body) => body.scrollWidth - body.clientWidth),
        ).toBe(0);
        await noOverflow(page, width);
        await panel.screenshot({
          path: `${visualDir}${width}-${theme}-${lang}-panel.png`,
          animations: "disabled",
        });
        await documentAxe(page);
        await panel.getByRole("button", { name: labels[lang].close }).click();
        await expect(panel).toBeHidden();

        await page.evaluate(() =>
          localStorage.setItem("janosik-board-view", "watch"),
        );
        const watch = new URL(page.url());
        watch.searchParams.set("lng", lang);
        await page.goto(watch.href);
        await expect(page.getByTestId("watch-view")).toBeVisible();
        await expect(page.getByTestId("watch-feed")).toBeVisible();
        const status = page.getByRole("region", {
          name: labels[lang].status,
        });
        await expect(status).toHaveAttribute("tabindex", "0");
        await status.focus();
        await expect(status).toBeFocused();
        expect(
          await status.evaluate(
            (element) => element.scrollWidth - element.clientWidth,
          ),
        ).toBe(0);
        await noOverflow(page, width);
        await documentAxe(page);
      }
    }
  });
}

for (const width of [390, 768]) {
  test(`Members keeps the profile readable at ${width}px`, async ({
    page,
    board,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await board.open(page);
    const dialog = await openMembers(page);
    const profile = dialog.getByTestId("board-member-open").first();
    await expect(profile).toBeVisible();
    const box = await profile.boundingBox();
    // The self row's profile must own a real row instead of collapsing to an
    // avatar-width sliver beside the role/leave controls.
    expect(box!.width).toBeGreaterThan(width === 390 ? 230 : 200);
    const email = dialog.getByTestId("board-member-email").first();
    await expect(email).toHaveText(board.email);
    expect(
      await email.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBe(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBe(0);
    await dialog.screenshot({
      path: `${visualDir}members-${width}.png`,
      animations: "disabled",
    });
  });
}

test("keeps the complete lapsed expiry label at 768", async ({
  page,
  board,
  browser,
  createUser,
}) => {
  const invitee = await createUser();
  await page.setViewportSize({ width: 768, height: 900 });
  await board.open(page);
  await inviteMember(page, invitee.email, "Viewer");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("board-members-box")).toBeHidden();

  const inviteeContext = await browser.newContext({ locale: "en-US" });
  try {
    const inviteePage = await inviteeContext.newPage();
    await login(inviteePage, invitee);
    await acceptInvitation(inviteePage, board.title);
  } finally {
    await inviteeContext.close();
  }

  const members = (await (
    await board.api.get(`/api/v1/boards/${board.id}/members`)
  ).json()) as { userId: string; email: string }[];
  const userId = members.find(
    (member) => member.email === invitee.email,
  )!.userId;
  const expiry = new Date(Date.now() - 60_000).toISOString();
  const updated = await board.api.patch(
    `/api/v1/boards/${board.id}/members/${userId}`,
    { data: { role: "VIEWER", expiresAt: expiry } },
  );
  expect(updated.ok(), await updated.text()).toBeTruthy();

  const dialog = await openMembers(page);
  const row = dialog
    .getByTestId("board-member-row")
    .filter({ hasText: invitee.email });
  const label = row.getByTestId("board-member-expiry");
  await expect(label).toHaveText(/until .*access expired/);
  expect(
    await label.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    ),
  ).toBe(0);
  await row.screenshot({
    path: `${visualDir}members-lapsed-768.png`,
    animations: "disabled",
  });
});

test.describe("long assignee email", () => {
  test.use({ hasTouch: true });

  test("wraps the card peek assignee at 390 without overflow", async ({
    page,
    board,
  }) => {
    const todo = await board.column("Todo");
    const card = await board.card(todo, "Assigned card");
    await board.command({
      type: "SET_CARD_ASSIGN",
      cardId: card,
      assigneeId: board.userId,
    });
    await page.setViewportSize({ width: 390, height: 900 });
    await board.open(page);
    await page.getByRole("button", { name: "Peek in inspector" }).tap();
    const panel = page.getByRole("dialog", { name: "Inspector" });
    await expect(panel).toBeVisible();
    await panel.getByRole("tab", { name: "Card", exact: true }).click();
    const email = panel.getByText(board.email, { exact: true });
    await expect(email).toBeVisible();
    expect(
      await email.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBe(0);
    expect(
      await panel.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBe(0);
    await panel.screenshot({
      path: `${visualDir}card-peek-390.png`,
      animations: "disabled",
    });
  });
});

test("drags a card while the dock is open and keeps the panel open", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  await board.column("Done");
  await board.card(todo, "Dragged with panel open");
  await page.setViewportSize({ width: 1440, height: 900 });
  await board.open(page);
  const toggle = page.locator(inspectorToggle);
  await toggle.click();
  const panel = page.locator(".board-inspector");
  await expect(panel).toBeVisible();

  await dragCardToColumn(page, "Dragged with panel open", "Done");
  await expect(
    boardColumn(page, "Done")
      .getByTestId("card-title")
      .filter({ hasText: "Dragged with panel open" }),
  ).toBeVisible();
  await expect(panel).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("dialog", { name: "Card details" })).toHaveCount(
    0,
  );
  await expect(toggle).toBeEnabled();
});

test("reduced motion removes inspector transitions at both modes", async ({
  page,
  board,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 900 });
  await board.open(page);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator(inspectorToggle).click();
    const panel = page.locator(".board-inspector");
    await expect(panel).toBeVisible();
    const motion = await panel.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        animation: style.animationName,
        transition: style.transitionDuration,
      };
    });
    expect(motion.animation).toBe("none");
    // Browsers report `transition: none` as 1e-05s; anything below a
    // millisecond is imperceptible and proves the 200 ms drawer is gone.
    if (width >= 1440)
      expect(Number.parseFloat(motion.transition)).toBeLessThan(0.001);
    await panel.getByRole("button", { name: "Close inspector" }).click();
    await expect(panel).toBeHidden();
  }
});
