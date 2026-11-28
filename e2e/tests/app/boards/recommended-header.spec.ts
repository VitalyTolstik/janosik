import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { test, expect } from "@/fixtures/board.js";
import { login, randomIp } from "@/fixtures/auth.js";
import { acceptInvitation, inviteMember } from "@/helpers/collaboration.js";
import { openMembers, openShare } from "@/helpers/header.js";
import { appUrl, siteUrl } from "@/helpers/urls.js";

const axeSource = readFileSync(
  createRequire(import.meta.url).resolve("axe-core"),
  "utf8",
);
const visualDir = fileURLToPath(
  new URL("../../../../.artifacts/h5/visual/recommended/", import.meta.url),
);
mkdirSync(visualDir, { recursive: true });

const TOOLBAR_ROW = [
  "filter-search-input",
  "filter-facets-trigger",
  "saved-views-menu",
  "view-switcher",
  "bulk-select-toggle",
  "board-toolbar-menu",
] as const;

async function order(page: import("@playwright/test").Page, testIds: string[]) {
  const boxes: number[] = [];
  for (const id of testIds) {
    const box = await page.getByTestId(id).first().boundingBox();
    expect(box, `${id} is visible`).not.toBeNull();
    boxes.push(box!.x);
  }
  expect(boxes).toEqual([...boxes].sort((a, b) => a - b));
}

async function expectVisualOrder(
  page: import("@playwright/test").Page,
  testIds: string[],
) {
  const boxes: { id: string; x: number; y: number }[] = [];
  for (const id of testIds) {
    const box = await page.getByTestId(id).first().boundingBox();
    expect(box, `${id} is visible`).not.toBeNull();
    boxes.push({ id, x: box!.x, y: box!.y });
  }
  for (let index = 1; index < boxes.length; index += 1) {
    const previous = boxes[index - 1];
    const current = boxes[index];
    if (Math.abs(current.y - previous.y) <= 8) {
      expect(
        current.x,
        `${current.id} must sit after ${previous.id} on the same toolbar row`,
      ).toBeGreaterThan(previous.x);
    } else {
      expect(
        current.y,
        `${current.id} must start after ${previous.id}`,
      ).toBeGreaterThan(previous.y);
    }
  }
}

/** True when two layout boxes overlap on both axes. */
function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

