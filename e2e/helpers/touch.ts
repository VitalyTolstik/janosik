import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Touch helpers for the 390 px suite (TASK-31).
 *
 * Playwright's `touchscreen` only exposes `tap()`; a long-press drag has to
 * go through CDP's touch transport. That still produces real DOM pointer and
 * touch events, including the browser's own `pointercancel` when a scroll
 * wins — exactly the stream the touch layer reads.
 */

const HOLD_MS = 400;

/**
 * Wait until the long press actually activated the drag (the layer marks the
 * body). The activation timer runs on the page's main thread, so on a loaded
 * CI runner it can land after the fixed hold; moving first would make the
 * browser treat the whole gesture as a scroll and cancel the drag.
 */
async function waitForDragActive(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.body.classList.contains("janosik-touch-dragging"),
    null,
    { timeout: 3_000 },
  );
}

/** Page-level horizontal overflow (the one thing a phone layout must not do). */
export async function expectNoPageOverflow(
  page: Page,
  label: string,
): Promise<void> {
  const metrics = await page.evaluate(() => {
    const viewport = window.innerWidth;
    const clipped = (element: Element) => {
      // Horizontal scrollers are intentional: a wide toolbar/table may
      // overflow its own box, but it must not widen the page. `overflow-y:
      // auto` also computes `overflow-x: auto`, so require real horizontal
      // overflow — otherwise the whole card-dialog body would be skipped.
      let node: Element | null = element;
      while (node) {
        const overflow = window.getComputedStyle(node).overflowX;
        if (
          (overflow === "auto" || overflow === "scroll") &&
          (node as HTMLElement).scrollWidth >
            (node as HTMLElement).clientWidth + 1
        ) {
          return true;
        }
        node = node.parentElement;
      }
      return false;
    };
    const offenders: string[] = [];
    // body.scrollWidth misses content clipped by an `overflow-hidden` shell,
    // so also inspect the controls the phone layout must keep on screen.
    const scope =
      'header *, [data-testid="filter-bar"] *, [role="dialog"] *, ' +
      '[data-testid="filters-popover"] *';
    for (const element of document.querySelectorAll<HTMLElement>(scope)) {
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (clipped(element)) continue;
      if (rect.left < -1 || rect.right > viewport + 1) {
        offenders.push(
          `${element.tagName.toLowerCase()}.${element.className} ` +
            `[${Math.round(rect.left)}..${Math.round(rect.right)}]`,
        );
        if (offenders.length === 5) break;
      }
    }
    return {
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      viewport,
      offenders,
    };
  });
  expect(
    metrics.document,
    `${label}: <html> is ${metrics.document}px wide in a ${metrics.viewport}px viewport`,
  ).toBeLessThanOrEqual(metrics.viewport);
  expect(
    metrics.body,
    `${label}: <body> is ${metrics.body}px wide in a ${metrics.viewport}px viewport`,
  ).toBeLessThanOrEqual(metrics.viewport);
  expect(
    metrics.offenders,
    `${label}: visible controls outside the ${metrics.viewport}px viewport`,
  ).toEqual([]);
}

/** The element itself must not scroll horizontally (dialogs, popovers). */
export async function expectNoOwnOverflow(
  locator: Locator,
  label: string,
): Promise<void> {
  const metrics = await locator.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(
    metrics.scrollWidth,
    `${label}: ${metrics.scrollWidth}px content in a ${metrics.clientWidth}px box`,
  ).toBeLessThanOrEqual(metrics.clientWidth);
}

/** The box stays fully inside the 390 px viewport. */
export async function expectInsideViewport(
  locator: Locator,
  label: string,
): Promise<void> {
  const box = await locator.boundingBox();
  const viewport = locator.page().viewportSize();
  if (!box || !viewport) throw new Error(`${label}: no bounding box`);
  expect(box.x, `${label}: left edge`).toBeGreaterThanOrEqual(-0.5);
  expect(box.x + box.width, `${label}: right edge`).toBeLessThanOrEqual(
    viewport.width + 0.5,
  );
}

