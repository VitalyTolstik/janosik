import { randomUUID } from "node:crypto";

import { test, expect } from "@/fixtures/board.js";
import { createAgentSession } from "@/helpers/agents.js";
import { appUrl } from "@/helpers/urls.js";

/**
 * TASK-179.9 visual/a11y acceptance: custom combobox keyboard model, one
 * status badge with a centred mark, 44 px mobile actions, the 1024 sheet
 * starting below the real board header, focus trap/return, reduced motion,
 * no horizontal overflow and the Russian body-stack heading.
 */

async function openAgents(page: import("@playwright/test").Page) {
  await page.goto(new URL("agents", appUrl).href);
  await expect(page.getByTestId("agents-page")).toBeVisible();
}

async function openControl(page: import("@playwright/test").Page) {
  await page.getByTestId("agent-control-trigger").click();
  const dialog = page.getByTestId("agent-control-dialog");
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(250);
  return dialog;
}

async function triggerBox(
  page: import("@playwright/test").Page,
  testId: string,
) {
  const box = await page.getByTestId(testId).boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

test("board-scope combobox follows the ARIA keyboard model", async ({
  page,
  board,
}) => {
  await board.open(page);
  await openAgents(page);
  const scope = page.getByTestId("agents-header-scope");
  await scope.focus();

  await page.keyboard.press("ArrowDown");
  await expect(scope).toHaveAttribute("aria-expanded", "true");
  const listbox = page.getByTestId("agents-header-scope-listbox");
  await expect(listbox).toBeVisible();
  const listboxBg = await listbox.evaluate(
    (node) => getComputedStyle(node).backgroundColor,
  );
  expect(listboxBg).not.toContain("rgba(0, 0, 0, 0)");

  const firstActive = await scope.getAttribute("aria-activedescendant");
  expect(firstActive).toBeTruthy();
  await page.keyboard.press("End");
  const lastActive = await scope.getAttribute("aria-activedescendant");
  expect(lastActive).toBeTruthy();
  expect(lastActive).not.toBe(firstActive);
  await page.keyboard.press("Home");
  expect(await scope.getAttribute("aria-activedescendant")).toBe(firstActive);

  await page.keyboard.press("Escape");
  await expect(scope).toHaveAttribute("aria-expanded", "false");
  await expect(scope).toBeFocused();
});

test("one status badge keeps the mark and label on the same centre", async ({
  page,
  board,
  playwright,
  testIp,
}) => {
  const column = await board.column("Todo");
  const card = await board.card(column, "Badge probe");
  const agent = await createAgentSession(playwright, board, testIp, {
    tokenName: "Badge agent",
    sessionName: "Badge session",
    currentCardId: card,
  });
  try {
    await board.open(page);
    await openAgents(page);
    await page.getByTestId("agents-section-sessions").click();
    const row = page.getByTestId(`agent-session-row-${agent.session.id}`);
    await expect(row).toBeVisible();
    const badge = row.locator('[data-testid^="agent-status-"]').first();
    const metrics = await badge.evaluate((node) => {
      const mark = node.querySelector("[aria-hidden]");
      const label = node.lastElementChild;
      const rowRect = node.getBoundingClientRect();
      const markRect = mark?.getBoundingClientRect();
      const labelRect = label?.getBoundingClientRect();
      return {
        height: rowRect.height,
        rowCenter: rowRect.top + rowRect.height / 2,
        markCenter: markRect ? markRect.top + markRect.height / 2 : null,
        labelCenter: labelRect ? labelRect.top + labelRect.height / 2 : null,
      };
    });
    expect(metrics.height).toBe(22);
    expect(metrics.markCenter).not.toBeNull();
    expect(metrics.labelCenter).not.toBeNull();
    expect(Math.abs(metrics.markCenter! - metrics.rowCenter)).toBeLessThan(1);
    expect(Math.abs(metrics.labelCenter! - metrics.rowCenter)).toBeLessThan(1);
  } finally {
    await agent.dispose();
  }
});

test("1024 sheet starts below the real board header", async ({
  page,
  board,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await board.open(page);
  const header = await page.locator("header").first().boundingBox();
  expect(header).not.toBeNull();
  const dialog = await openControl(page);
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(header!.y + header!.height - 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(768);
  expect(box!.width).toBeLessThanOrEqual(1024);
});

test("390 keeps every primary action at 44 px and traps/returns focus", async ({
  page,
  board,
  playwright,
  testIp,
}) => {
  const column = await board.column("Todo");
  const card = await board.card(column, "Touch target probe");
  const agent = await createAgentSession(playwright, board, testIp, {
    tokenName: "Touch agent",
    sessionName: "Touch session",
    currentCardId: card,
  });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await board.open(page);
    const dialog = await openControl(page);
    const close = dialog.getByRole("button", { name: "Close" }).first();
    const closeBox = await close.boundingBox();
    expect(closeBox!.width).toBeGreaterThanOrEqual(44);
    expect(closeBox!.height).toBeGreaterThanOrEqual(44);

    for (const tab of await dialog.getByRole("tab").all()) {
      const box = await tab.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }

    for (const filter of await dialog
      .locator('[data-testid^="approval-filter-"]')
      .all()) {
      const box = await filter.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }

    await dialog.getByTestId("agent-pause-tab").click();
    for (const testId of [
      "agent-live-refresh",
      "live-status-pause",
      "agent-session-pause",
      "agent-session-end",
    ]) {
      const box = await triggerBox(page, testId);
      expect(box.height, testId).toBeGreaterThanOrEqual(44);
      expect(box.width, testId).toBeGreaterThanOrEqual(44);
    }

    // The prototype stacks the Live actions under the copy at 390; the copy
    // must keep a readable column instead of being squeezed between the icon
    // and the action cluster.
    const liveCard = await triggerBox(page, "live-status-card");
    const liveCopy = await page
      .locator('[data-testid="live-status-card"] .live-status-main')
      .boundingBox();
    const liveActions = await page
      .locator('[data-testid="live-status-card"] .live-status-actions')
      .boundingBox();
    expect(liveCopy).not.toBeNull();
    expect(liveActions).not.toBeNull();
    expect(liveCopy!.width).toBeGreaterThan(160);
    expect(liveActions!.y).toBeGreaterThanOrEqual(
      liveCopy!.y + liveCopy!.height - 1,
    );
    expect(liveCard.width).toBeLessThanOrEqual(390);

    await page.getByTestId("agent-session-end").click();
    await page.waitForTimeout(250);
    for (const testId of ["agent-action-cancel", "agent-action-confirm"]) {
      const box = await triggerBox(page, testId);
      expect(box.height, testId).toBeGreaterThanOrEqual(44);
    }
    await page.getByTestId("agent-action-cancel").click();
    await expect(page.getByTestId("agent-action-cancel")).toBeHidden();
    await page.waitForTimeout(300);
    await expect(page.getByTestId("agent-session-end")).toBeFocused();
    expect(
      await page.evaluate(() => {
        const active = document.activeElement;
        const modal = document.querySelector(
          '[data-testid="agent-control-dialog"]',
        );
        return active !== null && modal !== null && modal.contains(active);
      }),
    ).toBe(true);

    // Focus stays inside the modal while tabbing.
    for (let index = 0; index < 12; index += 1) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => {
        const active = document.activeElement;
        const modal = document.querySelector(
          '[data-testid="agent-control-dialog"]',
        );
        return active !== null && modal !== null && modal.contains(active);
      });
      expect(inside).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("agent-control-trigger")).toBeFocused();
  } finally {
    await agent.dispose();
  }
});

