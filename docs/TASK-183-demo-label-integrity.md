# TASK-183 — Demo fixture hygiene and card label timestamp integrity

**Status:** planned (docs-only roadmap ticket; no production code in this task)  
**Priority:** P2 for demo fixture hygiene; P3 for the label timestamp bug  
**Base:** `main` = `002a31ec`  
**Branch:** `docs/TASK-183-demo-label-integrity`  
**Scope:** the disposable TASK-176 demo fixture and the `SET_CARD_LABEL` card timestamp. No schema, API-contract or UI redesign.  
**Source:** TASK-176 demo investigation, 2026-11-19; code inspection of the seed script, command writers, shared reducer, inverse and focus-diff paths.  
**Related:** TASK-176 demo setup; TASK-156 (label-only `updatedAt` workaround); TASK-150 (focus diff); TASK-21.7d (undo timestamps); TASK-180.7 (demo data lifecycle, coordination only).

---

## 1. Summary

This ticket covers two independent findings from the TASK-176 demo investigation:

1. **The demo database drifted from its committed fixture.** The database
   `janosik_task176_demo` contains manual edits that are not produced by the
   committed seed: a card titled `Card claim visibility 123`, a description
   ending in `фывфыв`, and an extra checklist `123` with item `1`. It also
   contains a `TASK-176 demo` label, a `TASK-176 acceptance` checklist and two
   named TASK-176 links that are not in any committed seed, plus 60
   `t176-comment-*` rows (9 soft-deleted, 51 live). The board aggregate still
   loads and the API accepts it, so this is **not corruption**; it is an
   unreproducible demo fixture. The repository has no TASK-176 seed, reset or
   verification command, and the existing pixel seed does not create the
   TASK-176-specific fixture rows. A clean demo cannot currently be recreated
   from source, and manual edits silently pollute the canonical fixture.

2. **`SET_CARD_LABEL` does not update `Card.updatedAt`.** The shared reducer
   changes `labelIds` but leaves `updatedAt` unchanged
   (`shared/src/store/board-reducer.ts:1267-1308`). The command writer then
   calls `bumpCard`, which writes `new Date(card.updatedAt)` from that
   after-state (`backend/src/commands/command-writers.ts:371-378`). The result
   is a **version bump with a stale timestamp**, so the card's “Updated” value
   and the focus-diff fast path do not reflect the label change. This is
   low-severity and separate from TASK-176.9.

The two subtasks can ship independently. Both are testable without changing
the board command contract or the admin demo runner.

---

## 2. Finding A — demo fixture hygiene

### 2.1 Observed state

Read-only probe of `http://127.0.0.1:5311` on 2026-11-19, app account
`pixel-admin@example.com`, board `Agent Ops Demo`
(`px-board-agent-ops`):

| Item | Observed in `janosik_task176_demo` | Committed seed output |
| --- | --- | --- |
| Card `px-card-card-claim` title | `Card claim visibility 123` | `Card claim visibility` (`scripts/seed-agent-pixel-demo.mjs:346`) |
| Card description | `API reference sweep — exact MCP transport contract. фывфыв` | `API reference sweep — exact MCP transport contract.` (seed run 126) |
| Checklists | `TASK-176 acceptance` (3 items) **and** `123` (item `1`) | No card checklist is created by the seed |
| Labels | `TASK-176 demo` (`px-label-task176-demo`, pink) attached to the card | No label is created by the seed |
| Card links | `px-link-task176-demo` (relates to `px-card-mcp-write`), `px-link-task176-blocks` (blocks `px-card-approval-inbox`), and a random-UUID `relates_to` link to `px-card-mcp-callouts` | No card link is created by the seed |
| Board aggregate | 200, six live cards on this board, four columns, one label | Twelve live cards total across two boards, four columns per board; no label unless the TASK-176 overlay adds one |

The `TASK-176 acceptance` checklist, the `TASK-176 demo` label and the two
named `px-link-task176-*` links are not junk by definition: they look like the
intended TASK-176 manual fixture. But none of them is in a committed seed, so
the fixture that the team is testing against cannot be rebuilt from the
repository. The `123` checklist, the `123` title suffix, `фывфыв` and the
random-UUID link are manual typing artifacts. The reset/verify work must
classify the whole set, not only the three visible junk strings.

This is not a data-integrity incident:

- the board aggregate returns 200 and validates;
- versions and positions are coherent;
- the API accepted the edits and continues to read them;
- no row is orphaned or unreadable.

The defect is reproducibility: the canonical fixture and the hand-edited
database are different things, and nothing detects the difference.

### 2.2 Complete observed mutation inventory

The public `GET /boards/:id/commands?since=0` delta is **not a complete
audit**: at probe time it returned 46 entries for sequence numbers 1–51. The
inventory below combines that delta, the current card fields, the admin
comment list (60 `t176-comment-*` rows: 9 soft-deleted, 51 live), the seed
source and direct seed writes that bypass the command log. Any verifier must
use all of these, not only `Command` rows.

