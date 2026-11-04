# Task recipes

Use actual board columns and available tools. These sequences are for task
execution; a simple edit or status report does not require the full lifecycle.

## Execute a feature

1. Find the board, read its snapshot and target card, comments and activity.
   For unassigned work use `janosik_list_ready_cards` or `janosik_wait_for_work`,
   then read the candidate. Discovery does not reserve it.
2. Claim with `janosik_claim_card`, respecting existing assignments and leases.
   Self-assign only if appropriate and you know your real user id. The optional
   account/member tools need not be available for claiming.
3. Fill missing context and criteria, preserve existing useful content, add
   checklists as needed, move to the work column and comment pickup with
   `kind: "status"`.
4. Execute and verify meaningful steps, tick their checklist items and report
   progress or changed assumptions. Renew the lease before expiry.
5. Post actual verification results with `kind: "evidence"`. If review is part
   of this board's process, move to Review, post `kind: "handoff"` with checks
   for the reviewer and release your lease. Handle the assignee according to
   board convention; release alone does not unassign.
6. Complete only when the criteria hold and required review is satisfied. The
   last-column MCP check does not verify the actual result. Release any remaining
   own lease.

## Review a card

1. Read the card, contract, comments and activity. Inspect the result independently
   where possible; an evidence comment's existence is not proof of correctness.
2. For a report-only review, return findings without modifying the board.
3. If asked to conduct the board review and update it, claim before changing
   task state, respecting another user's live claim and existing assignment.
4. On success, post what you verified with `kind: "evidence"` and move to the
   completion column if authorized by the task and board workflow.
5. On failure, post actionable findings, add remaining fix items, and return
   the card to an appropriate work state. Release your lease at handoff.

## Report a defect

1. Record reproduction, expected/actual results, environment and evidence with
   `kind: "blocker"` when it prevents completing this task.
2. For an in-scope failure, add or update the fix checklist item and move back
   to Bugs, In Progress (fixing now) or Backlog (needs scheduling).
3. For an independent defect, create a separate card with reproduction and a
   contract. Link it once: `relates_to` for context, or source bug → target
   dependent card with `blocks` when it truly prevents completion. Do not create
   reciprocal blocking links. Comment on affected cards as useful.
4. Tick the fix item after verification; post fresh evidence before closing.

## Hand off a blocker

1. Post `kind: "blocker"`: what cannot proceed, what is needed, and who or what
   can resolve it. Link an actual dependency in the correct direction.
2. Use the existing Blocked column or label if appropriate. If neither exists,
   record the blocker without inventing board structure.
3. Release your lease when stopping. Do not clear someone else's assignment.
   If returning your task to an unassigned queue is intended, explicitly unassign
   it; otherwise it stays absent from ready-card discovery.
4. Once resolved, read current state, reclaim if executing, record resolution
   and resume in the appropriate work column.

## Report status

Read the board, cards, relevant comments and activity; use `janosik_search_cards`
to narrow the set. Distinguish completion, blockers and unverified claims.
Do not claim, assign, comment or move cards just to produce a report.

## Archive and restore

1. Read the targets and establish which content the cleanup request covers.
2. Use `janosik_archive_card`, `janosik_clear_column` to archive a column's cards,
   or `janosik_archive_board` to remove a board from active work.
3. Find archived cards with `janosik_get_board`, `include_archived: true`.
   They are board-wide even when `columnId` filters the active cards.
4. Use the corresponding unarchive tool and its schema for restoration options.
   Read the resulting board to verify placement. Use deletion when removal
   itself is intended, accounting for a column's contained cards.
