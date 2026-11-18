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
   named TASK-176 links that are not in any committed seed. The board aggregate
   still loads and the API accepts it, so this is **not corruption**; it is an
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
| Board aggregate | 200, six live cards, four columns, one label | Same shape after the seed's reverted delete |

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

### 2.2 Root-cause research

**The only committed seed is the pixel demo seed.**

`scripts/seed-agent-pixel-demo.mjs`:

- refuses to run without `SEED_ALLOW=1` (`:39-42`);
- deletes the demo tables before recreating rows (from `commandPreimage`
  through `user`);
- creates fixed IDs for two boards, eight columns and twelve card rows (one
  later soft-deleted by a reverting run);
- creates board `px-board-agent-ops` and card `px-card-card-claim` with
  `title: "Card claim visibility"` (`:341-346`);
- creates the canonical description through the real command transport in
  `seed-run-126` (`UPDATE_CARD` on `ids.cardClaim`);
- creates no card checklists, labels or card links;
- writes runs, approvals, sessions and a JSON summary to stdout.

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

Therefore the `TASK-176 acceptance` checklist was added by hand or by an
untracked script. Re-running the committed seed would delete it along with the
junk, which means the current reset path is either unsafe (loses intended
fixture) or nonexistent.

**The admin demo runner is a different system.**

`backend/src/admin/demo.service.ts` is the TASK-57/TASK-69 admin demo: it
creates a manifest and cleans up exactly the rows it created. It is not the
manual TASK-176 database and must not be repurposed for this fixture.
TASK-180.7 owns the admin demo runner's data-lifecycle bugs (including H9);
this ticket must coordinate with it if a shared helper is introduced, but must
not change the runner's semantics.

### 2.3 Proposed cleanup/reset path

**Recommended: commit the fixture, add an explicit reset/verify command, and
never rely on manual SQL.**

1. **Commit the canonical TASK-176 fixture.** Decide whether the
   `TASK-176 acceptance` checklist, the `TASK-176 demo` label and the named
   `px-link-task176-*` links are intended. If yes, add them to a committed
   fixture manifest and seed them deterministically. If no, remove them from
   the canonical fixture and document that they were manual scaffolding. Do not
   reset the current database before that decision.

2. **Add a fixture manifest.** A small `scripts/fixtures/task176-demo.json` (or
   an exported object module) lists the stable fixture contract:
   board IDs/titles, column IDs/titles, card IDs/titles, the canonical
   description, intended label IDs/names, checklist IDs/titles/items, card-link
   IDs/types/targets and expected counts. Seed and verify both read the same
   manifest so they cannot drift.

3. **Add a reset command.** Example:
   `npm run demo:task176:reset`. It should:
   - require an explicit `DEMO_DATABASE_URL` (or `DATABASE_URL`) and print the
     target database;
   - refuse to run unless the database name matches the documented demo name
     (for example exactly `janosik_task176_demo`, or a `*_demo` pattern plus an
     explicit allow flag);
   - require `SEED_ALLOW=1` or a new `DEMO_RESET_ALLOW=1`;
   - run the seed (or a TASK-176 overlay on the pixel seed) and then the
     verifier;
   - exit non-zero on any mismatch, leaving the operator with a clear message
     that the database is partial and the reset must be rerun.

   The existing seed already deletes and recreates rows, so a wrapper is enough
   for the first version. Do not add a destructive HTTP endpoint.

4. **Add a verify command.** Example:
   `npm run demo:task176:verify`. It must be read-only and assert the manifest
   against the live database:
   - `px-card-card-claim.title === "Card claim visibility"`;
   - the canonical description is exact (no `фывфыв` suffix);
   - the checklist set is exactly the expected set (no `123`/`1`);
   - the label set and card-link set match the manifest (no random-UUID link,
     no missing `TASK-176 demo` label or named TASK-176 links);
   - expected boards/columns/cards/checklists/labels/links exist;
   - no unexpected card title, description, checklist, label or link on the
     fixture card.

   The verifier should ignore timestamps and other volatile fields. It may use
   Prisma directly for stable fields, then optionally perform one authenticated
   API read to prove the aggregate is readable.

5. **Document the workflow.** Add a short `docs/DEMO-FIXTURES.md` (or a section
   in the existing pixel parity README) with:
   - the database name and environment variables;
   - the reset command and its destructive nature;
   - the verify command;
   - the rule that the canonical demo is reset-only and manual experiments use
     a cloned database or a separate board;
   - the prerequisite `npx prisma migrate deploy -w backend` and a running
     backend for the command-transport part of the seed;
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

### 2.4 Acceptance criteria — demo hygiene

1. A fresh developer can recreate the TASK-176 demo database from committed
   source with one documented command after the documented prerequisites.
2. The seed produces stable IDs and exact stable values: board titles, column
   titles, card titles, the `px-card-card-claim` description, and the intended
   label, checklist and card-link sets (including `TASK-176 demo`,
   `TASK-176 acceptance` and the named `px-link-task176-*` links if they are
   confirmed as canonical).
