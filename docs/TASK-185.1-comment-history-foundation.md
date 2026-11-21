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

The cutover migration takes `ACCESS EXCLUSIVE` on `Comment` for the `ALTER
TABLE` and rewrites every row in the table-wide backfill, so plan a maintenance
window: every read/write of comments waits for the duration of that migration.
The second migration only creates the two `Activity` expression indexes with
`IF NOT EXISTS`; `CREATE INDEX` is non-concurrent and briefly blocks writes to
`Activity`. `backend/scripts/db-indexes.cjs` builds concurrent equivalents, so a
large instance can run that script before `migrate deploy` and turn the
migration into a no-op. After cutover, trimming and purge snapshots are found
through `details->>'revisionId'` / `details->>'commentId'`; TASK-185.2 replaces
those expression indexes with the typed `Activity.commentId` column.

A stale board subtree is purged in one transaction per board while holding that
board's advisory lock. The transaction has a 5-minute timeout and 10-second
connection wait, so a very large board can block restores/writers of that board
for up to the lock window; the purge processes boards one at a time and the lock
is released before the next board.

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

### Reconciliation runbook

The standalone reconciliation sweep is **not part of 185.1**; it lands with the
read/feed work in 185.2/185.6. Until then the 409 means an operator must inspect
the comment manually:

```sql
SELECT c."id", c."editedAt", c."historyCutoverAt",
       c."historyVerifiedEditedAt", c."historyVerifiedRevisionNumber",
       c."lastRevisionNumber", c."historyIncompleteReason",
       r."revisionNumber", r."createdAt", r."afterText" = c."text" AS text_matches
FROM "Comment" c
LEFT JOIN "CommentRevision" r
  ON r."commentId" = c."id"
 AND r."revisionNumber" = c."lastRevisionNumber"
WHERE c."id" = '<commentId>';
```

A confirmed chain is repaired by adopting the current text as the verified
point: set `historyVerifiedEditedAt = editedAt`,
`historyVerifiedRevisionNumber = NULL` and keep `lastRevisionNumber`; the next
edit appends a fresh number. Do not delete a legitimate revision during this
check. Restarting writers is required when the gap came from an old release.

## Purge and GDPR

Hard purge (comment, card, column, board and demo cleanup) deletes revisions
and the `comment_added`/`comment_updated`/`comment_deleted` snapshots before the
comment row. GDPR erase removes all revisions of the author's comments and all
revisions/update Activity of another author's comment the erased user edited,
then merges `gdpr_erase` while keeping the current text, monotonic counter and
verified timestamp. A confirmed chain loses only its verified revision number
so later edits continue without a false `writer_gap`. User exports keep the
existing comment projection and never include revision snapshots.
