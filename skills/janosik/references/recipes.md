# Recipes

The lifecycle, tool by tool. The tool names are the real `janosik_*` MCP tools;
nothing here duplicates the API — the tools own the transport, this owns the
order and the intent.

## Recipe: claim a card (and what to do when it is refused)

Claiming is the first write of any work, so it gets its own recipe.

1. **Look before you lock.** `janosik_get_card` — read `claimedBy` and
   `leaseUntil`. A live claim (lease still in the future) means someone else is on
   it.
2. **Claim.** `janosik_claim_card` (default 15 min; `leaseMs` for a longer task,
   clamped to 1 min–24 h). On success, comment `Claimed until <time>` with
   `kind="status"`.
3. **Refused?** Another member holds it. Do not work the card: either
   `janosik_add_comment` a `kind="question"` comment naming the holder and pick a
   different card, or wait for the lease to lapse — it self-expires, so a dead
   agent never blocks the board.
4. **Renew a long task.** Re-run `janosik_claim_card` before the lease runs out,
   and comment that you renewed.
5. **Release when done.** `janosik_release_card` when you finish or hand the card
   off. If you forget, the lease lapses on its own.

## Recipe: complete a feature card

1. **Orient.** `janosik_list_boards` → `janosik_get_board` (note the column
   names and your role, and the board `seq`) → `janosik_get_card` for the target
   card → `janosik_list_comments` and `janosik_card_activity` for its story so
   far. If you have no target card, `janosik_list_ready_cards` lists what is
   unassigned, unclaimed and unblocked; `janosik_wait_for_work` blocks until one
   appears.
2. **Claim it.** `janosik_claim_card` (default 15 min; pass `leaseMs` for longer)
   — refused if another member holds a live lease, in which case follow the claim
   recipe. Then `janosik_whoami` for your id → `janosik_set_card_assignee` →
   `janosik_move_card` to **In Progress** → `janosik_add_comment` "Picking this
   up."
3. **Flesh it out.** `janosik_update_card` (description with the why) →
   `janosik_set_card_task_spec` (`acceptanceCriteria` and `definitionOfDone`) →
   `janosik_add_checklist` → `janosik_add_checklist_item` per step →
   `janosik_set_card_priority` / `janosik_set_card_label` /
   `janosik_set_card_due_date` as the board uses them.
4. **Do the work, out loud.** After each step: `janosik_set_checklist_item_done`
   for the step you finished and `janosik_add_comment` for what changed and what
   is next. New subtasks you discover: `janosik_add_checklist_item`.
5. **Dependencies.** If this card blocks or is blocked by another:
   `janosik_add_card_link`.
6. **Finish.** When every item is ticked or explained: `janosik_add_comment`
   with the result and its proof (`kind="evidence"`) → `janosik_move_card` to
   **Review**. Moving into the board's last (Done) column is refused while the
   `Definition of Done` has unticked items or there is no `evidence` comment.
7. **Close.** Only after verification (your test, or a human's approval):
   `janosik_move_card` to **Done** → `janosik_release_card` so the next agent can
   take it. If it turns out to be wrong here, jump to the bug recipe.

## Recipe: a bug turned up on a card

Use this whether you found the bug while working the card or while reviewing
someone else's.

1. **Do not move it to Done.** Leave the card where it is for now.
2. **Capture the defect.** `janosik_add_comment` with the bug-found shape from
   [templates.md](templates.md): reproduce, expected, actual, tried.
3. **Make the remaining work visible.** `janosik_add_checklist_item` for the fix
   (or `janosik_rename_checklist_item` if it reframes an existing one).
4. **Move the card back.** `janosik_move_card` to **Bugs** if the board has it,
   else to **In Progress** (fixing now) or **Backlog** (needs scheduling). The
   backward move is the record — do not skip it.
5. **Link the damage.** If the bug surfaced in another card, link them:
   `janosik_add_card_link` (`blocks` when this defect blocks that card).
6. **Out of scope?** Open a fresh card: `janosik_create_card` → fill it (see the
   feature recipe steps 3–4) → `janosik_add_card_link` both ways → comment on
   both that one spawned the other.
7. **Fix and re-verify.** Tick the fix item only when a test or a human confirms
   it, comment the evidence, then move the card forward again.

The whole point: a reader can see the card went **forward, back, and forward
again**, with a comment explaining each turn. That is a history you can trust.

## Recipe: run a review

1. `janosik_get_card` and `janosik_card_activity` — understand what the card
   claims and who did it; a `claimedBy` whose lease has lapsed is stale, not a
   lock.
2. Check what the card asserts against the evidence in the comments. "Done" with
   no test/link/number is not done.
3. Verify independently where you can — run the test, hit the endpoint, read the
   diff.
4. **Passed?** `janosik_add_comment` approving, naming what you checked →
   `janosik_move_card` to **Done**.
5. **Failed?** Follow the bug recipe: comment the defect, add the checklist
   item, move the card back. Never approve to be nice.

## Recipe: report a blocker

1. `janosik_add_comment` with the blocked shape: what is blocked, what it needs,
   who or what can unblock it.
2. `janosik_move_card` to **Blocked** (or comment the blocker if the board has
   no such column and leave it In Progress).
3. If the blocker is another card or an external dependency,
   `janosik_add_card_link` so the relationship is visible.
4. When it clears: comment that it is unblocked, move the card back to **In
   Progress**.

## Recipe: report status without changing a card

If you were only asked for a status, do not write anything — read and report:

1. `janosik_list_boards` → `janosik_get_board`.
2. For the cards in question: `janosik_get_card`, `janosik_list_comments`,
   `janosik_card_activity`.
3. `janosik_search_cards` to find cards by text, label, assignee or priority
   across a board (or every board you can see).

Reading is always safe and leaves no trace; that is the point.
