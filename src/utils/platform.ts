/**
 * Mac detection for shortcut labels (⌘ vs Ctrl+).
 *
 * `navigator.platform` is deprecated: it is a free-form string ("MacIntel")
 * and Chrome already returns an empty value on some Android builds. The
 * replacement is the UA client hint `userAgentData.platform` ("macOS") —
 * used here first, with the legacy string as the fallback for Firefox and
 * older Safari. Best-effort by design: the worst case is a wrong modifier
 * glyph in a tooltip.
 */
export function isMacPlatform(nav: Navigator = navigator): boolean {
  const uaPlatform = (
    nav as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData?.platform;
  return /mac|iphone|ipad|ipod/i.test(uaPlatform ?? nav.platform);
}
