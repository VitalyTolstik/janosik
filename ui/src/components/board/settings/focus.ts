/**
 * Return focus to the gear that opened Board Settings after every close path.
 * Radix restores focus to a DialogTrigger; the gear is a sibling, so the shell
 * and the save path call this explicitly.
 */
export function restoreBoardSettingsFocus(): void {
  const focusTrigger = () => {
    document
      .querySelector<HTMLElement>('[data-testid="board-settings-trigger"]')
      ?.focus();
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(focusTrigger);
  } else {
    focusTrigger();
  }
}