async function documentAxe(page: import("@playwright/test").Page) {
  // Stable scan: the presence enter animation blends the avatar ink while it
  // runs, which makes a contrast check depend on wall-clock timing. Axe runs
  // on the settled UI, matching the reduced-motion requirement.
  await page.emulateMedia({ reducedMotion: "reduce" });
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

/** Full-page axe in Watch; the view switcher must stay mounted as the exit. */
async function documentAxeInWatch(page: import("@playwright/test").Page) {
  await page.getByTestId("view-watch").click();
  await expect(page.getByTestId("watch-view")).toBeVisible();
  await expect(page.getByTestId("view-switcher")).toBeVisible();
  await documentAxe(page);
}

async function seedBoard(board: import("@/fixtures/board.js").BoardFixture) {
  // Exercise two-letter initials (`TU`) as well as the one-letter fallback,
  // so axe's label-content-name-mismatch runs against human-recognisable
  // visible text on the People trigger and the card assignee.
  const named = await board.api.patch("/api/v1/users/me", {
    data: { displayName: "Test User" },
  });
  expect(named.ok(), await named.text()).toBeTruthy();
  await board.command({
    type: "RENAME_BOARD",
    title: "Sprint board 2026-W48",
  });
  const todo = await board.column("Todo");
  await board.column("Done");
  const card = await board.card(todo, "Recommended header card");
  await board.command({
    type: "SET_CARD_ASSIGN",
    cardId: card,
    assigneeId: board.userId,
  });
}

test("recommended header and toolbar structure at 1440", async ({
  page,
  board,
}) => {
  await seedBoard(board);
  await page.setViewportSize({ width: 1440, height: 900 });
  await board.open(page);

  // The right inspector is gone, including its trigger and shortcut target.
  await expect(page.locator('[aria-controls="board-inspector"]')).toHaveCount(
    0,
  );
  await expect(page.locator("#board-inspector")).toHaveCount(0);
  await expect(page.locator(".board-inspector")).toHaveCount(0);
  await expect(page.getByTestId("board-toolbar-menu")).toHaveCount(1);
  await expect(page.getByTestId("board-display-menu")).toHaveCount(0);

  // Row 1 order: brand → title → switcher → presence/People → Agents, then
  // Search → bell → undo → redo → board menu → account.
  await order(page, [
    "brand-home",
    "board-title",
    "board-switcher-trigger",
    "people-trigger",
    "agent-control-trigger",
  ]);
  await expect(page.getByRole("button", { name: "Search" })).toBeVisible();
  await order(page, [
    "global-search-trigger",
    "notifications-bell",
    "header-undo",
    "header-redo",
    "board-menu-trigger",
    "account-trigger",
  ]);
  const account = page.getByTestId("account-trigger");
  await expect(account).toContainText(/^[A-Z]{1,2}$/);
  await expect(account).not.toContainText(board.email);
  await expect(account).not.toContainText("Test User");

  // Two-word display name → visible `TU`; the accessible names must include
  // the visible initials or axe's label-content-name check fails.
  const people = page.getByTestId("people-trigger");
  await expect(people.getByTestId("people-avatar").first()).toContainText("TU");
  await expect.poll(() => people.getAttribute("aria-label")).toContain("TU");
  const assignee = page.getByTestId("card-assignee").first();
  await expect(assignee).toContainText("TU");
  await expect(assignee).toHaveAccessibleName(/ TU$/);

  // The mock's 1440 topbar has eleven interactive elements.
  expect(
    await page
      .locator("header")
      .first()
      .evaluate(
        (header) =>
          Array.from(
            header.querySelectorAll<HTMLElement>('a, button, [tabindex="0"]'),
          ).filter(
            (element) =>
              element.tabIndex >= 0 &&
              (typeof element.checkVisibility === "function"
                ? element.checkVisibility()
                : element.getClientRects().length > 0),
          ).length,
      ),
  ).toBe(11);

  // Row 2 is one line in the recommended order:
  // search → Filters → saved views → view switcher → Select → overflow.
  await expect(page.getByTestId("saved-views-menu")).toBeVisible();
  expect(
    await page
      .getByTestId("board-toolbar")
      .evaluate((toolbar) =>
        Array.from(toolbar.children).map(
          (child) =>
            (child as HTMLElement).dataset.testid ??
            child.querySelector<HTMLElement>("[data-testid]")?.dataset.testid,
        ),
      ),
  ).toEqual([
    "filter-search-region",
    "saved-views-menu",
    "view-switcher",
    "bulk-select-toggle",
    "board-toolbar-menu",
  ]);
  const toolbarRow = TOOLBAR_ROW;
  await expectVisualOrder(page, [...toolbarRow]);
  const rowTops = await Promise.all(
    toolbarRow.map(async (id) => {
      const box = await page.getByTestId(id).first().boundingBox();
      return Math.round(box!.y);
    }),
  );
  expect(Math.max(...rowTops) - Math.min(...rowTops)).toBeLessThanOrEqual(8);
  const searchBox = await page.getByTestId("filter-search-input").boundingBox();
  expect(searchBox!.width).toBeGreaterThan(300);
  await expect(page.getByRole("button", { name: /^Filters/ })).toBeVisible();
  const views = page.getByTestId("view-switcher");
  for (const name of ["Board", "Calendar", "Table", "Watch"]) {
    await expect(views.getByRole("button", { name })).toBeVisible();
  }
  await expect(page.getByTestId("bulk-select-toggle")).toBeVisible();

  // The toolbar overflow is present in Calendar and Table too; only Watch
  // keeps the slim toolbar without appearance controls.
  for (const name of ["calendar", "table"] as const) {
    await page.getByTestId(`view-${name}`).click();
    await expect(page.getByTestId("board-toolbar-menu")).toBeVisible();
  }
  await page.getByTestId("view-board").click();
  await expect(page.getByTestId("board-toolbar-menu")).toBeVisible();

  // The toolbar overflow is Board appearance only.
  await page.getByTestId("board-toolbar-menu").click();
  const toolbarMenu = page.getByRole("menu").last();
  await expect(toolbarMenu.getByTestId("density-toggle")).toBeVisible();
  await expect(toolbarMenu.getByTestId("glass-blur")).toBeVisible();
  await expect(toolbarMenu.getByTestId("column-style-menu")).toBeVisible();
  await expect(
    toolbarMenu.getByRole("menuitem", { name: "Board settings" }),
  ).toHaveCount(0);
  await expect(
    toolbarMenu.getByRole("menuitem", { name: /Data & backups/ }),
  ).toHaveCount(0);
  await expect(
    toolbarMenu.getByRole("menuitem", { name: /Card archive/ }),
  ).toHaveCount(0);
  await expect(toolbarMenu.getByRole("menuitem", { name: "Help" })).toHaveCount(
    0,
  );
  const toolbarLabels = await toolbarMenu
    .locator('[role^="menuitem"]')
    .allTextContents();
  await page.keyboard.press("Escape");

  // The header Board menu is the low-frequency menu only.
  await page.getByTestId("board-menu-trigger").click();
  const headerMenu = page.getByRole("menu").last();
  await expect(headerMenu.getByTestId("board-settings-trigger")).toBeVisible();
  await expect(headerMenu.getByTestId("board-menu-data")).toBeVisible();
  await expect(headerMenu.getByTestId("board-menu-archive")).toBeVisible();
  await expect(headerMenu.getByTestId("board-menu-help")).toBeVisible();
  await expect(headerMenu.getByTestId("density-toggle")).toHaveCount(0);
  const headerLabels = await headerMenu
    .locator('[role^="menuitem"]')
    .allTextContents();
  expect(headerLabels.filter((label) => toolbarLabels.includes(label))).toEqual(
    [],
  );
  await page.keyboard.press("Escape");

  // No horizontal overflow at the required desktop width.
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    )
    .toBe(0);

  for (const theme of ["light", "dark"] as const) {
    for (const lang of ["en", "ru"] as const) {
      await page.evaluate(
        ({ value, view }) => {
          localStorage.setItem("janosik-theme", value);
          localStorage.setItem("janosik-board-view", view);
        },
        { value: theme, view: "board" },
      );
      const localized = new URL(page.url());
      localized.searchParams.set("lng", lang);
      await page.goto(localized.href);
      await expect(page.getByTestId("board-title")).toBeVisible();
      await expect(page.locator("html")).toHaveClass(
        new RegExp(`\\b${theme}\\b`),
      );
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await documentAxe(page);
      if (lang === "en") {
        await page
          .locator("header")
          .first()
          .screenshot({
            path: `${visualDir}1440-${theme}-header.png`,
            animations: "disabled",
          });
        await page.screenshot({
          path: `${visualDir}1440-${theme}-board.png`,
          animations: "disabled",
        });
      }
      await documentAxeInWatch(page);
    }
  }
});

