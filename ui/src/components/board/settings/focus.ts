/**
 * Return focus to the board chrome after every Settings close path. Radix
 * restores focus to a mounted DialogTrigger; the gear is a sibling, and a
 * board switch unmounts the dialog outright, so both paths resolve the target
 * here.
 *
 * Preference: the new board's Settings gear. A board the user cannot
 * administer has no gear, so the board title (or the board main region) takes
 * focus instead of dropping it on BODY.
 */
export function restoreBoardSettingsFocus(): void {
  const focusTrigger = () => {
    const target =
      document.querySelector<HTMLElement>(
        '[data-testid="board-settings-trigger"]',
      ) ??
      document.querySelector<HTMLElement>('[data-testid="board-title"]') ??
      document.querySelector<HTMLElement>('[data-testid="board-main"]');
    target?.focus();
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(focusTrigger);
  } else {
    focusTrigger();
  }
}
