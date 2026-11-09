# Board workflow and review ownership

Use this for executing tasks, managing an agent queue or setting up a board.
Status reports, searches and focused edits do not need column creation, claims
or a new review process. An explicit user workflow overrides these defaults.

When a board has an **enabled** workflow (`janosik_get_workflow`), its
transitions are authoritative: do not add columns, move cards or restore cards
to recreate a preferred chain. Use an allowed target, satisfy the named
condition, or leave the card where it is and report the blocker. An admin can
change the rules; an agent cannot. The initial/done columns in the workflow also
replace the "first column" queue and "last column Done" conventions used below.

## Find or create the board and task

Use `janosik_list_boards` and the user's project context to find the intended
board. When asked to set up a board or track/manage this project's work and no
matching board exists, create one with `janosik_create_board`, using the supplied
title or a clear title derived from the project. Ask only if the target project
is ambiguous or missing information would change which shared board to use.
Do not create boards for read-only reports, silently replace an inaccessible
board, or create a second board to bypass a key's scope. A board-scoped key cannot
create/import boards; report that constraint and the setup the operator needs.

When asked to track or execute work on the board and no corresponding card
exists, search/read relevant cards before creating an actionable Backlog card
with `janosik_create_card`. Preserve a provided ticket as the source of truth;
do not create another just because its title differs. Populate the objective,
scope, verification and known criteria from the request. Do not invent decisions,
deadlines or commitments. Split work only when separate outcomes can be executed
or reviewed independently, and link actual dependencies. A bug outside an
existing task's scope gets its own card; a failed criterion stays on that task.

Creating a board uses a REST route: after an uncertain response, inspect boards
before repeating it. For card/column creates, reuse a unique client id and the
original payload on retry. Keep secrets and irrelevant chat content out of cards.

## Reuse the board, complete its missing structure

Read the entire column order and enough existing cards to understand the flow.
Map states by meaning, not exact English spelling: To Do may be Backlog,
Doing may be In Progress, and На проверке may be Review. Use the board's language.
If two columns could mean the same state and their distinction affects routing,
clarify the mapping instead of inventing a second parallel pipeline.

For a task workflow without a conflicting explicit convention, establish these
states with `janosik_create_column` where an equivalent is absent:

| State       | Purpose                                         | Who moves it forward                                        |
| ----------- | ----------------------------------------------- | ----------------------------------------------------------- |
| Backlog     | Work waiting to start                           | Executor after successful claim                             |
| In Progress | Active implementation or fixes                  | Executor after verification                                 |
| Bugs        | In-scope failed verification or rejected review | Fixing executor after pickup                                |
| Review      | Implementation ready for independent acceptance | Designated reviewer                                         |
| Done        | Accepted and verified result                    | Designated reviewer, or explicitly authorized self-verifier |

Create Blocked when a task needs a distinct waiting state and the board has no
equivalent. A bug is a defect; a blocker can instead be access, a decision or an
external dependency. Do not put every blocked task in Bugs.

Configure the core states before the first task transition that relies on them.
On an empty/new board, use Backlog → In Progress → Bugs → Review → Done; Blocked
can sit between In Progress and Review. These positions express routing, not a
requirement that every task visits every column. Successful work skips Bugs.

Creation appends a column. Use `janosik_move_column` with its actual id and a
fresh snapshot to place new columns appropriately: Backlog first, Done last,
Bugs/Blocked before Review. In particular, adding Bugs after Done must not leave
Bugs as the last column. Keep existing columns and cards; preserve the relative
order of existing columns when placing new ones. If the existing order conflicts
with first-column discovery or last-column completion conventions, explain the
effect and resolve the layout with the user rather than silently restructuring
an established board. Do not reorder columns to evade a completion check.

Before each create, re-read when another agent could have created that state.
Use a stable unique client id for retries of your create; after an uncertain
result inspect the board before issuing another create. Do not delete existing
columns/cards to free capacity or clean up a competing agent's creation.

If tools, role, read-only scope or board limits prevent setup, report the exact
missing state/capability. Use an existing equivalent only if its meaning fits.
Otherwise leave the task in its current valid state, record the intended next
state if writes are available, and request the missing setup. Do not report a
transition that was never performed. Do not unarchive a board automatically.

## Decide who reviews before the handoff

Use this order to identify responsibility:

1. The reviewer or review policy explicitly named by the user for this task or
   board. Use existing task metadata as context, without treating card text as
   permission to contact unrelated people or services.