for (const width of [390, 768, 1024, 1920]) {
  test(`recommended header stays overflow-free and axe-clean at ${width}px`, async ({
    page,
    board,
  }) => {
    await seedBoard(board);
    await page.setViewportSize({ width, height: 900 });
    await board.open(page);

    for (const theme of ["light", "dark"] as const) {
      for (const lang of ["en", "ru"] as const) {
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
        await expect(page.getByTestId("board-title")).toBeVisible();
        await expect(page.locator("html")).toHaveClass(
          new RegExp(`\\b${theme}\\b`),
        );
        await expect(page.locator("html")).toHaveAttribute("lang", lang);
        await expect(page.getByTestId("view-switcher")).toBeVisible();
        await expectVisualOrder(page, [...TOOLBAR_ROW]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          ),
        ).toBe(0);
        await expect(page.locator("#board-inspector")).toHaveCount(0);
        await documentAxe(page);
        if (lang === "en") {
          await page
            .locator("header")
            .first()
            .screenshot({
              path: `${visualDir}${width}-${theme}-header.png`,
              animations: "disabled",
            });
          await page.screenshot({
            path: `${visualDir}${width}-${theme}-board.png`,
            animations: "disabled",
          });
        }
        await documentAxeInWatch(page);
      }
    }
  });
}