| Observed mutation / field | Evidence | Classification | Manifest / verifier action |
| --- | --- | --- | --- |
| Seed commands `px-seed-cmd-*` (runs 128/126/124/121/118/108/115/112/104) | `Command` rows; seed source | Canonical | Expected; verify stable outcomes, not command timestamps. |
| `MOVE_CARD` of `px-card-approval-inbox` to `px-col-ops-done` | seq 1, run 128 | Canonical seed | Verify column/position. |
| Canonical `UPDATE_CARD` description on `px-card-card-claim` | seq 2 | Canonical seed | Exact description. |
| `DELETE_CARD` of `px-card-old-onboarding` | seq 3; run 124 is marked `reverted`, but no restore command exists | Canonical seed data with a **misleading run status** | Verify the card is absent/soft-deleted; document that the run is not a real revert. |
| Landing/MCP seed updates | seq 4–8; seed direct DB title update | Canonical | Verify final stable titles/descriptions. |
| `UPDATE_CARD` title `Card claim visibility 123` | seq 26 | **Junk** | Title must be exactly `Card claim visibility`. |
| `UPDATE_CARD` description suffix `фывфыв` | seq 24 | **Junk** | Description must equal the canonical string. |
| `SET_CARD_ASSIGN` to `px-user-admin` | seq 23 | Manual/undecided | Decide `assigneeId`; if not canonical, verify `null`. |
| `MOVE_CARD` of the fixture card to `px-col-ops-done` index 2 | seq 25 | Manual/undecided | Verify `columnId`/`position`; if not canonical, verify the seed position. |
| `SET_CARD_COVER` yellow | seq 29 | Manual/undecided | Verify `cover`; if not canonical, verify `null`. |
| `SET_CARD_PRIORITY` blocker | seq 41 | Manual/undecided | Verify `priority`; if not canonical, verify default/`null`. |
| `ADD_LABEL` + initial `SET_CARD_LABEL` for `px-label-task176-demo` | seq 15; seed creates no labels | Canonical candidate | Verify exact label ID/name/color and final card label set. |
| 18 additional `SET_CARD_LABEL` toggles on the same label | seq 30–38, 42–44, 46–51; final state is on | **Volatile/noise** | Verify final `labelIds` only; command count is not canonical. |
| `ADD_CHECKLIST` `TASK-176 acceptance` + 3 items | seq 16–19; IDs `px-checklist-task176-demo` / `px-checkitem-task176-*` | Canonical candidate | Verify checklist ID/title/position and all items. |
| `SET_CHECKLIST_ITEM_DONE` for all three acceptance items | seq 20, 27, 28 | Canonical candidate | Verify each item's `done` state. |
| `ADD_CHECKLIST` random UUID `123` + item `1` | seq 39–40 | **Junk** | No checklist titled `123`; no item text `1`. |
| `ADD_CARD_LINK` `px-link-task176-demo` / `px-link-task176-blocks` | seq 21–22 | Canonical candidate | Verify link IDs, types, targets and order. |
| `ADD_CARD_LINK` random UUID to `px-card-mcp-callouts` | seq 45 | **Junk** | No random-UUID link. |
| 60 `t176-comment-*` rows | Admin comments: total 60, 9 soft-deleted, 51 live | TASK-176.9 manual scaffolding, **separate** | Exclude from the TASK-176 canonical fixture unless a dedicated TASK-176.9 fixture is defined; reset removes them. |
| `dueDate`, `acceptanceCriteria`, `definitionOfDone`, `claimedBy`, `leaseUntil`, `archivedAt` | No observed mutating command; seed leaves these unset/empty | Canonical absent unless decided otherwise | Assert absent/empty explicitly; a future value fails verify. |
| Session heartbeats, approval TTL/timestamps, run timestamps/statuses, `createdAt`/`updatedAt` where not listed above | Runtime/volatile | Volatile | Ignore in the fixture manifest except where a stable status is part of the contract. |

The named `t176-*` commands (label attach, acceptance checklist/items, named
links) are the likely canonical TASK-176 overlay. The random UUID commands,
the `123`/`1` checklist, the title/description junk and the 18 extra label
toggles are drift. The assignee/cover/priority/move changes are **undecided**:
they may be intentional manual scenarios or junk; the manifest must state yes
or no for each, and the verifier must enforce that choice. Do not silently
delete them without deciding; do not silently keep them as "canonical" either.

### 2.3 Root-cause research

**The only committed seed is the pixel demo seed.**

`scripts/seed-agent-pixel-demo.mjs`:

- refuses to run without `SEED_ALLOW=1` (`:39-42`);
- deletes demo tables before recreating rows, but the order is incomplete:
  `ChecklistItem`, `Checklist` and `CardLink` are never deleted;
- creates fixed IDs for two boards, eight columns and **13 card rows**: 12 via
  `card.createMany` plus `px-card-expired-retention` through `ADD_CARD` in the
  retention run. Twelve remain live;
- one card is soft-deleted by the seed's `DELETE_CARD` (run 124). That run is
  marked `reverted`, but no restore command exists, so the deletion remains
  applied — the fixture contains a misleading run status;
- creates board `px-board-agent-ops` and card `px-card-card-claim` with
  `title: "Card claim visibility"` (`:341-346`);
- creates the canonical description through the real command transport in
  `seed-run-126` (`UPDATE_CARD` on `ids.cardClaim`);
- creates no card checklists, labels, card links or comments;
- writes runs, approvals, sessions and a JSON summary to stdout.

**Why the current cleanup does not work.** Prisma relations default to
`RESTRICT` (the schema header says app-level cascades are deliberate). The
seed deletes `cardLabel`, then `card`, then `label`, `column`, `board`, but
never deletes:

- `ChecklistItem` and `Checklist` — both reference `Card`;
- `CardLink` — references `Board` and both cards;
- `BoardShare` / `BoardShareAuditLog` — the share FK is `SetNull`, so the
  board delete can succeed while stale shares and audit rows survive; the
  audit log has no FK at all;
- other non-board children such as `DemoRun` / `DataExport` remain by design
  or by accident depending on the table.

