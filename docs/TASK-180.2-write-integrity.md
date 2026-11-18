# TASK-180.2 — Card/command write integrity

Implements the 180.2 slice of `TASK-180-bug-research-remediation.md` on top of
TASK-180.1 (`4b22721f`). No PR/merge is part of this stream.

## What changed

| ID | Change |
|---|---|
| H2 | `ADD_/RESTORE_CHECKLIST`, `ADD_/RESTORE_CHECKLIST_ITEM`, `ADD_CARD_LINK` and nested `RESTORE_CARD`/`RESTORE_COLUMN`/`RESTORE_COLUMN_CARDS` snapshots now check the stored parent, not only the board. `RESTORE_CHECKLIST` checks every nested item too; duplicate-derived checklist/item ids are preflighted against the live aggregate. Parentage is checked **per command against the running board at that command's position**, and ownership is compared against both committed rows and that simulated board. A batch or plan that creates the source checklist/items/links earlier and then duplicates/reuses the id cannot bypass the guard; the plan preview uses the same positional state. A same-board id owned by another card/checklist/link answers `409 { code: "id_conflict", conflict: "id" }` before the writers run. Soft-deleted rows may be revived only by their original owner. The shared owner predicate and error shape live in `backend/src/commands/entity-parentage.ts`; TASK-176.9's admin `assertAdminCardRelations` uses the same `id_conflict` envelope and should import this helper when its branch merges. Admin commands remain run-free/pre-image-free (covered by `admin.e2e-spec.ts`). |
| L18 | The idempotency check compares the exact request first. Only when the **stored** payload was actually stripped (no `card.assigneeId` key) and the incoming assignee is genuinely no longer an active board member may the comparison ignore `card.assigneeId` on both sides; a different valid assignee still answers `409 idempotency_conflict`. A changed non-member assignee cannot be distinguished from the original stripped request without storing a second payload copy; that residual is documented. |
| M7 | A live claim may be released only by the holder identity that claimed it (agent session, then PAT, then legacy user id). Another member, a second PAT of the same user, or a browser session / PAT cross-release answers `400 field:"action.claimedBy"`. Lapsed leases remain free to take or clear. An internal run revert may restore the pre-run claim state either way — releasing a lease the run acquired, or re-acquiring the previous holder/lease after a claim over a lapsed lease — via non-wire `exemptClaimGuard`, with the same preview/apply result. |
| H3 | Duplicate card/column now derive fresh checklist/item ids from the new card id (`duplicateChecklistId`/`duplicateChecklistItemId` in the shared reducer), so the optimistic client and the server writers agree without an extra id map. The base is a 128-bit FNV-1a hash of the whole card id (colon-free, no truncation collision); duplicate-derived ids are included in the parentage guard so a pre-existing victim row cannot be stolen. The duplicate writers persist checklists/items and include them in `touches`/pre-images. Links are intentionally not copied — copies start unlinked. |
| M13 | `RESTORE_*` no longer skips WIP/collection guards based on the action type or a client `inverse:true`. Each restore is checked as the fresh add it performs (cards/columns/labels/checklists/items, including nested snapshots); `RESTORE_COLUMN_CARDS` counts the resulting column and its writer mirrors the reducer (omitted cards are parked in the invisible orphan column, not written into the restored column). Only the internal run-revert path passes `exemptRestoreLimits`; it is not a wire field. |
| M16 | Client undo of `MOVE_CARD`/`UNARCHIVE_CARD` is no longer optimistic: it preflights the destination WIP and otherwise waits for the server. A refusal leaves the board untouched and restores the undo step for a later retry. The toast includes the destination column title and limit, and the failure carries `columnId` from the server. `inverse.ts` and `BoardScopedAction.inverse` document that the flag is local bookkeeping, not a server exemption. |
| M17 | UI `createBoard`/`importBoards` send an `Idempotency-Key` and retry once on network/502/503/504 with the same key. MCP `create_board`, `import_board`, `create_share`, `add_comment` and `upload_attachment` generate a default key and the client retries a transient post with it. Command/batch writes keep using `commandId`. |
| M14 | The delete-column confirmation counts `column.cardIds.length` (all cards that will be deleted), while the header badge/empty state keeps the filtered `cards.length`. |
| L19 | Deleting an attachment scrubs its URL from live card descriptions and comments in all forms the editor emits: markdown image/link, bare URL with or without `/api/v1`, and `::image/video/audio{src="…"}` directives. Cleanup is line-local — only the removed reference's boundary and its own line are touched, so code-block indentation, tabs, aligned text and markdown two-space hard breaks elsewhere stay byte-identical. It then runs `reconcileDescriptionAttachments` so other embeds and the card badge stay correct. Exact cleaned bodies including a code block and hard break are asserted in e2e; HTML `<img>` remains a documented residual. The soft-deleted row/blob still exists for retention/undo snapshots. |
| L20 | The attachment list exposes `X-Attachment-Count`, the total live budget including inline/description media. The UI uses it for the cap and maps `code:"attachment_limit"` to the cap message, not "bad file type". OpenAPI documents the header. |
| L24 | An idempotency record is released only on the existing `markGuaranteedRollback` proof. Board create/import and `BoardWriteService` mark a P2028 from the **write transaction**; a P2028 from a post-commit `getAggregate`/list read is unmarked and keeps the record, so a committed board cannot be duplicated by a retry. |
| L35 | The card face resolves the assignee from the live roster; a removed/expired assignee renders no avatar, matching the dialog's "Unassigned". Member-roster expiry rules stay in 180.3/M15. |
| L36 | A `comment_updated` frame refreshes the loaded pages until it finds the edited row (bounded by the loaded page count + 1), so an edit on page 2+ updates in place instead of only the newest 50. |