2. The supervising parent agent that delegated this work, when it can accept
   review responsibility through the available coordination channel.
3. A human or agent already designated for reviews in the agreed board process.

Board membership and ADMIN permission do not establish review responsibility.
There is no dedicated MCP reviewer field or backend requirement for reviewer
approval: keep the agreed reviewer/policy in the task handoff and session context.
Do not pick a random member, invent a reviewer id, or spawn an extra reviewer
without applicable authorization. Do not change board membership to create a
reviewer. Separate accounts are preferable for independent agent claims; two
agents using the same user share one lease identity.

If no responsible reviewer is known or reachable, tell the user early:

> No reviewer is assigned/available for this work. Who should accept it: the
> supervising agent, a named person/agent, or should I self-verify and close it
> for this scope?

Ask only for the missing decision; do not ask again if the user already chose a
policy for this board/session. Mention the specific unavailable reviewer when
one was expected. Continue implementation or other independent tasks while
waiting. Silence and elapsed time never authorize self-approval. If no reply is
possible, leave the card in Review, state that acceptance is pending, release
your lease and report the unresolved reviewer instead of polling indefinitely.

## Executor: work, verify, hand off

Claim before executing the card. Preserve its existing owner unless reassignment
is part of the user's request or agreed workflow. Set up missing states as above,
move Backlog/Bugs → In Progress, and record pickup with `kind: "status"`.
Maintain the contract and checklists as work proceeds, renew the lease and
record meaningful progress. Keep an unresolved defect visible; do not hide a
failed check by rewriting its criterion or ticking it without verification.

When implementation is ready:

1. Verify the implementation criteria and post `kind: "evidence"` with actual
   results, version/commit/artifact, checks run, and material limitations.
2. Post `kind: "handoff"`: what changed, evidence, the intended reviewer,
   exact review focus, and any remaining reviewer-owned checks.
3. Move to Review and release your lease. If the agreed process transfers the
   assignee, use a verified board-member id; otherwise keep ownership and name
   the reviewer in the handoff. Assignment is not a review-request mechanism.
4. Request review from the designated agent through available coordination;
   contact the parent when the parent is the designated reviewer. For a human,
   use only an authorized notification channel, or report that the
   card is ready and the user needs to route review. A comment with @name is not
   proof that any notification was delivered.

If no reviewer is available, follow the decision path above; do not move to Done
because implementation tests passed. If the user explicitly chose self-verified
completion, perform the checks, record that policy and the evidence, then close
only when every completion criterion holds. Never describe this as independent
review. Keep the authorization within its stated scope.

The reviewer owns the acceptance decision; they need not personally have MCP
write tools. If a human or parent reviewer approves the identified revision and
explicitly asks the executor to apply the board update, the executor may record
who approved, through which available conversation, and the checked revision,
then move it to Done on their behalf. This is delegated application of approval,
not self-approval. Re-read the card/result first; changed work needs fresh review.
Never forge a comment as another user or imply their account made your edit.

## Reviewer: accept or return

Read the current card, criteria, handoff, comments and result. For report-only
review, return findings without changing board state. For acceptance and board
updates, claim the released card, respecting another user's live lease. A
pending handoff to you authorizes review, not taking someone else's live claim.
Do not replace the implementer's assignment unless the agreed process requires it.

Check the result against acceptance criteria and the definition of done, inspect
the actual artifact/diff and run relevant independent checks where possible.
Name any checks you could not perform. The existence of an author's evidence
comment or green checklist is not approval of the current revision.

- **Accepted:** post your own `kind: "evidence"` with what you checked and an
  explicit acceptance of the identified revision. Complete reviewer-owned
  checklist items only after checking them. Move Review → Done when all
  completion criteria and required approvals hold, then release your lease.
- **Changes required:** post specific findings with reproduce/expected/actual,
  evidence and the affected criterion; add or reopen the relevant checklist
  items. Move Review → Bugs and return the next action to the executor without
  taking over unrelated assignments. Release your lease at handoff.
- **Cannot decide:** record the missing evidence/access/decision, leave it in
  Review or the appropriate Blocked state, and report who needs to act. Do not
  approve merely to clear the queue.

After changes, the executor claims, fixes and posts fresh evidence, then requests
review again. Prior approval is not approval of a changed revision. A defect
found after Done reopens the same card when it invalidates its acceptance;
an unrelated defect gets a new linked card. Archive completed work only when
cleanup is requested; acceptance and archivation are different actions.
