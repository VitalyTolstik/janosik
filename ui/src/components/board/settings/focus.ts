/**
 * Return focus to the board chrome after every Settings close path. Radix
 * restores focus to a mounted DialogTrigger; the gear is a sibling, and a
 * board switch unmounts the dialog outright, so both paths resolve the target
 * here.
 *
 * Preference order is gear → Board menu → title → board main. The gear now
 * lives inside the Board menu, so after the menu closes it is unmounted and
 * the trigger takes over; a bare `.focus()` on either would leave focus on
 * BODY, so the first visible/focusable candidate wins instead.
 * `checkVisibility()` covers modern browsers; the rect fallback also excludes
 * `display:none` candidates in engines (or tests) without that API.
 */
function isFocusable(target: HTMLElement): boolean {
  if (typeof target.checkVisibility === "function") {
    return target.checkVisibility();
  }
  return target.getClientRects().length > 0;
}

export function restoreBoardSettingsFocus(): void {
  const focusTrigger = () => {
    const candidates = [
      '[data-testid="board-settings-trigger"]',
      '[data-testid="board-menu-trigger"]',
      '[data-testid="board-title"]',
      '[data-testid="board-main"]',
    ];
    for (const selector of candidates) {
      const target = document.querySelector<HTMLElement>(selector);
      if (target !== null && isFocusable(target)) {
        target.focus();
        return;
      }
    }
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(focusTrigger);
  } else {
    focusTrigger();
  }
}