## Decisions

- **H3 id contract:** deterministic derived ids, not an action-carried map:
  `dup-<16 hex><16 hex>~cl~<index>` and
  `dup-<16 hex><16 hex>~cl~<checklistIndex>~i~<itemIndex>`. The base is a
  128-bit FNV-1a hash of the **whole** new card id — colon-free, no
  first-80-char truncation collision, and comfortably below the 128-char wire
  id bound. The parentage guard preflights these derived ids too.
- **M7 admin flow:** deliberately not added. A board-ADMIN release needs an
  explicit audited operation/UI owned by TASK-176/180.4; the command path now
  enforces holder-only release and returns `400`. The internal run revert is
  the one exception: it may restore the pre-run claim holder/lease (release
  or acquisition), via a non-wire `exemptClaimGuard` flag.
- **M13/M16 contract:** the server is authoritative for WIP/collection caps;
  `inverse:true` and `RESTORE_*` buy nothing. `RESTORE_COLUMN_CARDS` counts
  the resulting column and the writer mirrors the reducer (omitted cards are
  parked in the invisible orphan column). Client undo stays responsive for
  non-WIP actions (optimistic + rollback on refusal), while the two WIP
  sensitive moves wait for the server. Internal run revert is the only
  exemption and is flagged in-process.
- **L24 proof:** only an explicitly marked rollback releases the idempotency
  record. A P2028 inside the write transaction is marked by `createBoard`,
  `importBoards` or `BoardWriteService`; a P2028 from a post-commit aggregate
  read is unmarked and keeps the row for the 24 h lease.

## Cross-cluster boundaries

- **180.1** owns runs/revert/preview. The run preview keeps the M22 WIP refusal
  for non-restore inverses (`MOVE_CARD`/`UNARCHIVE_CARD`); restore inverses get
  the internal exemption and are not reported as conflicts.
- **180.3** owns member expiry semantics (M15) and the full authz matrix. L35
  only stops the card face from contradicting the dialog; it does not change
  which memberships are active.
- **180.4** owns an explicit admin claim-release flow and approval interactions.
  The command path intentionally has no ADMIN override.
- **180.5** owns the public/MCP contract docs; OpenAPI was updated only for the
  new `X-Attachment-Count` response header.
- **176.9** (unmerged) owns admin card relations. Import
  `entity-parentage.ts`/`parentageConflict` when merging instead of keeping a
  second error shape.
- **180.7** owns retention/demo/snapshot cleanup; this stream keeps deleted
  attachment blobs and idempotency retention behavior unchanged on ambiguity.

## Known residuals

- The MCP default idempotency key is generated per tool invocation. An agent
  that receives a lost response and calls the tool again gets a new key unless
  it supplies the optional `idempotencyKey`; the client's own transient retry
  reuses the generated key, but a full process-level retry cannot.
- L19 scrubs markdown-image/link, bare-URL and `::image/video/audio` directive
  forms, including a `/api/v1` prefix. Exotic HTML `<img>` markup is not
  rewritten; the old URL then 404s but the visible text remains until edited.
  The delete publishes `attachment_deleted`; an open description editor still
  refreshes on its normal reload/focus path.
- H3 duplicate writers still upsert checklist/item rows one by one. A very
  large column duplicate remains linear in rows written; batching was
  deliberately deferred because each row carries its own version bump and
  revive semantics.
- M13/M16 residual: non-move `RESTORE_*` undo is still optimistic in the UI.
  A server refusal rolls it back and keeps the undo step, but the card can
  briefly appear restored before the 409. Deferring every refusable restore
  is left for a later UX pass; the two WIP-sensitive move inverses are
  deferred.