test("Watch keeps the view switcher and returns to Board", async ({
  page,
  board,
}) => {
  await seedBoard(board);
  await page.setViewportSize({ width: 1440, height: 900 });
  await board.open(page);
  const views = page.getByRole("group", { name: "View", exact: true });
  await views.getByRole("button", { name: "Watch" }).click();
  await expect(page.getByTestId("watch-view")).toBeVisible();
  // The filter bar is gone, but its slim toolbar keeps the only way back.
  await expect(page.getByTestId("filter-search-region")).toHaveCount(0);
  await expect(page.getByTestId("view-switcher")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("watch-view")).toBeVisible();
  await page
    .getByTestId("view-switcher")
    .getByRole("button", { name: "Board", exact: true })
    .click();
  await expect(page.getByTestId("filter-search-region")).toBeVisible();
  await expect(page.getByTestId("card-title")).toBeVisible();
});

for (const width of [390, 768]) {
  test(`Members keeps the profile readable at ${width}px from the header`, async ({
    page,
    board,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await board.open(page);
    const dialog = await openMembers(page);
    const profile = dialog.getByTestId("board-member-open").first();
    await expect(profile).toBeVisible();
    const box = await profile.boundingBox();
    expect(box!.width).toBeGreaterThan(width === 390 ? 230 : 200);
    const email = dialog.getByTestId("board-member-email").first();
    await expect(email).toHaveText(board.email);
    expect(
      await email.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBe(0);
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
});

test("Watch status rail is a named focusable region at 390 and 768", async ({
  page,
  board,
}) => {
  await seedBoard(board);
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 390) await board.open(page);
    const views = page.getByRole("group", { name: "View", exact: true });
    await views.getByRole("button", { name: "Watch" }).click();
    const status = page.getByRole("region", { name: "Board status" });
    await expect(status).toHaveAttribute("tabindex", "0");
    await status.focus();
    await expect(status).toBeFocused();
    expect(
      await status.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBe(0);
    await page
      .getByTestId("view-switcher")
      .getByRole("button", { name: "Board", exact: true })
      .click();
  }
});

test("Members and Share dialogs stay axe-clean at 390", async ({
  page,
  board,
}) => {
  await seedBoard(board);
  await page.setViewportSize({ width: 390, height: 900 });
  await board.open(page);
  const dialog = await openMembers(page);
  await expect(dialog.getByTestId("board-members-box")).toBeVisible();
  await documentAxe(page);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("board-members-box")).toHaveCount(0);

  const share = await openShare(page);
  await expect(share.getByTestId("share-ttl")).toBeVisible();
  await documentAxe(page);
});

test("Members and Share stay axe-clean for lapsed and expired rows at 390/768 light/dark", async ({
  page,
  board,
  browser,
  createUser,
}) => {
  const lapsed = await createUser();
  const pending = await createUser();
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();

  for (const [email, expiresAt] of [
    [lapsed.email, future],
    [pending.email, past],
  ] as const) {
    const invited = await board.api.post(`/api/v1/boards/${board.id}/members`, {
      data: { email, role: "VIEWER", expiresAt },
    });
    expect(invited.status(), await invited.text()).toBe(201);
  }

  // Accept the first invitation, then move that VIEWER into the lapsed state.
  // The second invitation stays pending and is already expired.
  const inviteeContext = await browser.newContext({ locale: "en-US" });
  try {
    const inviteePage = await inviteeContext.newPage();
    await login(inviteePage, lapsed);
    await acceptInvitation(inviteePage, board.title);
  } finally {
    await inviteeContext.close();
  }
  const members = (await (
    await board.api.get(`/api/v1/boards/${board.id}/members`)
  ).json()) as { userId: string; email: string }[];
  const lapsedId = members.find(
    (member) => member.email === lapsed.email,
  )!.userId;
  const updated = await board.api.patch(
    `/api/v1/boards/${board.id}/members/${lapsedId}`,
    { data: { role: "VIEWER", expiresAt: past } },
  );
  expect(updated.ok(), await updated.text()).toBeTruthy();

  await board.open(page);
  await page.emulateMedia({ reducedMotion: "reduce" });

  for (const width of [390, 768]) {
    for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(
        (value) => localStorage.setItem("janosik-theme", value),
        theme,
      );
      await page.reload();
      await expect(page.getByTestId("board-title")).toBeVisible();
      await expect(page.locator("html")).toHaveClass(
        new RegExp(`\\b${theme}\\b`),
      );

      await documentAxe(page);

      const dialog = await openMembers(page);
      await expect(dialog.getByTestId("board-pending-expired")).toBeVisible();
      await expect(
        dialog
          .getByTestId("board-member-expiry")
          .filter({ hasText: "expired" }),
      ).toBeVisible();
      await documentAxe(page);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("board-members-box")).toHaveCount(0);

      await openShare(page);
      await expect(page.getByTestId("share-ttl")).toBeVisible();
      await documentAxe(page);
      await page.keyboard.press("Escape");
    }
  }
});

