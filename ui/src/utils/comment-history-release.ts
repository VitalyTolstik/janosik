import packageMetadata from "../../../package.json";

/**
 * The release that introduced comment edit history (TASK-185.4).
 *
 * Vite injects the latest released section of the root `CHANGELOG.md`
 * (`__CHANGELOG_RELEASE__`). The package version is only a fallback for a
 * standalone type-check or a custom test runner that skipped the define; at
 * release time both files carry the same version.
 */
export const COMMENT_HISTORY_RELEASE =
  typeof __CHANGELOG_RELEASE__ === "string"
    ? __CHANGELOG_RELEASE__
    : packageMetadata.version;
