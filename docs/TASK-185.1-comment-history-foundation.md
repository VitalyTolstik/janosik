# TASK-185.1 — comment history foundation

**Status** — implemented (2026-11-22). This is the schema/writer half of
[TASK-185](TASK-185-comment-history.md); the API, card UI and admin surfaces
arrive in 185.2–185.5.

## Schema and cutover

`Comment` gains `lastRevisionNumber`, `historyCutoverAt`,
`historyVerifiedEditedAt`, `historyVerifiedRevisionNumber` and a nullable
`historyIncompleteReason` (`legacy_cutover`, `revision_limit`, `gdpr_erase`,
`writer_gap`). `CommentRevision` is immutable: one row per real text edit with
`beforeText`, `afterText`, the editor/actor attribution, a cause
(`author_edit`, `attachment_deleted`, `system`) and a unique
`(commentId, revisionNumber)`. Both FKs are `RESTRICT`; purge and erase remove
children explicitly.

Migration `20261122100000_task_185_1_comment_history` gives every existing
comment one database timestamp as the fence, copies `editedAt` into the
verified pair with a null revision number and marks a pre-release edit
`legacy_cutover`. It creates no revisions. New comments get the fence from the
database default at insert.

Rollout stops old writers (including attachment scrubbing), waits for their
transactions, pauses comment/event/purge writes during the backfill and only
then starts the 185.1 backend. The first real edit after cutover creates
revision #1; restoring an old writer after that is detected by the verified
pair, the last revision number and `afterText`.

## Writer

`backend/src/comments/comment-history.ts` is the only text-edit writer. It
re-reads the live comment and parent under the board-write lock, checks access,
reconciles the history and only then compares the normalized text:

- a text no-op writes no revision, moves no `editedAt` and emits no text event;
- a kind-only edit writes `beforeKind`/`afterKind`, but no revision and no
  `editedAt`;
- a real text edit writes one revision and one `comment_updated` Activity whose
  `details` carry `{ commentId, revisionId, beforeText, afterText, cause,
  text: afterText }`; `details.text` stays compatible with TASK-176.2;
- `editedAt`, the verified pair and the revision share one timestamp, strictly
  after the cutover fence and the previous edit at millisecond precision;
- the newest 50 revisions are kept. Older rows and their Activity snapshots
  are removed in the same transaction and `revision_limit` is merged.

A failed reconciliation persists `writer_gap` and commits before the request
answers `409 comment_history_gap`. The attachment scrub verifies every affected
comment before touching the attachment row; one gap persists only the marks and
aborts the whole deletion.

## Purge and GDPR

Hard purge (comment, card, column, board and demo cleanup) deletes revisions
and the `comment_added`/`comment_updated`/`comment_deleted` snapshots before the
comment row. GDPR erase removes all revisions of the author's comments and all
revisions/update Activity of another author's comment the erased user edited,
then merges `gdpr_erase` while keeping the current text, monotonic counter and
verified timestamp. A confirmed chain loses only its verified revision number
so later edits continue without a false `writer_gap`. User exports keep the
existing comment projection and never include revision snapshots.
