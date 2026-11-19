/**
 * Return focus to the board chrome after every Settings close path. Radix
 * restores focus to a mounted DialogTrigger; the gear is a sibling, and a
 * board switch unmounts the dialog outright, so both paths resolve the target
 * here.
 *
 * Preference order is gear → title → board main. The gear is hidden below
 * 721 px, so a bare `.focus()` on it would leave focus on BODY; the first
 * visible/focusable candidate wins instead. In jsdom (no layout engine and no
 * `checkVisibility`) every candidate is treated as visible, so tests can
 * exercise the fallback by stubbing the browser API.
 */
function isFocusable(target: HTMLElement): boolean {
  if (typeof target.checkVisibility === "function") {
    return target.checkVisibility();
  }
  return true;
}

export function restoreBoardSettingsFocus(): void {
  const focusTrigger = () => {
    const candidates = [
      '[data-testid="board-settings-trigger"]',
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
