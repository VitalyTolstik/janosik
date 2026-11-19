export function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/** Use the typed Latin letter when layouts remap physical key positions. */
export function shortcutLetterCode(event: KeyboardEvent): string {
  return /^[a-z]$/i.test(event.key)
    ? `Key${event.key.toUpperCase()}`
    : event.code;
}

export function isShortcutHelpKey(event: KeyboardEvent): boolean {
  return !event.ctrlKey && !event.metaKey && !event.altKey && event.key === "?";
}
