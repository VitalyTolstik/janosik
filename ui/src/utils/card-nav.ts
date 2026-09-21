import type { MouseEvent } from "react";

/**
 * Middle-click / modifier-click card opening (the browser affordances the
 * board surfaces lacked): every card-like element on the board, calendar
 * and table used to be a `<button>` with JS navigation, so a wheel click
 * had nothing to open — there was no URL behind the element.
 *
 * The helper turns such elements into real link targets:
 * - `cardHref(boardId, cardId)` builds the deep link (`/board/:id?card=…`)
 *   — mounting the board opens the card dialog all by itself;
 * - `isModifiedClick` / `shouldOpenInNewTab` let the plain left click stay
 *   an SPA transition while middle-click and Cmd/Ctrl+click hand the href
 *   to the browser (new tab / new window);
 * - `openCardInNewTab` is the `onAuxClick` fallback for middle-clicks on
 *   elements that are not anchors (buttons, chips, table rows) — for real
 *   `<a href>` the browser handles it natively.
 *
 * A `window.open(..., "_blank", "noopener")` inside `auxclick` counts as a
 * user activation in every evergreen browser, so no popup blocker trip.
 */

/** The deep link that opens a board with the card dialog up. */
export function cardHref(boardId: string, cardId: string): string {
  return `/board/${boardId}?card=${cardId}`;
}

/** True when the click already carries the browser's own open-in-new-tab intent. */
export function isModifiedClick(
  event: Pick<MouseEvent, "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

/**
 * Should this mouse event leave the element to the browser? Left click
 * without modifiers stays in the SPA (`false`); everything the browser
 * treats as "open elsewhere" (any modifier, any non-primary button —
 * middle, right, back/forward) returns `true`.
 */
export function shouldLeaveToBrowser(
  event: Pick<
    MouseEvent,
    "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
  >,
): boolean {
  return event.button !== 0 || isModifiedClick(event);
}

/** Open a card in a new tab from an `auxclick` (middle-click) on a non-anchor. */
export function openCardInNewTab(boardId: string, cardId: string): void {
  window.open(cardHref(boardId, cardId), "_blank", "noopener,noreferrer");
}