On the observed database, `Card.deleteMany()` will fail once a checklist or
card link exists, because the earlier deletes have already committed and the
FK is restrictive. The current “wrapper” cannot be trusted; the reset must
either (a) drop and recreate the demo schema/database and apply migrations, or
(b) run an explicitly ordered, transactional delete covering every dependent
table and add a regression that resets twice after adding a checklist and a
link. Recommendation: (a) for a disposable demo database.

The seed is designed for a **disposable** database and warns “never the live dev
DB” in its header, but the only hard guard is `SEED_ALLOW=1`. It does not:

- validate that `DATABASE_URL` points at a demo database;
- create or migrate the database;
- verify the fixture after seeding;
- distinguish a base pixel fixture from a TASK-176 acceptance fixture;
- provide a package script, reset command or cleanup path.

**No TASK-176-specific fixture is committed.**

- `grep` across the current tree finds no `janosik_task176_demo`,
  `TASK-176 acceptance`, `px-checklist-task176-demo` or
  `px-checkitem-task176` references.
- `package.json` exposes `demo:swarm` and `demo:100`; those drive load
  against an existing board, not a deterministic fixture. It has no seed/reset/
  verify script for the pixel/TASK-176 fixture.
- The pixel parity documentation (`design/task-179-visual-acceptance/pixel-parity/README.md`)
  documents a manual environment invocation, not a repeatable developer
  command.

Therefore the `TASK-176 acceptance` checklist, label and named links were
added by hand or by an untracked script. Even if the seed's cleanup succeeded,
it would delete the intended TASK-176 label/checklist/links along with the junk;
in practice it can fail on the missing checklist/link deletes. The current
reset path is therefore both unsafe (loses intended fixture) and unreliable
(FK `RESTRICT`).

**The admin demo runner is a different system.**

`backend/src/admin/demo.service.ts` is the TASK-57/TASK-69 admin demo. It has
its own manifest and cleanup path, but it is not a safe pattern to copy: its
known H9 gaps include over-broad `CardLink` deletion and a title-prefix purge
that can hit a user board. TASK-180.7 owns those fixes. This ticket must not
repurpose the runner, change its semantics or rely on its cleanup as the
fixture reset.

### 2.4 Proposed cleanup/reset path

**Recommended: commit the fixture, add an explicit reset/verify command, and
never rely on manual SQL.**

1. **Commit the canonical TASK-176 fixture.** Decide whether the
   `TASK-176 acceptance` checklist, the `TASK-176 demo` label and the named
   `px-link-task176-*` links are intended. Also decide the observed
   assignee/cover/priority/move values and the `t176-comment-*` set (§2.2). If
   canonical, add them to a committed fixture manifest and seed deterministically.
   If not, remove them from the canonical fixture and document that they were
   manual scaffolding. Do not reset the current database before that decision.

2. **Add a fixture manifest.** A small `scripts/fixtures/task176-demo.json` (or
   an exported object module) lists the stable fixture contract:
   board IDs/titles, column IDs/titles, card IDs/titles, the canonical
   description, intended label IDs/names, checklist IDs/titles/items, card-link
   IDs/types/targets, `columnId`/`position`, `priority`, `assigneeId`, `cover`,
   explicit `dueDate`/task-spec/claim/`archivedAt` decisions, the comment-set
   decision and expected counts. Seed and verify both read the same manifest so
   they cannot drift.

3. **Add a reset command.** Example:
   `npm run demo:task176:reset`. It should:
   - require an explicit `DEMO_DATABASE_URL` and `DEMO_API_URL` with **no
     defaults**;
   - refuse conflicting `DATABASE_URL` / `API_URL` values instead of silently
     preferring one;
   - resolve one database URL, print only its host and database name, and pass
     it as `DATABASE_URL` to every child process (Prisma, migrations, seed and
     backend);
   - refuse to run unless the database name matches the documented demo name
     (for example exactly `janosik_task176_demo`, or a `*_demo` pattern plus an
     explicit allow flag);
   - require `SEED_ALLOW=1` or a new `DEMO_RESET_ALLOW=1`;
   - verify the API is bound to that same database **before deleting**
     anything. Preferred: the reset launches a dedicated backend with the
     resolved `DATABASE_URL` on a private port, waits for `/health`, checks a
     marker/identity, then **stops it before the schema drop**; after
     migrations it starts the backend again for the seed. An externally managed
     API is not accepted on trust. A marker row plus a dev-only identity
     endpoint is an alternative only if the endpoint is added and tested; do not
     compare a board title or assume a port.
   - reset by dropping/recreating the demo schema and applying migrations
     (`prisma migrate reset --force --skip-seed` against the guarded database),
     then run the seed and verifier. The demo database is disposable; this
     avoids a brittle hand-maintained delete list as new FK children appear.
     If product rejects schema reset, use one explicit ordered transaction for
     `ChecklistItem → Checklist → CardLink → CardLabel → Comment → Attachment →
     Activity → CommandPreimage → Command → AgentRun → ApprovalRequest →
     AgentSession → ApiToken → AttentionNotification → BoardShareAuditLog →
     BoardShare → Card → Label → Column → BoardMember → Board → DemoRun →
     DataExport → RefreshToken → User` and add the reset-twice regression below.
   - exit non-zero on any mismatch, leaving the operator with a clear message
     that the database is partial and the reset must be rerun.

   The seed itself must apply the same `DEMO_DATABASE_URL` / `DEMO_API_URL`
   guard, so a direct `SEED_ALLOW=1` invocation cannot bypass the wrapper.
   Do not add a destructive HTTP endpoint.