test("390 board settings primary actions stay at 44 px", async ({
  page,
  board,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await board.open(page);
  await page.getByTestId("board-settings-trigger").click();
  const dialog = page.getByTestId("board-settings-dialog");
  await expect(dialog).toBeVisible();
  await page.getByTestId("board-settings-agents").click();
  await expect(page.getByTestId("agents-automation-footer")).toBeVisible();
  await page.waitForTimeout(250);
  for (const testId of ["agent-policy-save", "agents-automation-discard"]) {
    const box = await triggerBox(page, testId);
    expect(box.height, testId).toBeGreaterThanOrEqual(44);
  }
  const close = await triggerBox(page, "workflow-close");
  expect(close.width).toBeGreaterThanOrEqual(44);
  expect(close.height).toBeGreaterThanOrEqual(44);
  await expect(dialog).toBeVisible();
});

test("no horizontal overflow at 1440/1024/390", async ({ page, board }) => {
  await board.open(page);
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await openAgents(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const refresh = await triggerBox(page, "agents-refresh");
    if (viewport.width === 390) {
      expect(refresh.height).toBeGreaterThanOrEqual(44);
    }
    const scope = await triggerBox(page, "agents-filter-board");
    if (viewport.width === 390) {
      expect(scope.height).toBeGreaterThanOrEqual(44);
    }
  }
});

test("reduced motion stops the refresh spinner", async ({ page, board }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await board.open(page);
  await openAgents(page);
  const animation = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.className = "animate-spin";
    document.body.append(probe);
    const name = getComputedStyle(probe).animationName;
    probe.remove();
    return name;
  });
  expect(animation).toBe("none");
});