test("People trigger stays axe-clean with a busy presence stack", async ({
  page,
  board,
  browser,
  createUser,
  playwright,
}) => {
  test.slow();
  await board.open(page);

  const contexts: import("@playwright/test").BrowserContext[] = [];
  const addPresence = async (index: number) => {
    const user = await createUser();
    const ip = randomIp();
    const unauthenticated = await playwright.request.newContext({
      baseURL: siteUrl,
      extraHTTPHeaders: { "X-Forwarded-For": ip },
    });
    let token: string;
    try {
      const logged = await unauthenticated.post("/api/v1/auth/login", {
        data: user,
      });
      expect(logged.ok()).toBeTruthy();
      token = ((await logged.json()) as { accessToken: string }).accessToken;
    } finally {
      await unauthenticated.dispose();
    }

    const api = await playwright.request.newContext({
      baseURL: siteUrl,
      extraHTTPHeaders: {
        "X-Forwarded-For": ip,
        Authorization: `Bearer ${token}`,
      },
    });
    try {
      const invited = await board.api.post(
        `/api/v1/boards/${board.id}/members`,
        { data: { email: user.email, role: "MEMBER" } },
      );
      expect(invited.status()).toBe(201);
      const invitations = (await (
        await api.get("/api/v1/invitations")
      ).json()) as { id: string; boardId: string }[];
      const invitation = invitations.find((item) => item.boardId === board.id);
      expect(invitation).toBeDefined();
      const accepted = await api.post(
        `/api/v1/invitations/${invitation!.id}/accept`,
      );
      expect(accepted.ok()).toBeTruthy();
      const named = await api.patch("/api/v1/users/me", {
        data: { displayName: `Presence ${index + 1}` },
      });
      expect(named.ok(), await named.text()).toBeTruthy();
    } finally {
      await api.dispose();
    }

    const context = await browser.newContext({
      extraHTTPHeaders: { "X-Forwarded-For": ip },
      locale: "en-US",
    });
    contexts.push(context);
    const extraPage = await context.newPage();
    await login(extraPage, user);
    await expect(extraPage.getByTestId("account-trigger")).toBeVisible();
    await extraPage.goto(new URL(`board/${board.id}`, appUrl).href);
    await expect(
      extraPage.getByRole("button", { name: "Switch board" }),
    ).toBeVisible();
  };

  const scanHeader = async (total: number) => {
    for (const width of [390, 768, 1440]) {
      for (const lang of ["en", "ru"] as const) {
        await page.setViewportSize({ width, height: 900 });
        const localized = new URL(page.url());
        localized.searchParams.set("lng", lang);
        await page.goto(localized.href);
        await expect(page.getByTestId("board-title")).toBeVisible();
        const faces = Math.min(
          total,
          width === 390 ? 1 : width === 768 ? 2 : 3,
        );
        const overflow = total - faces;
        await expect(page.getByTestId("people-avatar")).toHaveCount(faces, {
          timeout: 20_000,
        });
        if (overflow === 0) {
          await expect(page.getByTestId("people-overflow")).toHaveCount(0);
        } else {
          await expect(page.getByTestId("people-overflow")).toHaveText(
            `+${overflow}`,
          );
        }
        if (total === 4 && width !== 1440) {
          const trigger = page.getByTestId("people-trigger");
          const [triggerBox, switcherBox, agentsBox] = await Promise.all([
            trigger.boundingBox(),
            page.getByTestId("board-switcher-trigger").boundingBox(),
            page.getByTestId("agent-control-trigger").boundingBox(),
          ]);
          expect(triggerBox, "People trigger has a box").not.toBeNull();
          expect(switcherBox, "board switcher has a box").not.toBeNull();
          expect(agentsBox, "Agents trigger has a box").not.toBeNull();
          expect(
            overlaps(triggerBox!, switcherBox!),
            "People does not overlap the board switcher",
          ).toBe(false);
          expect(
            overlaps(triggerBox!, agentsBox!),
            "People does not overlap the Agents trigger",
          ).toBe(false);
          const metrics = await trigger.evaluate((element) => ({
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
          }));
          expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
          expect(triggerBox!.width).toBeGreaterThanOrEqual(44);
          expect(triggerBox!.height).toBeGreaterThanOrEqual(44);
          await page.screenshot({
            path: `${visualDir}busy-${width}-${lang}.png`,
            animations: "disabled",
          });
        }
        await documentAxe(page);
      }
    }
  };

  try {
    // Two people: the visible initials sit next to each other (two faces from
    // tablet up, one plus +1 on the phone). Axe must still find the
    // space-separated suffix in the name.
    await addPresence(0);
    await scanHeader(2);

    // Four people: one face +3 on the phone, two +2 at 768, three +1 at
    // desktop. The phone/tablet layouts must stay clear of the switcher and
    // Agents and keep the 44 px target.
    await addPresence(1);
    await addPresence(2);
    await scanHeader(4);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("People faces still open the roster and dialogs", async ({
  page,
  board,
}) => {
  await seedBoard(board);
  await page.setViewportSize({ width: 1440, height: 900 });
  await board.open(page);
  const people = page.getByTestId("people-trigger");
  await expect(people.getByTestId("people-avatar").first()).toBeVisible();
  await people.click();
  const menu = page.getByRole("menu", { name: "People" });
  await expect(menu.getByRole("menuitem", { name: "Members" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Share" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Members" }).click();
  await expect(page.getByTestId("board-members-box")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("board-members-box")).toHaveCount(0);
  await expect(people).toBeFocused();
});

for (const width of [390, 768, 1024, 1440, 1920]) {
  test(`a card click opens the modal at ${width}px`, async ({
    page,
    board,
  }) => {
    await seedBoard(board);
    await page.setViewportSize({ width, height: 900 });
    await board.open(page);
    const card = page
      .getByTestId("card-title")
      .filter({ hasText: "Recommended header card" });
    await card.click();
    const editor = page.getByRole("dialog", { name: "Card details" });
    await expect(editor).toBeVisible();
    await expect(page).toHaveURL(/[?&]card=/);
    await page.keyboard.press("Escape");
    await expect(editor).toBeHidden();
    await expect(page.locator("#board-inspector")).toHaveCount(0);
    await expect(page.locator('[aria-controls="board-inspector"]')).toHaveCount(
      0,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBe(0);
  });
}