4. **Add a verify command.** Example:
   `npm run demo:task176:verify`. It must be read-only and assert the manifest
   against the live database:
   - `px-card-card-claim.title === "Card claim visibility"`;
   - the canonical description is exact (no `фывфыв` suffix);
   - the checklist set is exactly the expected set (no `123`/`1`);
   - the label set and card-link set match the manifest (no random-UUID link,
     no missing `TASK-176 demo` label or named TASK-176 links);
   - the fixture card's `columnId`/`position`, `priority`, `assigneeId`,
     `cover`, `dueDate`, `acceptanceCriteria`, `definitionOfDone`, claim fields
     and `archivedAt` match the manifest's explicit yes/no decision;
   - expected boards/columns/cards/checklists/labels/links exist;
   - no unexpected card title, description, checklist, label or link on the
     fixture card;
   - the `t176-comment-*` set is either absent (canonical TASK-176 fixture) or
     exactly the separately declared TASK-176.9 fixture; never silently
     ignored.

   The verifier must be genuinely read-only. Use Prisma reads or a pre-issued
   `DEMO_API_TOKEN`; do not log in with email/password (login writes a refresh
   token/session) and never put credentials in a URL or log. If an API read is
   used, declare the session write or avoid it entirely. Ignore timestamps and
   other volatile fields except where the manifest explicitly pins a stable
   value.

5. **Document the workflow.** Add a short `docs/DEMO-FIXTURES.md` (or a section
   in the existing pixel parity README) with:
   - the database name, `DEMO_DATABASE_URL`, `DEMO_API_URL` and the no-default
     rule;
   - the reset command and its destructive schema-recreate nature;
   - the verify command and its read-only guarantee;
   - the rule that the canonical demo is reset-only and manual experiments use
     a cloned database or a separate board;
   - the prerequisite `npx prisma migrate deploy -w backend` for manual setup
     and the dedicated backend the reset starts for the command-transport part
     of the seed;
   - what to do when the verifier fails (capture the diff, reset, do not patch
     rows by hand).

6. **Optional: template/clone isolation.** For teams that run many manual
   sessions, document `CREATE DATABASE janosik_task176_demo_<suffix> TEMPLATE
   janosik_task176_demo_template` (or a scripted equivalent) so each session
   starts from a clean template and can be discarded. This is an alternative to
   resetting one shared database, not a requirement for the first fix.

**Do not** add a targeted `DELETE FROM Checklist WHERE title = '123'` cleanup.
Manual drift can add arbitrary rows; a full deterministic reset plus a verifier
is the only maintainable path.

### 2.5 Acceptance criteria — demo hygiene

1. A fresh developer can recreate the TASK-176 demo database from committed
   source with one documented command after the documented prerequisites.
2. The seed produces 13 card rows and 12 live cards, with stable IDs and exact
   stable values: board/column/card titles, the `px-card-card-claim`
   description, and the intended label, checklist and card-link sets (including
   `TASK-176 demo`, `TASK-176 acceptance` and the named `px-link-task176-*`
   links if confirmed canonical). The manifest also pins the fixture card's
   `columnId`/`position`, `priority`, `assigneeId` and `cover`, and explicitly
   declares `dueDate`, task-spec, claim and `archivedAt` absent/empty.
3. Reset is rerunnable: running it twice, after first adding a checklist and a
   card link, succeeds (no FK `RESTRICT` failure) and returns the same stable
   fixture. Timestamps and generated runtime metadata may differ.
4. The reset requires explicit `DEMO_DATABASE_URL` and `DEMO_API_URL` with no
   defaults, refuses conflicting `DATABASE_URL`/`API_URL`, verifies the API is
   bound to the same demo database before deleting, stops the dedicated backend
   before the schema drop, and prints only host and database name — never
   credentials.
5. A direct `SEED_ALLOW=1` seed invocation cannot bypass the demo URL/API guard,
   and no password or token appears in a URL or log.
6. `demo:task176:verify` passes immediately after reset and is genuinely
   read-only (no email/password login; a pre-issued token or Prisma reads only).
   It checks the full manifest, including column/position, priority, assignee,
   cover, labels, links, checklists and the comment-set decision.
7. `demo:task176:verify` fails on the observed junk: `Card claim visibility 123`,
   a description containing `фывфыв`, a checklist titled `123` with item `1`,
   the random-UUID card link, and any undecided assignee/cover/priority/move
   value that does not match the manifest.
8. A manual edit followed by a reset restores the canonical fixture, and the
   verifier passes again.
9. The TASK-176 label, acceptance checklist and named links, if intended, are
   created by the seed and are not lost by a reset; if any is not intended, it
   is removed from the canonical fixture and the docs say so. The 60
   `t176-comment-*` rows are either absent or moved to a separately declared
   TASK-176.9 fixture; they are not silently ignored.
10. No admin demo-runner code, production database or non-demo developer
    database is touched. The docs state that the canonical fixture is
    reset-only; manual edits go to a scratch clone or a separate board.

---

## 3. Finding B — `SET_CARD_LABEL` does not bump `Card.updatedAt`

### 3.1 Observed contract

A label attach/detach:

