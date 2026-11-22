/**
 * The release that introduced comment edit history (TASK-185.4).
 *
 * Pinned rather than read from the changelog at build time: the Docker build
 * context excludes `CHANGELOG.md`, which used to leave the banner at
 * `0.0.0`. The 185.4 feature rides the next minor release after `0.2.0`;
 * release preparation updates this constant together with the changelog.
 */
export const COMMENT_HISTORY_RELEASE = "0.3.0";
