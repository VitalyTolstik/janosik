# Recipes

The lifecycle, tool by tool. The tool names are the real `janosik_*` MCP tools;
nothing here duplicates the API — the tools own the transport, this owns the
order and the intent.

## Recipe: complete a feature card

1. **Orient.** `janosik_list_boards` → `janosik_get_board` (note the column
   names and your role) → `janosik_get_card` for the target card →
   `janosik_list_comments` and `janosik_card_activity` for its story so far.
2. **Claim it.** `janosik_whoami` for your id → `janosik_set_card_assignee` →
   `janosik_move_card` to **In Progress** → `janosik_add_comment` "Picking this
   up."
3. **Flesh it out.** `janosik_update_card` (description with the why and
   acceptance criteria) → `janosik_add_checklist` →
   `janosik_add_checklist_item` per step → `janosik_set_card_priority` /
   `janosik_set_card_label` / `janosik_set_card_due_date` as the board uses them.
4. **Do the work, out loud.** After each step: `janosik_set_checklist_item_done`
   for the step you finished and `janosik_add_comment` for what changed and what
   is next. New subtasks you discover: `janosik_add_checklist_item`.
5. **Dependencies.** If this card blocks or is blocked by another:
   `janosik_add_card_link`.
6. **Finish.** When every item is ticked or explained:
   `janosik_add_comment` with the **Result** and its evidence →
   `janosik_move_card` to **Review**.
7. **Close.** Only after verification (your test, or a human's approval):
   `janosik_move_card` to **Done**. If it turns out to be wrong here, jump to
   the bug recipe.

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

1. `janosik_get_card` and `janosik_card_activity` — understand what was claimed
   and by whom.
2. Check the claim against the evidence in the comments. "Done" with no
   test/link/number is not done.
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