3. Re-running the reset is idempotent for stable values; timestamps and
   generated runtime metadata may differ.
4. The reset refuses a database whose name is not the documented demo database
   (or an explicitly allowed `*_demo` name) and prints the target before
   deleting anything.
5. `demo:task176:verify` passes immediately after reset.
6. `demo:task176:verify` fails on the observed artifacts:
   `Card claim visibility 123`, a description containing `фывфыв`, a checklist
   titled `123` with item `1`, and the random-UUID card link.
7. A manual edit followed by a reset restores the canonical fixture, and the
   verifier passes again.
8. The TASK-176 label, acceptance checklist and named links, if intended, are
   created by the seed and are not lost by a reset; if any is not intended, it
   is removed from the canonical fixture and the docs say so.
9. No admin demo-runner code, production database or non-demo developer
   database is touched.
10. The docs state that the canonical fixture is reset-only; manual edits go to
    a scratch clone or a separate board.

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

**The UI already works around it.** `ui/src/store/board-diff.ts:58-70` compares
`labelIds` explicitly because label-only changes can have the same
`updatedAt`; `ui/src/store/board-diff.test.ts:123` codifies that behaviour as
“reports a label-only card change with an equal `updatedAt` (TASK-156)”. That
workaround is evidence the gap was known; it does not make the timestamp
correct.

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
Fixing it needs a per-card timestamp in the inverse. `RestoreLabelAction`’s
`assignments` currently carries only `{ cardId, index }`; the clean fix is to
add the previous `updatedAt` per assignment and have the reducer use it on
restore, while the writer calls `bumpCard` for every affected card. If that is
too large for this ticket, the implementation must record an explicit
follow-up and keep the current UI workaround; it must not silently leave the
invariant half-fixed.

### 3.4 Proposed fix

**Primary, required:**

1. In `setCardLabel`, stamp the next card with `updatedAt: cardStamp(action)`.
   This is the same helper used by the other card-content actions and respects
   inverse `cardUpdatedAt`.
2. In `invert` for `SET_CARD_LABEL`, add
   `cardUpdatedAt: card.updatedAt` so undo restores the pre-change timestamp.
3. Keep `bumpCard` as-is for `SET_CARD_LABEL`; it will now persist the new
   stamp and increment version exactly once.
4. Update the `board-diff` comment and the “equal `updatedAt`” test to describe
   the new contract. Retaining the `labelIds` comparison is acceptable as a
   defensive compatibility check for rows written by older servers; it should
   no longer be the only way a label-only change is detected.
5. Add a regression that asserts both the reducer after-state and the persisted
   database row, including the inverse.

**Same-class decision:**

6. Fix `DELETE_LABEL` and `RESTORE_LABEL` in the same PR if the per-card
   timestamp can be added to `assignments` without a command-contract break.
   If not, split them into a named follow-up with this ticket as the reference,
   add tests for the current gap, and document the temporary inconsistency.
   Do not change `RENAME_LABEL`/`SET_LABEL_COLOR` card timestamps.

### 3.5 Acceptance criteria — label timestamp

1. Attaching or detaching a label sets `Card.updatedAt` to the command's card
   stamp (`action.at`, or the inverse `cardUpdatedAt`) and increments
   `version` exactly once.
2. The database row after the command equals the reducer's after-state for
   `updatedAt`, `version`, `lastActorId` and `labelIds`.
3. Undo of a label attach/detach restores the previous `updatedAt` exactly; redo
   advances it again by the command stamp.
4. A no-op label command (unknown label, or already in the requested state)
   changes neither `updatedAt` nor `version`.
5. `SET_CARD_LABEL` no longer needs the label-only branch in `board-diff` to
   detect a change; if the branch is retained for compatibility, its comment
   and test say why.
6. The audit table in §3.3 is reflected in tests or a recorded decision; every
   card-content action is either verified or explicitly deferred.
7. `DELETE_LABEL`/`RESTORE_LABEL` are either fixed with per-card timestamps and
   tested for exact undo, or split into a named follow-up with a test proving
   the current gap and a note in this ticket.
8. No change to label rename/color semantics, no schema change, no command
   payload change for `SET_CARD_LABEL`, and no version/CAS regression.
9. The existing UI “Updated” surfaces show the new timestamp after a label
   change, and a second tab/focus refetch sees the change.

---

## 4. Subtasks

| ID | Title | Priority | Scope |
| --- | --- | --- | --- |
| 183.1 | Demo fixture manifest, reset and verify | P2 | Commit the TASK-176 fixture, add reset/verify commands, DB-name guard, docs. No admin demo-runner changes. |
| 183.2 | Label timestamp consistency | P3 | Fix `SET_CARD_LABEL` reducer + inverse, add persisted-row tests, audit same-class label writers. |

Both subtasks are independent and can ship in separate PRs. 183.1 does not
depend on 183.2.

---

## 5. Tests

### 183.1 — demo fixture

- Seed/verify unit tests (Node test runner, no database required for the
  manifest shape): manifest includes the expected card/checklist/label/link
  IDs; verifier rejects a title suffix, a `фывфыв` description, an unexpected
  checklist, an unexpected label and a random-UUID link.