/** Box fully inside the current viewport; throws with a readable label. */
function visibleBox(
  page: Page,
  box: { x: number; y: number; width: number; height: number } | null,
  label: string,
) {
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error(`${label}: no bounding box`);
  if (
    box.x < -0.5 ||
    box.y < -0.5 ||
    box.x + box.width > viewport.width + 0.5 ||
    box.y + box.height > viewport.height + 0.5
  ) {
    throw new Error(
      `${label}: box ${Math.round(box.x)},${Math.round(box.y)} ` +
        `${Math.round(box.width)}×${Math.round(box.height)} is outside ` +
        `${viewport.width}×${viewport.height}`,
    );
  }
  return box;
}

/**
 * Long-press `source` and drag it onto `target`, then release. `holdMs` is
 * intentionally longer than the 220 ms activation delay but shorter than the
 * browser's long-press context menu. Both boxes are re-measured after the
 * target scroll and must be inside the viewport — a stale source rect would
 * otherwise make the test pass for the wrong reason.
 */
export async function touchDragTo(
  page: Page,
  source: Locator,
  target: Locator,
  { holdMs = HOLD_MS }: { holdMs?: number } = {},
): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  await source.scrollIntoViewIfNeeded();
  const from = visibleBox(page, await source.boundingBox(), "source");
  const to = visibleBox(page, await target.boundingBox(), "target");

  const start = {
    x: from.x + Math.max(8, from.width * 0.3),
    y: from.y + from.height / 2,
  };
  const end = {
    x: to.x + to.width / 2,
    y: to.y + Math.min(to.height / 2, 40),
  };

  const client = await page.context().newCDPSession(page);
  try {
    await client.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 1,
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...start, id: 1, radiusX: 1, radiusY: 1, force: 1 }],
    });
    await page.waitForTimeout(holdMs);
    await waitForDragActive(page);
    const steps = 10;
    for (let step = 1; step <= steps; step += 1) {
      const point = {
        x: start.x + ((end.x - start.x) * step) / steps,
        y: start.y + ((end.y - start.y) * step) / steps,
        id: 1,
        radiusX: 1,
        radiusY: 1,
        force: 1,
      };
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [point],
      });
      await page.waitForTimeout(16);
    }
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await client.detach();
  }
  // React commits the command optimistically on pointerup.
  await page.waitForTimeout(150);
}

/**
 * Long-press `source`, hold the finger at the viewport edge until the nearest
 * scroll container brings `target` on screen, then drop on it. This exercises
 * the auto-scroll loop with a target that starts outside the initial viewport
 * (the plain `touchDragTo` would scroll it into view before the press).
 */
export async function touchDragToOffscreen(
  page: Page,
  source: Locator,
  target: Locator,
  {
    holdMs = HOLD_MS,
    direction,
    scrollContainer,
  }: {
    holdMs?: number;
    /** Needed only when the virtualized target row is not mounted yet. */
    direction?: "up" | "down";
    /** Overrides ancestor detection (e.g. a virtualized table row). */
    scrollContainer?: Locator;
  } = {},
): Promise<void> {
  await source.scrollIntoViewIfNeeded();
  const from = visibleBox(page, await source.boundingBox(), "source");
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("touchDragToOffscreen: no viewport");
  const targetBefore = await target
    .boundingBox({ timeout: 500 })
    .catch(() => null);
  if (!targetBefore && !direction) {
    throw new Error("touchDragToOffscreen: no target box and no direction");
  }
  const scrollBox = await (scrollContainer ?? target).evaluate((element) => {
    let node: Element | null = element;
    while (node) {
      const style = window.getComputedStyle(node);
      if (
        /(auto|scroll)/.test(style.overflowY) &&
        (node as HTMLElement).scrollHeight >
          (node as HTMLElement).clientHeight + 1
      ) {
        const rect = node.getBoundingClientRect();
        return {
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
        };
      }
      node = node.parentElement;
    }
    return null;
  });
  const down = direction ? direction === "down" : targetBefore!.y > from.y;
  const edge = {
    x: scrollBox ? (scrollBox.left + scrollBox.right) / 2 : viewport.width / 2,
    y: down
      ? (scrollBox?.bottom ?? viewport.height) - 24
      : (scrollBox?.top ?? 0) + 24,
  };

  const start = {
    x: from.x + Math.max(8, from.width * 0.3),
    y: from.y + from.height / 2,
  };
  const client = await page.context().newCDPSession(page);
  try {
    await client.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 1,
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...start, id: 1, radiusX: 1, radiusY: 1, force: 1 }],
    });
    await page.waitForTimeout(holdMs);
    await waitForDragActive(page);
    const steps = 6;
    for (let step = 1; step <= steps; step += 1) {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: start.x + ((edge.x - start.x) * step) / steps,
            y: start.y + ((edge.y - start.y) * step) / steps,
            id: 1,
            radiusX: 1,
            radiusY: 1,
            force: 1,
          },
        ],
      });
      await page.waitForTimeout(16);
    }

    // Keep the finger parked at the edge; the hook's rAF loop scrolls.
    // Wait until the row is fully inside the scroll container: the last row
    // of a table sits flush with the container's bottom edge at max scroll,
    // so a fixed 40 px viewport margin could never be satisfied.
    const top = scrollBox?.top ?? 0;
    const bottom = scrollBox?.bottom ?? viewport.height;
    const fullyInside = (
      candidate: { x: number; y: number; width: number; height: number } | null,
    ) =>
      candidate !== null &&
      candidate.y >= top - 0.5 &&
      candidate.y + candidate.height <= bottom + 0.5 &&
      candidate.x >= -0.5 &&
      candidate.x + candidate.width <= viewport.width + 0.5;
    let box = await target.boundingBox({ timeout: 500 }).catch(() => null);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !fullyInside(box)) {
      await page.waitForTimeout(100);
      box = await target.boundingBox({ timeout: 500 }).catch(() => null);
    }
    if (!box) throw new Error("touchDragToOffscreen: target disappeared");
    const visible = visibleBox(page, box, "target after auto-scroll");

    // The release point can still sit inside the auto-scroll band. The table
    // cases target the last row (scrollTop already clamped), and the calendar
    // day cell is 128 px tall, so its centre settles outside the 48 px band.
    // Re-measure and move the finger again before releasing if this helper is
    // ever used for a short mid-list row.
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: visible.x + visible.width / 2,
          y: visible.y + Math.min(visible.height / 2, 40),
          id: 1,
          radiusX: 1,
          radiusY: 1,
          force: 1,
        },
      ],
    });
    await page.waitForTimeout(60);
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await client.detach();
  }
  await page.waitForTimeout(150);
}

