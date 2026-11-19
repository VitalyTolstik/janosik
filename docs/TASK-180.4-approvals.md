# TASK-180.4 approval and Agent Control evidence

## Approval lifecycle

| Finding | Behavior | Regression evidence |
| --- | --- | --- |
| H12 | New destructive MCP calls generate fresh command IDs. The original tool can replay a command with its explicit ID and approval ID. `janosik_apply_plan` accepts the exact stored commands and hash for batches and commands with generated fields. The server returns that plan and full hash on an authorized mismatch. | A real MCP SDK client talks to Nest and PostgreSQL. It clears a column, adds a card, proves the first approval replay leaves that card in place, and clears it with a second approval. It also deletes, restores and deletes the same card. The DB records four commands and four consumed approvals. |
| H11 | An approved row keeps the original decision after the apply deadline. Explicit and automatic requests for the same plan can get a new pending row. | A PostgreSQL regression moves the old deadline into the past, expects `approval_expired`, races explicit creation against the automatic gate, and approves and consumes the replacement. The old decision remains `approved`. |
| M8 | Creation locks the open session row. Ending or revoking a session cancels its actionable approvals. The migration clears actionable rows left by previously ended sessions. | A concurrent HTTP create/end test checks that the pending queue has no row for the ended session regardless of which request wins. Existing tests exercise separate sessions on the same token and reject cross-owner apply. |

## Queue and live state

| Finding | Behavior | Regression evidence |
| --- | --- | --- |
| H10, M25, L16 | Board Inbox pages the pending and decided queues independently using `/agents/overview`. The headline uses the pending page's server total. A failed recent read leaves pending usable. The queue polls for TTL changes. A mobile deep link opens the detail by ID and focuses Back. Quick reject focuses the reason field. | PostgreSQL seeds 101 pending and 105 decided rows and pages all 206 exactly once in pending-first order. The board UI loads all 250 pending rows across two cursors while the recent request fails. Focused tests cover TTL, older deep links and mobile quick-reject focus. |
| M24, L17 | Global Attention sends board, token, search and approval status filters to the server. It displays matching counts and follows a cursor even for an empty loaded page. Scope totals remain available to the rail. Archived boards stay outside the console scope. | The seeded database search finds a pending row beyond an unfiltered 100-row page. UI tests check search parameters, exact 150-row counts and the empty-page cursor. |
| M26 | Detail polls update the mounted view, including its rejection draft and focus. The global stream publishes approval frames to the detail store. Decisions update a polite live region and the mobile detail stays open. | A fake-clock UI test holds a 30-second refresh in flight and verifies the draft, focused textarea and rendered plan. Another test sends a split SSE frame through the production parser and observes the external rejection close the decision controls. |
| M27, M28 | Explicit and write-triggered heartbeats share a persisted publication timestamp. Each successful write checks the publication window independently of the liveness stamp. Board Live coalesces agent events and uses polling as a fallback. Approval and run counts refresh only for the corresponding events. Paused sessions stay out of the stale-session prompt. | Unit tests exercise heartbeats at 0, 30 and 61 seconds. A connected HTTP SSE consumer verifies explicit and write-triggered frames, including a write with an overdue publication and a fresh liveness stamp. Existing focused tests cover pause state and stale classification. |
| L39 | Conflict counts are keyed to the run-list revision and preview window. Previous counts stay visible while a refresh is pending. A failed refresh clears the count, and stale responses cannot restore it. | Deferred-response UI tests cover revision changes, failures and a late superseded success. |

The live MCP regression runs in `backend/test/agent-sessions.e2e-spec.ts`
through `mcp/test/live-approval.mjs`. The Nest e2e runner uses the configured
PostgreSQL test database and applies the Prisma migration before running the
approval, overview, session and security suites.

Backend, shared, MCP and UI type checks passed. Review verification passed
all 1,813 UI tests, 51 targeted backend unit tests, 68 targeted backend e2e
tests and 155 MCP tests. One MCP test was skipped by the suite. ESLint
completed with zero errors. Prettier, `git diff --check`, Prisma validation,
OpenAPI validation and its five validator tests passed. The REST guides were
updated in English and Russian.

Cursor pages are live reads. An approval decided between requests can move
between groups, and the next refresh reconciles the queue.

- Global Attention opens approval SSE streams for the first four boards and
  adds the board in scope or the board of the selected approval when needed.
  While visible, queues and details on other boards refresh on the 30-second
  poll.
- Password resets, password changes and OAuth account takeovers cancel
  actionable approvals for revoked tokens in the credential transaction.
  Their cancellation may appear in the browser on the next 30-second poll.
- A consumed lifecycle-operation plan, such as `member.remove`, still blocks
  a fresh request for the identical plan in the same token and session scope.
  Lifecycle plans have no per-invocation nonce.
- When a pending approval reaches its TTL, the Board Inbox header count
  updates on the next 30-second poll while visible.

Prisma applies the new `(boardId, agentSessionId, status)` approval index before
the cleanup on fresh databases. Databases that already ran the cleanup can
apply the pending index migration with the existing migration history.
The full Docker and browser matrix was outside this validation.
