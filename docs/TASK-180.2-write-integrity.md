# TASK-180.2 — Card/command write integrity

Implements the 180.2 slice of `TASK-180-bug-research-remediation.md` on top of
TASK-180.1 (`4b22721f`). No PR/merge is part of this stream.

## What changed

| ID | Change |
|---|---|
| H2 | `ADD_/RESTORE_CHECKLIST`, `ADD_/RESTORE_CHECKLIST_ITEM`, `ADD_CARD_LINK` and nested `RESTORE_CARD`/`RESTORE_COLUMN`/`RESTORE_COLUMN_CARDS` snapshots now check the stored parent, not only the board. A same-board id owned by another card/checklist/link answers `409 { code: "id_conflict", conflict: "id" }` before the writers run. Soft-deleted rows may be revived only by their original owner. The shared owner predicate and error shape live in `backend/src/commands/entity-parentage.ts`; TASK-176.9's admin `assertAdminCardRelations` uses the same `id_conflict` envelope and should import this helper when its branch merges. Admin commands remain run-free/pre-image-free (covered by `admin.e2e-spec.ts`). |
| L18 | The idempotency fingerprint canonicalizes `RESTORE_CARD` without `card.assigneeId`. The server may strip a removed assignee from the applied/stored action, so that derived field is not part of the request identity. An honest retry with the original body returns the stored result; a genuinely different payload still conflicts. |
| M7 | A live claim may be released only by the holder identity that claimed it (agent session, then PAT, then legacy user id). Another member, a second PAT of the same user, or a browser session / PAT cross-release answers `400 field:"action.claimedBy"`. Lapsed leases remain free to take or clear. |
| H3 | Duplicate card/column now derive fresh checklist/item ids from the new card id (`duplicateChecklistId`/`duplicateChecklistItemId` in the shared reducer), so the optimistic client and the server writers agree without an extra id map. The duplicate writers persist checklists/items and include them in `touches`/pre-images. Links are intentionally not copied — copies start unlinked. |
| M13 | `RESTORE_*` no longer skips WIP/collection guards based on the action type or a client `inverse:true`. Each restore is checked as the fresh add it performs (cards/columns/labels/checklists/items, including nested snapshots). Only the internal run-revert path passes `exemptRestoreLimits`; it is not a wire field. |
| M16 | Client undo of `MOVE_CARD`/`UNARCHIVE_CARD` is no longer optimistic: it preflights the destination WIP and otherwise waits for the server. A refusal leaves the board untouched and restores the undo step for a later retry. `inverse.ts` and `BoardScopedAction.inverse` document that the flag is local bookkeeping, not a server exemption. |
| M17 | UI `createBoard`/`importBoards` send an `Idempotency-Key` and retry once on network/502/503/504 with the same key. MCP `create_board`, `import_board`, `create_share`, `add_comment` and `upload_attachment` generate a default key and the client retries a transient post with it. Command/batch writes keep using `commandId`. |
| M14 | The delete-column confirmation counts `column.cardIds.length` (all cards that will be deleted), while the header badge/empty state keeps the filtered `cards.length`. |
| L19 | Deleting an attachment scrubs its `/attachments/<id>/content` URL from live card descriptions and comments, then runs `reconcileDescriptionAttachments` so other embeds and the card badge stay correct. The soft-deleted row/blob still exists for retention/undo snapshots. |
| L20 | The attachment list exposes `X-Attachment-Count`, the total live budget including inline/description media. The UI uses it for the cap and maps `code:"attachment_limit"` to the cap message, not "bad file type". OpenAPI documents the header. |
| L24 | An idempotency record is released when the write proves a rollback via the existing `markGuaranteedRollback` marker or a Prisma `P2028` transaction timeout. Ambiguous post-commit failures still keep the record. Board create/import and `BoardWriteService` mark their converted timeout errors as proven rollbacks. |
| L35 | The card face resolves the assignee from the live roster; a removed/expired assignee renders no avatar, matching the dialog's "Unassigned". Member-roster expiry rules stay in 180.3/M15. |
| L36 | A `comment_updated` frame refreshes the loaded pages until it finds the edited row (bounded by the loaded page count + 1), so an edit on page 2+ updates in place instead of only the newest 50. |

