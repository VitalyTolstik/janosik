/**
 * Archived-board refusal shared by the command path and card-scoped REST
 * guards. Archived boards stay readable, but every content write (commands,
 * comments, attachments) has to restore the board first.
 */
export const ARCHIVED_BOARD_MESSAGE =
  "This board is archived and read-only. Restore it from the board switcher to make changes.";