- MCP now retries 502/504 keyed writes with the same key. A caller-level retry
  after a lost response still needs to pass the optional `idempotencyKey`.

## Tests added/updated

- `backend/test/commands-labels-checklists.e2e-spec.ts`: same-board cross-card
  checklist/item/link reparent attempts (including a nested item in a
  `RESTORE_CHECKLIST` snapshot), owner-only soft-delete revival, over-cap
  forged label/checklist/item restores vs genuine delete→restore.
- `backend/test/commands-columns-cards.e2e-spec.ts`: duplicate card/column
  checklist+item reload, derived-id victim collisions, positional batch
  parentage after an earlier ADD_CHECKLIST, copy checklist delete leaves the
  original, RESTORE_CARD and multi-card RESTORE_COLUMN_CARDS WIP refusals,
  cards/cardIds mismatch writer parity, one-card restore, duplicate touches.
- `backend/test/plans.e2e-spec.ts`: parentage conflict appears in plan preview;
  duplicate-first vs duplicate-after-add parity uses the source state at the
  command's own position. Victim checklists/items/links created earlier in the
  same plan are detected in both orders.
- `backend/test/runs.e2e-spec.ts`: PAT-held claim released by an internal run
  revert with a clean preview; a claim over a lapsed lease is restored to the
  previous holder/lease by the revert.
- `backend/test/runs.e2e-spec.ts`: duplicate pre-image includes the created
  checklist/item touches; the M22 unarchive WIP preview still refuses; existing
  run/revert suites stay green.
- `backend/test/card-claim.e2e-spec.ts`: cross-member release, same-user second
  PAT release, holder release.
- `backend/test/card-assignee.e2e-spec.ts`: RESTORE_CARD replay after a removed
  assignee is stripped.
- `backend/test/attachments.e2e-spec.ts`: deleted embedded URL scrub in a
  description and comment; inline media count and `attachment_limit` code.
- `backend/src/common/idempotency.service.spec.ts`: P2028 releases the key;
  ambiguous failures keep it.
- `shared/src/store/board-reducer.test.ts`: duplicate checklist/item ids are
  fresh and deterministic; links are not copied.
- `ui/src/store/use-undo-history.test.ts`: deferred MOVE/UNARCHIVE undo, WIP
  preflight, refusal keeps the step, success applies after the server.
- `ui/src/components/board/CardAttachments.test.tsx`: inline total drives the
  cap; cap error maps to the cap toast.
- `ui/src/components/board/CardComments.test.tsx`: page-2 edit refresh.
- `ui/src/components/board/CardItem.test.tsx`: removed assignee renders no
  face avatar.
- `ui/src/api/client.test.ts`, `mcp/src/client.test.ts`: generated and reused
  idempotency keys.
- Browser: `e2e/tests/app/cards/duplicate-content.spec.ts` reload,
  `e2e/tests/app/history/cards.spec.ts` WIP undo refusal,
  `e2e/tests/app/columns/lifecycle.spec.ts` filtered delete count.

## Verification

Run on this branch (`feat/TASK-180.2-write-integrity`, 2026-11-19):

- `npm run typecheck -w backend`, `-w shared`, `-w mcp`, `-w e2e`; `npx tsc -b ui` — passed.
- `npm run test:unit -w backend -- --runInBand` — 77 suites / 570 tests passed.
- `npm run test -w shared` — 13 files / 542 tests passed.
- `npm run test -w mcp` — 9 files / 143 passed, 1 skipped.
- UI focused Vitest: undo/WIP, server-sync classification, attachment cap,
  comment page-2 edit, assignee face, column views, API idempotency — passed.
- Backend targeted e2e (review round 3, single in-band run):
  `plans`, `runs`, `card-claim`, `commands-labels-checklists`,
  `commands-columns-cards` — 5 suites / 95 tests passed.
  Round 2 also ran `attachments`/`card-assignee` (6 suites / 114 tests); the
  wider round-1 list (`write-contract`, `admin`, etc.) was green before these
  changes, and the changed paths are covered above.
- Browser (isolated local API + Vite, Chrome): duplicate-content,
  filtered column delete, comment pagination/edit, description attachment and
  the WIP-undo refusal with exact localized toast — 8/8 passed. Drag-based
  legacy undo tests fail in this local non-Compose environment for the same
  reason on `main` (pointer geometry), so the WIP test uses the dialog's
  column row instead.
- `npm run build -w ui`, `npm run size -w ui` — passed; critical path
  263.38 kB gzip (limit 300 kB).
- `npm run lint` for backend/shared/ui/mcp — 0 errors (existing UI warnings
  unchanged); prettier check of every touched file passed.
- `npm run openapi:check` / `openapi:test` — valid, 80 operations, 5 tests.
- `git diff --check` — clean.