test("status badge contrast clears AA in both themes", async ({
  page,
  board,
  playwright,
  testIp,
}) => {
  const column = await board.column("Todo");
  const card = await board.card(column, "Contrast probe");
  const agent = await createAgentSession(playwright, board, testIp, {
    tokenName: "Contrast agent",
    sessionName: "Contrast session",
    currentCardId: card,
  });
  try {
    await board.open(page);
    await openAgents(page);
    await page.getByTestId("agents-section-sessions").click();
    await expect(
      page.getByTestId(`agent-session-row-${agent.session.id}`),
    ).toBeVisible();

    for (const theme of ["dark", "light"] as const) {
      await page.evaluate((mode) => {
        localStorage.removeItem("vortex-theme");
        localStorage.setItem("janosik-theme", mode);
      }, theme);
      await page.reload();
      await expect(page.getByTestId("agents-page")).toBeVisible();
      await expect(page.locator("html")).toHaveClass(
        new RegExp(`(^|\\s)${theme}(\\s|$)`),
      );
      await page.getByTestId("agents-section-sessions").click();
      const badge = page.locator('[data-testid^="agent-status-"]').first();
      await expect(badge).toBeVisible();
      const ratio = await badge.evaluate((node) => {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext("2d");
        if (context === null) throw new Error("2d canvas unavailable");
        const pixel = (color: string): [number, number, number] => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
          return [r, g, b];
        };
        const channel = (value: number): number => {
          const x = value / 255;
          return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        };
        const luminance = ([r, g, b]: [number, number, number]): number =>
          0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

        // Paint every ancestor background outermost → innermost onto one
        // canvas pixel. Canvas understands oklab()/color-mix() output, unlike
        // a hand-written rgb() parser.
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, 1, 1);
        const layers: string[] = [];
        for (
          let element: Element | null = node;
          element !== null;
          element = element.parentElement
        ) {
          const color = getComputedStyle(element).backgroundColor;
          if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent") {
            layers.push(color);
          }
        }
        for (const color of layers.reverse()) {
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
        }
        const background = [...context.getImageData(0, 0, 1, 1).data].slice(
          0,
          3,
        ) as [number, number, number];
        const foreground = pixel(getComputedStyle(node).color);
        const a = luminance(foreground);
        const b = luminance(background);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
      expect(ratio, theme).toBeGreaterThanOrEqual(4.5);

      // The palette itself must clear AA on the real 6/10/12/15% status
      // tints over both the surface and the page background — measuring only
      // the bare surface missed the warning/danger chips before the fix.
      const toneRatios = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        const parseHex = (value: string): [number, number, number] => {
          const hex = value.trim().replace("#", "");
          return [
            parseInt(hex.slice(0, 2), 16),
            parseInt(hex.slice(2, 4), 16),
            parseInt(hex.slice(4, 6), 16),
          ];
        };
        const channel = (value: number): number => {
          const x = value / 255;
          return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        };
        const luminance = ([r, g, b]: [number, number, number]): number =>
          0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
        const ratio = (
          foreground: [number, number, number],
          background: [number, number, number],
        ): number => {
          const a = luminance(foreground);
          const b = luminance(background);
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        };
        const result: Record<string, number> = {};
        const bases = [
          parseHex(root.getPropertyValue("--surface")),
          parseHex(root.getPropertyValue("--background")),
        ];
        for (const tone of ["success", "warning", "danger", "primary"]) {
          const fg = parseHex(root.getPropertyValue(`--agent-tone-${tone}`));
          const tintColor = parseHex(root.getPropertyValue(`--${tone}`));
          let minimum = Number.POSITIVE_INFINITY;
          for (const base of bases) {
            for (const alpha of [0.06, 0.1, 0.12, 0.15]) {
              const tint = tintColor.map((value, index) =>
                Math.round(value * alpha + base[index] * (1 - alpha)),
              ) as [number, number, number];
              minimum = Math.min(minimum, ratio(fg, tint));
            }
          }
          result[tone] = minimum;
        }
        return result;
      });
      for (const [tone, toneRatio] of Object.entries(toneRatios)) {
        expect(toneRatio, `${theme} ${tone}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  } finally {
    await agent.dispose();
  }
});

test("a combobox inside the modal is clickable and Escape closes only the listbox", async ({
  page,
  board,
  playwright,
  testIp,
}) => {
  // Runs filters intentionally do not render when the board has no runs at
  // all, so this fixture needs one real applied run before the toolbar exists.
  const column = await board.column("Todo");
  const agent = await createAgentSession(playwright, board, testIp, {
    tokenName: "Combobox agent",
    sessionName: "Combobox session",
  });
  try {
    const run = await agent.api.post(
      `/api/v1/boards/${board.id}/commands/batch`,
      {
        headers: { "X-Agent-Session": agent.session.id },
        data: {
          commands: [
            {
              commandId: randomUUID(),
              action: {
                type: "ADD_CARD",
                boardId: board.id,
                columnId: column,
                newCardId: randomUUID(),
                title: "Combobox run",
                at: Date.now(),
              },
            },
          ],
        },
      },
    );
    expect(run.status(), await run.text()).toBe(200);
  } finally {
    await agent.dispose();
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await board.open(page);
  const dialog = await openControl(page);
  await dialog.getByTestId("agent-runs-tab").click();
  const trigger = page.getByTestId("run-filter-status");
  await trigger.click();
  await expect(page.getByTestId("run-filter-status-listbox")).toBeVisible();
  await page.getByTestId("run-filter-status-option-applied").click();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(dialog).toBeVisible();

  await trigger.click();
  await expect(page.getByTestId("run-filter-status-listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("run-filter-status-listbox")).toBeHidden();
  await expect(dialog).toBeVisible();
});

test("Russian headings use the body stack, English keeps Space Grotesk", async ({
  page,
  board,
}) => {
  await board.open(page);
  await openAgents(page);
  const english = await page
    .locator(".font-agent-display")
    .first()
    .evaluate((node) => getComputedStyle(node).fontFamily);
  expect(english).toContain("Space Grotesk");

  await page.goto(new URL("agents?lng=ru", appUrl).href);
  await expect(page.getByTestId("agents-page")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  const russian = await page
    .locator(".font-agent-display")
    .first()
    .evaluate((node) => getComputedStyle(node).fontFamily);
  expect(russian).not.toContain("Space Grotesk");
});