- changes `Card.labelIds`;
- increments `Card.version` (the writer's `bumpCard` does this);
- updates `lastActorId`;
- **does not advance `Card.updatedAt`**.

The aggregate and the UI therefore show a card whose visible label set changed
but whose “Updated” timestamp did not. `version` still changes, so CAS and
command idempotency are not broken; the defect is the card's update timestamp,
not the write itself. It is low severity but a real consistency bug.

### 3.2 Root cause

The chain is:

1. `shared/src/store/board-reducer.ts:1267-1308` — `setCardLabel` computes
   `nextCard` with the new `labelIds` and appends the label activity, but does
   not set `updatedAt`.
2. `backend/src/commands/command-writers.ts:973-978` — `SET_CARD_LABEL` writes
   the join rows and calls `bumpCard(tx, card, ctx.actorId)`.
3. `backend/src/commands/command-writers.ts:371-378` — `bumpCard` writes
   `updatedAt: new Date(card.updatedAt)`, deliberately trusting the reducer's
   after-state so an inverse can restore the previous timestamp via
   `cardUpdatedAt`.

Because step 1 leaves the old value in place, step 3 writes the old value back.
`version` is incremented in the same update, which exactly matches the reported
“only `version` changed” behaviour.

The writer's comment says this is “the bookkeeping every label/checklist
command does on the card it edits (the reducer's `cardStamp`, including inverse
`cardUpdatedAt`)”. `setCardLabel` is the exception that violates that
assumption.

**The inverse has the same omission.** `shared/src/store/invert.ts:449-462`
builds the inverse `SET_CARD_LABEL` with `cardActivity` and the previous label
index, but does not carry `cardUpdatedAt: card.updatedAt`. Once the reducer
starts stamping `updatedAt`, an undo must also carry the previous timestamp, or
the undo will write the undo time instead of restoring the pre-change state.

**Validation drops the inverse stamp even if invert supplies it.**
`shared/src/store/validate.ts:61-90` defines `CARD_STAMPED_TYPES` — the only
command types for which an inverse may carry `cardUpdatedAt`. `SET_CARD_LABEL`
is absent; `CARD_ACTIVITY_REWIND_TYPES` includes it only for `cardActivity`.
At `:377-389`, the inverse override is therefore dropped before the reducer or
writer sees it. Adding `cardUpdatedAt` to `invert` without adding
`"SET_CARD_LABEL"` to `CARD_STAMPED_TYPES` would be a silent no-op on undo.

**The UI already works around it.** `ui/src/store/board-diff.ts:58-70` compares
`labelIds` explicitly because label-only changes can have the same
`updatedAt`; `ui/src/store/board-diff.test.ts:123` codifies that behaviour as
“reports a label-only card change with an equal `updatedAt` (TASK-156)”. The
`updatedAt`-only fast path would miss the label change; the `labelIds` fallback
masks the stale timestamp rather than fixing it.

### 3.3 Audit of other card-content actions

The audit should not stop at `SET_CARD_LABEL`. The writer/reducer pair has a
clear invariant: **every command that changes card content must put the
command's card stamp into the reducer's after-state; the writer then persists
that exact stamp.** The following table records the initial audit; the
implementation must turn it into tests or a documented decision.

| Action / area | Reducer stamps card `updatedAt`? | Writer bumps card? | Verdict |
| --- | --- | --- | --- |
| `SET_CARD_LABEL` | **no** | yes (`bumpCard`, old value) | **Bug — fix.** |
| `ADD_CARD_LINK` / `REMOVE_CARD_LINK` | yes (`cardStamp`) | yes (`bumpCard`) | OK. |
| `ADD/RENAME/DELETE_CHECKLIST` | yes (`patchChecklists`) | yes (`bumpCard`) | OK. |
| `ADD/RENAME/DELETE_CHECKLIST_ITEM` | yes (`patchChecklists`) | yes (`bumpCard`) | OK. |
| `RESTORE_CHECKLIST` / `RESTORE_CHECKLIST_ITEM` | yes (`patchChecklists`) | yes (`bumpCard`) | OK. |
| `UPDATE_CARD` / `TOUCH_CARD` | yes (`cardStamp`; quiet path keeps old until touch) | direct write | OK; verify quiet/touch tests. |
| `SET_CARD_DUE_DATE`, `SET_CARD_PRIORITY`, `SET_CARD_ASSIGN`, `CLAIM_CARD`, `SET_CARD_TASK_SPEC` | yes (`cardStamp`) | direct write | OK. |
| `SET_CARD_COVER` | yes (`cardStamp`) | direct write | OK. |
| `MOVE_CARD`, `ARCHIVE_CARD`, `UNARCHIVE_CARD`, `DELETE_CARD`, `RESTORE_CARD`, `DUPLICATE_CARD` | yes / explicit timestamps | direct write | Verify in the regression matrix; no same-shape omission found. |
| `DELETE_LABEL` | **no** on every card that loses the label | **no `bumpCard`** | **Same class — decide and test.** |
| `RESTORE_LABEL` | **no** on every card that regains the label | **no `bumpCard`** | **Same class — decide and test.** |
| `RENAME_LABEL` / `SET_LABEL_COLOR` | label metadata only; card content unchanged | no card bump | Intentional; document why. |
| `ADD_LABEL` | no existing card changes | no card bump | Intentional. |

`DELETE_LABEL` is multi-card: one command removes a label from many cards.
Fixing it needs both forward stamping for every affected card and a per-card
timestamp in the inverse. `RestoreLabelAction`’s `assignments` currently
carries only `{ cardId, index }`; the clean fix is to add the previous
`updatedAt` per assignment, validate it, and have the reducer use it on
restore, while the writer calls `bumpCard` for every affected card. If that is
too large for this ticket, the implementation must record an explicit
follow-up and keep the current UI workaround; it must not silently leave the
forward command without its inverse.

### 3.4 Proposed fix

**Primary, required:**

1. In `setCardLabel`, stamp the next card with `updatedAt: cardStamp(action)`.
   This is the same helper used by the other card-content actions and respects
   inverse `cardUpdatedAt`.
2. In `invert` for `SET_CARD_LABEL`, add
   `cardUpdatedAt: card.updatedAt` so undo restores the pre-change timestamp.
3. Add `"SET_CARD_LABEL"` to `CARD_STAMPED_TYPES` in
   `shared/src/store/validate.ts` so the inverse override survives validation.
   Add a `validate.test.ts` case that an inverse `SET_CARD_LABEL` with
   `cardUpdatedAt` is accepted unchanged, and that a non-inverse command still
   drops it.
4. Keep `bumpCard` as-is for `SET_CARD_LABEL`; it will now persist the new
   stamp and increment version exactly once.
5. Update the `board-diff` comment and the “equal `updatedAt`” test to describe
   the new contract. Retaining the `labelIds` comparison is acceptable as a
   defensive compatibility check for rows written by older servers; it should
   no longer be the only way a label-only change is detected.
6. Add a reducer test that asserts `updatedAt`/`labelIds` in the after-state,
   and a separate persistence/integration test that asserts the database row's
   `updatedAt`, `version = previous + 1`, `lastActorId = actor` and
   `labelIds = after-state`. Do not assert server-only fields on the shared
   `Card` reducer state (it has no `version`/`lastActorId`).

**Same-class decision:**

7. If `DELETE_LABEL` is fixed, forward `DELETE_LABEL` must stamp every affected
   card (`updatedAt` and `version`) while deleting their label links. Undo
   `RESTORE_LABEL` needs each card's pre-delete `updatedAt`, not one global
   `cardUpdatedAt`: extend `RestoreLabelAction.assignments` with a per-card
   previous timestamp, validate that field, and have the writer call
   `bumpCard` for every affected card. If that is too large for this ticket,
   split it into a named follow-up with a test proving the current gap and a
   note here. Do not half-fix the forward command without its inverse.
8. Do not change `RENAME_LABEL`/`SET_LABEL_COLOR` card timestamps: they are
   label metadata, not card membership.

### 3.5 Acceptance criteria — label timestamp

1. Attaching or detaching a label sets the reducer card's `updatedAt` to the
   command's card stamp (`action.at`, or the inverse `cardUpdatedAt`) and
   changes only that card's `labelIds`.
2. The persisted database row has `updatedAt = reducer after-state`,
   `version = previous + 1`, `lastActorId = actor` and
   `labelIds = reducer labelIds`. The shared reducer state is not asserted to
   contain `version` or `lastActorId` — those are server-only fields written by
   `bumpCard`.
3. Undo of a label attach/detach restores the previous `updatedAt` exactly,
   including through validation and `POST /commands`; redo advances it again by
   the command stamp.
4. A no-op label command (unknown label, or already in the requested state)
   changes neither `updatedAt` nor `version`.
5. `SET_CARD_LABEL` no longer needs the label-only branch in `board-diff` to
   detect a change; if the branch is retained for compatibility, its comment
   and test say why.
6. The audit table in §3.3 is reflected in tests or a recorded decision; every
   card-content action is either verified or explicitly deferred.
7. `DELETE_LABEL`/`RESTORE_LABEL` are either fixed with per-card timestamps
   (forward stamping all affected cards; inverse restoring each card's previous
   timestamp) and tested for exact undo, or split into a named follow-up with a
   test proving the current gap and a note in this ticket.
8. No change to label rename/color semantics, no schema change, no new required
   field and no forward-contract break for `SET_CARD_LABEL`, and no version/CAS
   regression.
9. The existing UI “Updated” surfaces show the new timestamp after a label
   change, and a second tab/focus refetch sees the change.

---

## 4. Subtasks

| ID | Title | Priority | Scope |
| --- | --- | --- | --- |
| 183.1 | Demo fixture manifest, reset and verify | P2 | Commit the TASK-176 fixture, complete mutation manifest, drop/recreate or full ordered reset, `DEMO_DATABASE_URL`/`DEMO_API_URL` binding guard, read-only verify, docs. No admin demo-runner changes. |
| 183.2 | Label timestamp consistency | P3 | Fix `SET_CARD_LABEL` reducer + inverse + `CARD_STAMPED_TYPES`, split reducer/persisted-row tests, audit same-class label writers. |

Both subtasks are independent and can ship in separate PRs. 183.1 does not
depend on 183.2.

---

## 5. Tests

### 183.1 — demo fixture

- Seed/verify unit tests (Node test runner, no database required for the
  manifest shape): manifest includes the expected card/checklist/label/link
  IDs and the column/position, priority, assignee, cover and explicit
  dueDate/spec/claim/archived fields; verifier rejects a title suffix, a
  `фывфыв` description, an unexpected checklist, an unexpected label, a
  random-UUID link and a mismatched field.
- Integration test against a disposable database: reset → verify passes; add
  a checklist **and** a card link; reset again → must succeed (no FK
  `RESTRICT` failure) and verify passes.
- Manual drift test: mutate the card title, description, checklist, label,
  links, column/position, priority, assignee and cover; verify fails; reset;
  verify passes.
- Guard test: a non-demo database name is refused before any delete; a
  `DEMO_API_URL` that is not bound to the resolved demo database is refused
  before the first delete; conflicting `DATABASE_URL`/`API_URL` values are
  refused; a direct `SEED_ALLOW=1` invocation without the demo env pair is
  refused.
- Redaction test: reset logs contain host/database only, never a username,
  password, full connection string or token.
- Verify read-only test: no email/password login and no refresh-token write;
  the verifier succeeds with Prisma reads or a pre-issued token only.
- Comment-set test: the 60 `t176-comment-*` rows are absent from the TASK-176
  fixture or match a separately declared TASK-176.9 fixture; no silent ignore.
- Idempotency: reset twice, verify both times; stable IDs/titles are identical,
  timestamps may differ.
- Documentation test/check: the documented command matches the npm script and
  the database name matches the guard.
- Regression: the pixel parity fixture still seeds by default if the TASK-176
  overlay is optional; do not break the existing `seed-agent-pixel-demo.mjs`
  entry point.

### 183.2 — label timestamp

- Shared reducer unit: `SET_CARD_LABEL` add/remove advances `updatedAt` to
  `action.at`; no-op does not; inverse uses `cardUpdatedAt`. Assert only
  `updatedAt`/`labelIds` on the shared card state.
- Shared inverse unit: undo restores the exact previous timestamp; redo applies
  the new stamp.
- `validate.test.ts`: an inverse `SET_CARD_LABEL` with `cardUpdatedAt` is
  accepted unchanged after adding the type to `CARD_STAMPED_TYPES`; a
  non-inverse command still drops it.
- Backend writer unit: `bumpCard` is called with the stamped after-state; the
  database update receives the same `updatedAt` and a single version increment.
- Persistence/integration: send the forward command **and its inverse** through
  `POST /commands`, then read the card row. Assert the persisted `updatedAt`,
  `version = previous + 1`, `lastActorId = actor` and `labelIds`; do not assert
  those server-only fields on reducer state.
- UI `board-diff`: a label-only change with a new `updatedAt` is reported by
  the timestamp fast path; the old equal-timestamp compatibility case remains
  covered if the fallback is retained.
- UI card surfaces: “Updated”/table date changes after a label toggle; second
  tab/focus refetch reflects it.
- Audit regression: the §3.3 matrix, especially checklist/link cases, remains
  green.
- If `DELETE_LABEL`/`RESTORE_LABEL` are fixed: forward stamping of every
  affected card, per-card assignment timestamps, validation of those
  timestamps and exact multi-card undo tests. If deferred: a test names the
  current gap and the follow-up.

No existing test is weakened. The `TASK-156` label-diff test is updated only
with an explicit compatibility rationale.

---

## 6. Dependencies

- **TASK-176 demo setup** — this ticket captures and cleans the fixture that
  the TASK-176 manual investigation used. The exact ad-hoc setup command is not
  committed; the ticket replaces it with a reproducible one.
- **TASK-156** — the label-only `updatedAt` workaround in `board-diff` and its
  test. The fix should leave a documented compatibility note if the fallback is
  kept.
- **TASK-150** — the focus-diff fast path that trusts `updatedAt`; the label
  fix must keep its correctness and tests.
- **TASK-21.7d** — inverse timestamp semantics (`cardUpdatedAt`,
  `boardUpdatedAt`). The label inverse must follow the same contract and pass
  `shared/src/store/validate.ts` (`CARD_STAMPED_TYPES`).
- **TASK-180.7** — demo/admin data lifecycle (H9). This ticket is about the
  developer demo fixture, not the admin demo runner. Coordinate only if a
  shared cleanup helper is introduced; do not absorb H9.
- **TASK-176.9** — explicitly separate. No card-editing UI, no admin card
  editor and no attribution work belongs here.
- **No schema or migration dependency.** The label fix is reducer/writer/test
  only; the demo fix is scripts/docs/fixture files.

---

## 7. Out of scope

- Production code or tests in this docs-only branch.
- Rewriting the admin demo runner, its manifest or its H9 cleanup semantics.
- A new destructive HTTP endpoint for demo cleanup.
- Targeted SQL cleanup of the current database instead of a deterministic
  reset.
- Changing the board command API, `Card.version` semantics, CAS or approval
  behaviour.
- Card editing, card relations, admin card UI or attribution (TASK-176.9).
- Label rename/color timestamp semantics.
- UI redesign, new navigation, new settings surfaces or any unrelated board
  work.
- Committing secrets, test tokens or a live database dump.

---

## 8. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Reset wipes the wrong database. | Explicit `DEMO_DATABASE_URL`, database-name guard, printed host/database only, `SEED_ALLOW`/`DEMO_RESET_ALLOW`, and a dry-run/verify mode. |
| The API writer points at a different database than the reset. | Require `DEMO_API_URL` with no default; refuse conflicting env; start a dedicated backend with the resolved `DATABASE_URL` or prove identity before deleting. |
| Schema reset fails because a backend is still connected. | The reset owns the dedicated backend and stops it before the drop; document that no other client may hold the demo DB. |
| The current delete sequence fails on FK `RESTRICT`. | Drop/recreate the demo schema and apply migrations; if using ordered deletes, cover `ChecklistItem`, `Checklist`, `CardLink`, `CardLabel`, shares/audit and add a reset-twice test after adding a checklist and link. |
| The intended `TASK-176 acceptance` label/checklist/links are lost by a reset. | Decide their status before resetting; commit them to the manifest if canonical. Do not run the destructive reset until that decision is recorded. |
| The `t176-comment-*` set is accidentally treated as TASK-176 canonical. | Classify it as TASK-176.9 scaffolding, remove it from the TASK-176 fixture, or declare a separate fixture; verifier checks the decision. |
| The seed is partial after an API/runtime failure. | Run the verifier after the seed; fail loudly; document “rerun reset” rather than hand-patching. |
| The seed changes the existing pixel parity fixture. | Keep the base seed output stable; make TASK-176 an explicit overlay or parameter, and test both modes. |
| Verify mutates a session or leaks a password. | Read-only Prisma verification or a pre-issued token; no email/password login and no credentials in URLs/logs. |
| The label fix breaks undo timestamps. | Add `cardUpdatedAt` to the inverse, add `SET_CARD_LABEL` to `CARD_STAMPED_TYPES`, and assert exact restore through `POST /commands`. |
| `DELETE_LABEL`/`RESTORE_LABEL` expand the change beyond a small fix. | Decide explicitly: forward stamping plus per-card assignment timestamps and validation, or a named follow-up with a regression test. |
| The `board-diff` fast path becomes incorrect or overly broad. | Update the comment/test; keep the `labelIds` fallback as a compatibility guard until all writers are verified. |
| “Updated” changes cause extra refetches or noisy UI. | Expected and correct; scope is one timestamp field, not polling or cache redesign. |
| Clock/timezone assertions are flaky. | Use the command `at` / `cardUpdatedAt` values, never wall-clock comparisons. |

---

## 9. Open questions

1. **Are the `TASK-176 acceptance` checklist, `TASK-176 demo` label and named
   `px-link-task176-*` links canonical?** They are present in the database but
   absent from every committed seed. If they are part of the intended manual
   acceptance fixture, commit them; if not, remove them. Do not reset the
   current database before this is answered.
2. **Are the assignee, cover, priority and move-to-Done changes canonical?** The
   fixture card currently has `assigneeId=px-user-admin`, yellow cover,
   `priority=blocker` and sits in `px-col-ops-done` at index 2. They are not in
   the seed. Decide yes/no for each; the manifest must pin either the observed
   value or the seed default.
3. **Are the 60 `t176-comment-*` rows part of TASK-176 or TASK-176.9?** The text
   says “TASK-176.9 demo comment”; 9 rows are soft-deleted and 51 live.
   Recommended: keep them out of the TASK-176 fixture; if pagination testing
   needs them, declare a separate TASK-176.9 fixture.
4. **One shared reset database or a template clone per session?** Recommended:
   one reset database plus `verify` for the first version; document template
   cloning for teams that need parallel manual sessions.
5. **Should `DELETE_LABEL` and `RESTORE_LABEL` be fixed in 183.2?** They share
   the timestamp gap but are multi-card. Recommended: fix them with forward
   stamping plus per-card assignment timestamps if the change stays reviewable;
   otherwise split into a named follow-up and keep the current workaround
   explicit.
6. **Should label rename/color bump affected cards?** Recommended: no. Label
   metadata changes, not card membership; the card content is unchanged. Record
   the decision in the audit table.
7. **Where should the demo docs live?** Recommended: `docs/DEMO-FIXTURES.md`
   with a short link from the pixel parity README and the TASK-176 task doc.
8. **Should `verify` run in CI?** It needs a seeded database and a running
   backend for command-transport fixtures. Recommended: run it locally before
   manual acceptance; add a CI job only if a disposable Postgres service is
   already part of the pipeline.
9. **How should the reset prove the API uses the demo database?** Recommended:
   a dedicated backend started by the reset with the same resolved
   `DATABASE_URL`. A marker row plus a dev-only identity endpoint is acceptable
   only if explicitly added and tested; do not trust a port or board title.
10. **Should the reset apply migrations?** Yes, as part of drop/recreate
    (`prisma migrate reset --force --skip-seed` on the guarded demo DB). The
    manual seed path still documents `prisma migrate deploy`; do not run
    migrations against a non-demo DB.

---

## 10. Definition of done

- The TASK-176 demo fixture is committed as stable data or a seed overlay.
- `npm run demo:task176:reset` recreates it on a correctly named disposable
  database after documented prerequisites, using one resolved DB URL, a
  verified `DEMO_API_URL` and a drop/recreate or complete transactional delete.
- Reset succeeds twice after adding a checklist and a card link; no FK
  `RESTRICT` failure.
- `npm run demo:task176:verify` passes after reset, is genuinely read-only, and
  fails on the observed artifacts (`Card claim visibility 123`, `фывфыв`,
  checklist `123`, random-UUID link) and on any undecided
  assignee/cover/priority/move value.
- Manual edits are detected and reset; the canonical fixture is not silently
  polluted. The 60 `t176-comment-*` rows are absent or declared as a separate
  TASK-176.9 fixture.
- `SET_CARD_LABEL` advances `updatedAt` and `version` consistently in the
  reducer, the persisted row and undo/redo; `SET_CARD_LABEL` is in
  `CARD_STAMPED_TYPES` and the inverse survives `POST /commands`.
- The same-class audit is complete: `DELETE_LABEL`/`RESTORE_LABEL` are fixed
  with forward stamping and per-card inverse timestamps, or explicitly deferred
  with tests and a named follow-up; label metadata actions are documented as
  intentional.
- Tests cover reducer state (`updatedAt`/`labelIds`), persisted server fields
  (`updatedAt`/`version`/`lastActorId`/`labelIds`), validation, inverse through
  `POST /commands`, reset-twice, verifier failures and the UI fast path.
- No existing expectation is weakened; docs and `CHANGELOG.md` describe the
  fixture workflow, the schema-reset requirement and the timestamp fix.
- The ticket does not touch TASK-176.9, the admin demo runner or the board
  command contract beyond the label timestamp consistency.