- Integration test against a disposable database: reset → verify passes;
  mutate the card title, description, checklist, label and links; verify fails;
  reset; verify passes.
- Guard test: a non-demo database name is refused before any delete.
- Idempotency: reset twice, verify both times; stable IDs/titles are identical,
  timestamps may differ.
- Documentation test/check: the documented command matches the npm script and
  the database name matches the guard.
- Regression: the pixel parity fixture still seeds by default if the TASK-176
  overlay is optional; do not break the existing `seed-agent-pixel-demo.mjs`
  entry point.

### 183.2 — label timestamp

- Shared reducer unit: `SET_CARD_LABEL` add/remove advances `updatedAt` to
  `action.at`; no-op does not; inverse uses `cardUpdatedAt`.
- Shared inverse unit: undo restores the exact previous timestamp; redo applies
  the new stamp.
- Backend writer unit: `bumpCard` is called with the stamped after-state; the
  database update receives the same `updatedAt` and a single version increment.
- Persistence/integration: send the command through the command service and
  read the card row; assert timestamp/version/lastActor.
- UI `board-diff`: a label-only change with a new `updatedAt` is reported by
  the fast path; the old equal-timestamp compatibility case remains covered if
  the fallback is retained.
- UI card surfaces: “Updated”/table date changes after a label toggle; second
  tab/focus refetch reflects it.
- Audit regression: the §3.3 matrix, especially checklist/link cases, remains
  green.
- If `DELETE_LABEL`/`RESTORE_LABEL` are fixed: multi-card timestamp and exact
  undo tests. If deferred: a test names the current gap and the follow-up.

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
  `boardUpdatedAt`). The label inverse must follow the same contract.
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
| Reset wipes the wrong database. | Explicit `DEMO_DATABASE_URL`, database-name guard, printed target, `SEED_ALLOW`/`DEMO_RESET_ALLOW`, and a dry-run/verify mode. |
| The intended `TASK-176 acceptance` checklist is lost by a reset. | Decide its status before resetting; commit it to the manifest if canonical. Do not run the destructive seed until that decision is recorded. |
| The seed is partial after an API/runtime failure. | Run the verifier after the seed; fail loudly; document “rerun reset” rather than hand-patching. |
| The seed changes the existing pixel parity fixture. | Keep the base seed output stable; make TASK-176 an explicit overlay or parameter, and test both modes. |
| The label fix breaks undo timestamps. | Add `cardUpdatedAt` to the inverse and assert exact restore; keep the existing inverse tests green. |
| `DELETE_LABEL`/`RESTORE_LABEL` expand the change beyond a small fix. | Decide explicitly: per-card assignment timestamps in the same PR, or a named follow-up with a regression test. |
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
2. **One shared reset database or a template clone per session?** Recommended:
   one reset database plus `verify` for the first version; document template
   cloning for teams that need parallel manual sessions.
3. **Should `DELETE_LABEL` and `RESTORE_LABEL` be fixed in 183.2?** They share
   the timestamp gap but are multi-card. Recommended: fix them with per-card
   assignment timestamps if the change stays reviewable; otherwise split into a
   named follow-up and keep the current workaround explicit.
4. **Should label rename/color bump affected cards?** Recommended: no. Label
   metadata changes, not card membership; the card content is unchanged. Record
   the decision in the audit table.
5. **Where should the demo docs live?** Recommended: `docs/DEMO-FIXTURES.md`
   with a short link from the pixel parity README and the TASK-176 task doc.
6. **Should `verify` run in CI?** It needs a seeded database and a running
   backend for command-transport fixtures. Recommended: run it locally before
   manual acceptance; add a CI job only if a disposable Postgres service is
   already part of the pipeline.
7. **Should the reset use `prisma migrate deploy` automatically?** Recommended:
   no implicit migration in the seed wrapper; document the prerequisite and
   print a clear error if the schema is missing. This keeps the destructive
   action separate from schema changes.

---

## 10. Definition of done

- The TASK-176 demo fixture is committed as stable data or a seed overlay.
- `npm run demo:task176:reset` recreates it on a correctly named disposable
  database after documented prerequisites.
- `npm run demo:task176:verify` passes after reset and fails on the three
  observed artifacts (`Card claim visibility 123`, `фывфыв`, checklist `123`).
- Manual edits are detected and reset; the canonical fixture is not silently
  polluted.
- `SET_CARD_LABEL` advances `Card.updatedAt` and `version` consistently in the
  reducer, the persisted row and undo/redo.
- The same-class audit is complete: `DELETE_LABEL`/`RESTORE_LABEL` are fixed or
  explicitly deferred with tests and a named follow-up; label metadata actions
  are documented as intentional.
- Tests cover reducer, inverse, writer persistence and the UI fast path; no
  existing expectation is weakened.
- The ticket does not touch TASK-176.9, the admin demo runner or the board
  command contract.
- Docs and CHANGELOG describe the fixture workflow and the timestamp fix.