/**
 * Two quick taps through the touch transport. Playwright's `locator.tap()`
 * round-trips through actionability on every call; under parallel load the
 * gap between the two calls can slip past the 300 ms double-tap window.
 * CDP sends the pair with a realistic 90 ms gap.
 */
export async function touchDoubleTap(
  page: Page,
  target: Locator,
): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("touchDoubleTap: target is not visible");
  const point = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    id: 1,
    radiusX: 1,
    radiusY: 1,
    force: 1,
  };
  const client = await page.context().newCDPSession(page);
  try {
    await client.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 1,
    });
    for (let tap = 0; tap < 2; tap += 1) {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [point],
      });
      await client.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      if (tap === 0) await page.waitForTimeout(90);
    }
  } finally {
    await client.detach();
  }
}

/**
 * A press held past the drag activation delay but released without moving.
 * It must stay a tap: the click is not swallowed and the card opens.
 */
export async function touchSlowTap(
  page: Page,
  target: Locator,
  { holdMs = 300, scroll = true }: { holdMs?: number; scroll?: boolean } = {},
): Promise<void> {
  if (scroll) await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("touchSlowTap: target is not visible");
  const point = {
    x: box.x + Math.max(8, box.width * 0.3),
    y: box.y + box.height / 2,
    id: 1,
    radiusX: 1,
    radiusY: 1,
    force: 1,
  };
  const client = await page.context().newCDPSession(page);
  try {
    await client.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 1,
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point],
    });
    await page.waitForTimeout(holdMs);
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await client.detach();
  }
}

/** A vertical swipe — proves the surface still scrolls during normal use. */
export async function touchSwipe(
  page: Page,
  target: Locator,
  deltaY: number,
): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error("touchSwipe: target is not visible");
  // Start over the title/safe area, not a cell button: a swipe across the
  // column cell would open its menu instead of scrolling.
  const x = box.x + Math.max(8, box.width * 0.3);
  const y = box.y + box.height / 2;
  const client = await page.context().newCDPSession(page);
  try {
    await client.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 1,
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 }],
    });
    const steps = 8;
    for (let step = 1; step <= steps; step += 1) {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x,
            y: y + (deltaY * step) / steps,
            id: 1,
            radiusX: 1,
            radiusY: 1,
            force: 1,
          },
        ],
      });
      await page.waitForTimeout(16);
    }
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await client.detach();
  }
}