## Decisions

- **H3 id contract:** deterministic derived ids, not an action-carried map:
  `${newCardId}~cl~<index>` and
  `${newCardId}~cl~<checklistIndex>~i~<itemIndex>` (base truncated to 80
  characters, no colon because `Command.touches` is `kind:id`). Reducer and
  writers therefore produce the same rows; the ids stay below the 128-char
  wire id bound for follow-up checklist commands.
- **M7 admin flow:** deliberately not added. A board-ADMIN release needs an
  explicit audited operation/UI owned by TASK-176/180.4; the command path now
  enforces holder-only release and returns `400`. TASK-180.4 can add the admin
  flow without weakening this check.
- **M13/M16 contract:** the server is authoritative for WIP/collection caps;
  `inverse:true` and `RESTORE_*` buy nothing. Client undo stays responsive for
  non-WIP actions (optimistic + rollback on refusal), while the two WIP
  sensitive moves wait for the server. Internal run revert is the only
  exemption and is flagged in-process.
- **L24 proof:** `P2028` from an interactive Prisma transaction is a rolled
  back transaction, so it is safe to delete the `in_progress` idempotency row.
  Any other error after `run()` is ambiguous and keeps the row for the 24 h
  lease, exactly as before.

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
- L19 scrubs URLs with markdown-image/link/bare-URL patterns. Exotic HTML
  `<img>` markup is not rewritten; the old URL then 404s but the visible text
  remains until edited.
- H2 duplicate-derived checklist ids rely on the new card id being fresh; a
  crafted pre-existing id that exactly matches the derived pattern is still
  caught by the same parentage guard only when a command names it.

## Tests added/updated

- `backend/test/commands-labels-checklists.e2e-spec.ts`: same-board cross-card
  checklist/item/link reparent attempts, owner-only soft-delete revival,
  over-cap forged label/checklist/item restores vs genuine delete→restore.
- `backend/test/commands-columns-cards.e2e-spec.ts`: duplicate card/column
  checklist+item reload, copy checklist delete leaves the original, RESTORE_CARD
  and RESTORE_COLUMN_CARDS WIP refusals, duplicate touches.
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
- `npm run test:unit -w backend -- --runInBand` — 77 suites / 568 tests passed.
- `npm run test -w shared` — 13 files / 541 tests passed.
- `npm run test -w mcp` — 9 files / 142 passed, 1 skipped.
- UI focused Vitest: undo/WIP, attachment cap, comment page-2 edit, assignee
  face, column views, API idempotency — 10 files / 118 tests passed.
- Backend targeted e2e (single in-band run): `commands-ids`,
  `commands-labels-checklists`, `commands-columns-cards`, `card-claim`,
  `card-assignee`, `write-contract`, `attachments`, `activity-comments`,
  `runs`, `admin` — 9 suites / 187 tests passed. (The attachments suite was
  also re-run alone: 20/20.)
- Browser (isolated local API + Vite, Chrome): duplicate-content,
  filtered column delete, comment pagination/edit, description attachment and
  the new WIP-undo refusal — 8/8 passed. Drag-based legacy undo tests fail in
  this local non-Compose environment for the same reason on `main` (pointer
  geometry), so the WIP test uses the dialog's column row instead.
- `npm run build -w ui`, `npm run size -w ui` — passed; critical path
  263.38 kB gzip (limit 300 kB).
- `npm run lint` for backend/shared/ui/mcp — 0 errors (existing UI warnings
  unchanged); prettier check of every touched file passed.
- `npm run openapi:check` / `openapi:test` — valid, 80 operations, 5 tests.
- `git diff --check` — clean.
