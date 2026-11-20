# TASK-180 — Bug-research remediation

**Status:** shipped (2026-11-20). TASK-180.1 through TASK-180.9 merged into `main`
as `eaf0f0ca`, `242bc789`, `94aae494`, `e0d2e3bb`, `68ee42ee`, `244d0cec`,
`bed2f350`, `d8f26007` and `c70b93e7`.

**Priority:** P0/P1 for the critical/high and authorization clusters, P1/P2 for the rest  
**Source:** 10 read-only audit streams, 2026-11-17 — full findings in
[`TASK-180-bug-research-report.md`](TASK-180-bug-research-report.md)  
**Baseline:** `/home/vital/dev/janosik` @ `4549342a`; pixel findings were
re-checked against `main` after PR #276 (`c21a2b8e`).  
**Delivery:** nine implementation PRs, listed in the [closeout](#closeout).

## Why

The 10-stream study produced **99 unique findings**: 1 critical, 15 high,
41 medium and 42 low. They are not one feature: they are correctness,
authorization, data-loss, contract and UX gaps across boards, commands, runs,
approvals, MCP, notifications, docs, deployment and accessibility.

The task exists to close them in reviewable slices with a traceable ID map,
without mixing them into feature redesigns (TASK-179, TASK-176/177/178).

**Non-negotiables**

- Fix the enforcement at the owning layer (server/service), not only in one UI.
- Do not weaken tests; add the missing boundary tests named in the report
  (>100 approvals, response loss, partial retention, forged inverse, snapshot
  edit/delete, Redis/SMTP failure, Russian keyboard, screen reader).
- No fabricated UI claims: if the server cannot prove a state, show unknown.
- Do not reopen pixel-parity/copy work excluded by the report.
- Each subtask ends with its own evidence, EN/RU docs where user-facing, and
  a targeted regression gate.

## Severity map

| Severity | Count |
| --- | ---: |
| CRITICAL | 1 |
| HIGH | 15 |
| MEDIUM | 41 |
| LOW | 42 |
| **Total** | **99** |

## Subtasks

| ID | Scope | Priority | Findings | Count |
| --- | --- | --- | --- | ---: |
| 180.1 | Rollback and run correctness | P0/P1 | C1, H4, H5, H6, M20–M22, L21, L37, L38 | 10 |
| 180.2 | Card/command write integrity | P1 | H2, H3, M7, M13, M14, M16, M17, L18–L20, L24, L35, L36 | 13 |
| 180.3 | Auth, roles, PATs and shares | P0/P1 | H1, H7, H8, M3–M6, M9–M12, M15, L25, L26 | 14 |
| 180.4 | Approvals and Agent Control | P1 | H10–H12, M8, M24–M28, L16, L17, L39 | 12 |
| 180.5 | MCP and public API contracts | P1/P2 | M32–M35, L8–L13 | 10 |
| 180.6 | Notifications, realtime and schedulers | P1/P2 | H13, H14, M29–M31, L22, L23, L40–L42 | 10 |
| 180.7 | Demo, retention and snapshots | P1/P2 | H9, M18, M19, M23 | 4 |
| 180.8 | Docs, deployment paths and onboarding | P2 | M36, M37, L3–L5, L7, L14, L15 | 8 |
| 180.9 | Navigation, i18n and accessibility | P2 | H15, M1, M2, M38–M41, L1, L2, L6, L27–L34 | 18 |
|  |  |  | **Total** | **99** |

## Recommended order

**Wave 1 — stop data loss and privilege escalation**

1. `180.1` rollback correctness (C1 and the H4–H6 data-loss paths).
2. `180.2` write integrity (H2/H3 and the no-op/ID-reuse family).
3. `180.3` authz (H1, H7, H8; then the share/PAT/session mediums).
4. `180.4` approvals (H10, H12; H11 is a post-#276 verification).
5. `180.7` demo/retention (H9 and the retention/snapshot gaps).

**Wave 2 — contract and runtime correctness**

6. `180.5` MCP/API contracts.
7. `180.6` notifications/realtime/schedulers.
8. `180.8` docs/deploy/onboarding.
9. `180.9` navigation/i18n/a11y and the low sweep.

---

## 180.1 — Rollback and run correctness

**IDs:** C1, H4, H5, H6, M20, M21, M22, L21, L37, L38.

**Goal:** a preview that says `canRevert:true` must be safe to apply; a rollback
may only touch what the run actually changed, and retries must be idempotent.

- C1: no-op commands must not store/apply a destructive inverse.
- H4: a created column's later cards must conflict or be excluded from the
  inverse, never deleted by a clean revert.
- H5: archive/delete preimages must retain the source column; a deleted column
  must block or redirect, never silently place a card in column 1.
- H6: partial command retention must be detected against `run.commandCount`.
- M20: concurrent revert retries must be idempotent and return the same audit
  run, not `409 run_conflict`.
- M21: the UI must reuse the same `commandId` across a retry; a lost response
  must reconcile, not create a second attempt.
- M22: `canRevert` must run the apply-time preconditions (WIP, assignee,
  payload size) or the preview must explain the later refusal.
- L21: align `run_expired`/`run_conflict` context, missing-`commandId` 400,
  read-only PAT `{dryRun:true}` error codes.
- L37: either write `failed` runs on real failed batches/plans or remove the
  dead status from filters/UI/schema.
- L38: publish new runs so an open list updates without reload.

**Acceptance:** each named failure has a regression test; no revert deletes an
entity the run did not create/change; preview and apply agree; retry after a
lost response does not duplicate or false-fail.

## 180.2 — Card/command write integrity

**IDs:** H2, H3, M7, M13, M14, M16, M17, L18–L20, L24, L35, L36.

**Goal:** the server owns ID parentage, limit enforcement and idempotency; a
client-supplied ID cannot reparent another entity or bypass a guard.

- H2: `ADD_CHECKLIST/ITEM/LINK` must reject IDs that belong to another card;
  no global-ID upsert reparenting.
- H3: duplicate card/column must copy checklists/items with fresh IDs, not
  reuse source IDs; reload must not lose them. Links are intentionally not
  copied — a duplicate starts unlinked.
- M7: only the current claim holder (or an explicit admin flow) may release a
  live claim.
- M13: `inverse:true` must be server-authenticated, not trusted from the
  payload; RESTORE must not bypass WIP/collection caps.
- M14: delete-column confirmation must count all cards that will be deleted,
  not the filtered subset.
- M16: inverse MOVE/UNARCHIVE must follow the documented no-refusal contract,
  or the client must stop optimistically applying them.
- M17: board create/import and MCP writes must send idempotency keys and retry
  safely.
- L18: `RESTORE_CARD` replay must not fingerprint a mutated payload.
- L19/L20: deleting an embedded attachment must clean the description; the UI
  cap must include inline attachments and map the cap error correctly.
- L24: a P2028 timeout must not strand an `in_progress` idempotency record for
  24 h.
- L35/L36: assignee UI must match the card face for removed/expired assignees;
  comment edits must refresh beyond the first 50 rows.

**Acceptance:** concurrent/forged/ID-reuse tests; no cross-card reparenting; no
duplicate loss on reload; retry tests for create/import/MCP.

## 180.3 — Auth, roles, PATs and shares

**IDs:** H1, H7, H8, M3–M6, M9–M12, M15, L25, L26.

**Goal:** operator vs owner boundaries, bootstrap, flags and share/PAT state are
enforced consistently on the server and mirrored honestly in the UI/docs.

- H1: `/auth/config` must allow the first bootstrap account without SMTP, or
  the install must create it explicitly; UI and API must agree.
- H7: only OWNER may change another user's email/verification; close the
  operator account-takeover path.
- H8: retention purge must be OWNER-only.
- M3: unverified registration must not reserve an address indefinitely; provide
  resend/change/cleanup.
- M4: `ALLOW_PUBLIC_SHARES=false` must gate creation and the Share UI, not only
  token resolution.
- M5: `realtime_sse` must actually disable SSE, or be removed/documented inert.
- M6: open SSE streams must re-check token expiry/security stamp/PAT scope.
- M9: snapshot refresh must use the `share.update` approval gate and audit.
- M10/M11: archived boards and `includeComments=false` must revoke nested
  comment/attachment access and live comment events.
- M12: TOTP replacement must require current code/password and be audited.
- M15: expired accepted VIEWER memberships must be visible/removable and not
  block re-invitation.
- L25: reject `trustedCi:true` on observer/read-only presets on create and PATCH.
- L26: do not leak `agentPolicy` in public share payloads.

**Acceptance:** operator/owner e2e matrix; no-SMTP bootstrap; flag-on/off tests;
SSE revocation; share update audit; 2FA takeover test.

## 180.4 — Approvals and Agent Control

**IDs:** H10–H12, M8, M24–M28, L16, L17, L39.

**Goal:** the queue, counts, detail and MCP approval path are consistent and
reachable at any page size, and live state does not silently freeze.

- H10: board Inbox must reach an old pending approval beyond 100 newer rows;
  either fetch pending first or paginate until the count is satisfied.
- H11: **re-check after #276.** On current `main`, an approved plan keeps
  `approved` after its apply window; the apply path still returns
  `approval_expired`. Verify the UI explains the wedged state and the tests
  match the intentional behavior; do not reintroduce silent expiry.
- H12: MCP destructive tools must expose/reuse a stable `commandId` so an
  approved plan hash is applicable; add a live approval round-trip test.
- M8: approval dedup must include the agent session or return a usable
  replacement.
- M24: global `/agents` approvals need cursor/load-more; no 99+/150 mismatch.
- M25: board pending count must drop on TTL expiry without SSE.
- M26: approval detail must follow SSE; after a decision the selection/detail
  must not become an empty orphan (especially mobile).
- M27/M28: Board Live must refresh heartbeat/token-pause state; board/token
  paused sessions must not enter "Needs a nudge".
- L16/L17: board approval deep links must open the mobile detail; archived
  boards must be consistently in/out of session lists and counts.
- L39: invalidate cached conflict previews after an external fix.

**Acceptance:** >100-row queue test; TTL countdown test; SSE external decision;
mobile deep link; MCP approved-destructive round trip; pause/heartbeat refresh.

## 180.5 — MCP and public API contracts

**IDs:** M32–M35, L8–L13.

**Goal:** the published contract matches the server; MCP can return everything
the docs promise.

- M32: `janosik_get_card`/`get_run`/`get_approval` need an output-file or
  paging path for documents over the 25k MCP budget.
- M33: MCP mutation responses must return `seq`/`runId`; batch must propagate
  the run id.
- M34: REST must state which routes are browser-session-only; stop claiming
  every route accepts a PAT.
- M35: token `scopePreset` is editable; fix the "immutable" claim and keep
  OpenAPI/UI/docs consistent.
- L8: complete the `ApiErrorCode` catalog and the token PATCH 409.
- L9: document `expiresInHours` on `CreateShareDto`.
- L10: document that PATCH strips `expiresAt`, not "every field except secret".
- L11/L12: add password-reset endpoints/limits and the current
  `/auth/config` shape.
- L13: fix missing routes and the `/boards/:id/plans/apply` path.

**Acceptance:** OpenAPI validator + docs link checks; MCP live round trips;
contract tests for response fields.

## 180.6 — Notifications, realtime and schedulers

**IDs:** H13, H14, M29–M31, L22, L23, L40–L42.

**Goal:** delivery and realtime state are durable, reconcilable and readable.

- H13: BullMQ job IDs must not contain more than two colons; queue failures must
  not silently fall back to in-process sends that lose the rest.
- H14: a lost command response must reconcile with the server; do not roll back
  and then suppress the authoritative SSE echo.
- M29: the in-app attention inbox and `notifyAttention` opt-out need a UI
  consumer (or the backend routes/emails must be disabled).
- M30/M31: `emailedAt`/`digestedAt` only after delivery; boot-time schedule
  application must retry/reconcile after Redis recovers.
- L22: out-of-range notification cursors must be 400, not 500.
- L23: multi-node throttle/SMTP settings must propagate or be documented
  process-local.
- L40/L41: `/health/ready` envelope and nginx CSP/HSTS parity.
- L42: due-reminder emails must respect the user locale.

**Acceptance:** Redis/SMTP failure tests; response-loss browser test; cursor
validation; health/nginx contract; EN/RU reminder.

## 180.7 — Demo, retention and snapshots

**IDs:** H9, M18, M19, M23.

**Goal:** cleanup only touches rows it owns; retention and snapshots do what
their docs say.

- H9: demo start/stop must delete only recorded demo rows/links; never purge a
  real board by title prefix.
- M18: snapshot shares must be frozen against later comment/attachment edits
  and board deletion.
- M19: the live-share aggregate cache needs a bound/eviction.
- M23: implement agent-session/approval retention and board-purge cleanup, or
  correct the docs and stop claiming it.

**Acceptance:** destructive demo test on a real board fixture; snapshot
edit/delete/archive test; cache bound test; retention/purge test.

## 180.8 — Docs, deployment paths and onboarding

**IDs:** M36, M37, L3–L5, L7, L14, L15.

**Goal:** a fresh self-hoster can follow the docs on the shipped image and land
on real pages.

- M36: `/app/admin/...` and `/app/agents` everywhere; admin "Edit content" and
  "Back to boards" must honor the base path.
- M37: quickstart must not tell users to register when SMTP/bootstrap is absent;
  document the real first-account path.
- L3: `llms.txt`/`pricing.md` must honor `SITE_BASE`.
- L4/L5: RU JSON-LD and RU 404 must be Russian/canonical.
- L7: export schema is v3, not v2.
- L14: nginx bare `/app` and unknown-site 404 parity with the Node server.
- L15: remove/qualify "backups" claims that the product does not provide.

**Acceptance:** docs link/anchor checks; clean install dry-run; base-path
Playwright; site build EN/RU.

## 180.9 — Navigation, i18n and accessibility

**IDs:** H15, M1, M2, M38–M41, L1, L2, L6, L27–L34.

**Goal:** navigation state is board-scoped, shortcuts work on RU layouts, and
the interactive surfaces are actually accessible.

- H15: Board Settings dialog must reset/confirm on board change; never save A's
  draft onto B.
- M1/M2: OAuth returns to the original deep link; auth screens scroll on short
  viewports.
- M38: shortcuts must use `event.code`/layout-independent matching.
- M39: admin workflow Back/sidebar must confirm unsaved changes.
- M40: admin palette responses need request generation/abort/query check.
- M41: app palette/board switcher need ARIA combobox semantics.
- L1/L6: `?mode=register` lifecycle and 403/503 login error mapping.
- L2: invitations bell error state, not endless Loading.
- L27: `?lng` must not pin the language after switching.
- L28: admin "Recent" entries need real labels/icons.
- L29: board title limit must match the server (100).
- L30: admin breadcrumbs hub/tab crumbs should be links.
- L31: undo/redo must respect open overlays.
- L32: mobile admin "All destinations" must close the sheet on same-hub tab
  changes.
- L33: shortcut help must match mounted shortcuts.
- L34: localize the admin "All destinations" dialog.

**Acceptance:** RU-layout keyboard test; screen-reader/ARIA checks; board-switch
draft test; auth short-viewport/scroll test; EN/RU catalog parity.

---

## Traceability rule

The ID lists above are exhaustive and mutually exclusive:
`C1 + H1–H15 + M1–M41 + L1–L42 = 99`. A subtask may reference a finding in
another subtask for context, but the owning fix and test live in the listed
subtask.

**Post-#276 note:** H11 and the pixel-only parts of M26/L39 were captured before
PR #276. Re-check them on current `main`; H11's `approved`-after-apply-window
behavior is now intentional and its e2e expectation was updated. Do not treat
the old `expired` expectation as the target.

## Closeout

**99/99 findings accounted for.** TASK-180.1 through TASK-180.8 carried 81 IDs
into `main` before TASK-180.9. PR #295 carried the remaining 18. The finding
assignments are in the [subtask map](#subtasks).

| Subtask | PR | Merge/landing commit | Evidence doc | Outcome |
| --- | --- | --- | --- | --- |
| 180.1 | [#284](https://github.com/VitalyTolstik/janosik/pull/284) | [`eaf0f0ca`](https://github.com/VitalyTolstik/janosik/commit/eaf0f0ca) | [Rollback correctness](TASK-180.1-rollback-correctness.md) | 10 IDs. Rollback and replay guards shipped. L37 closed by retiring the unused `failed` status. M22 retains apply-time workflow and claim checks. |
| 180.2 | [#288](https://github.com/VitalyTolstik/janosik/pull/288) | [`242bc789`](https://github.com/VitalyTolstik/janosik/commit/242bc789) | [Write integrity](TASK-180.2-write-integrity.md) | 13 IDs. Parentage, duplication, claim, restore and retry guards shipped, with M17, L18 and L19 limits below. |
| 180.3 | [#289](https://github.com/VitalyTolstik/janosik/pull/289) | [`94aae494`](https://github.com/VitalyTolstik/janosik/commit/94aae494) | [Authorization](TASK-180.3-authz.md) | 14 IDs. Bootstrap, role, PAT, SSE, sharing and TOTP boundaries shipped. |
| 180.4 | [#290](https://github.com/VitalyTolstik/janosik/pull/290) | [`e0d2e3bb`](https://github.com/VitalyTolstik/janosik/commit/e0d2e3bb) | [Approvals and Agent Control](TASK-180.4-approvals.md) | 12 IDs. Queue, session and MCP fixes shipped. H11 preserves the decision, explains the lapsed window and allows a replacement request. |
| 180.5 | [#291](https://github.com/VitalyTolstik/janosik/pull/291) | [`68ee42ee`](https://github.com/VitalyTolstik/janosik/commit/68ee42ee) | [MCP and public API](TASK-180.5-mcp-api.md) | 10 IDs. MCP output and mutation results, REST and OpenAPI shipped, with M32 and M34 limits below. |
| 180.6 | [#292](https://github.com/VitalyTolstik/janosik/pull/292) | [`244d0cec`](https://github.com/VitalyTolstik/janosik/commit/244d0cec) | [Notifications and realtime](TASK-180.6-notifications.md) | 10 IDs. Durable delivery, reconciliation and schedule recovery shipped. L23 documents process-local configuration. H13 retains a duplicate-delivery window. |
| 180.7 | [#293](https://github.com/VitalyTolstik/janosik/pull/293) | [`bed2f350`](https://github.com/VitalyTolstik/janosik/commit/bed2f350) | [Demo, retention and snapshots](TASK-180.7-demo-retention.md) | 4 IDs. Ownership-scoped cleanup, frozen captures, cache bounds and retention shipped, with H9, M18 and M23 limits below. |
| 180.8 | [#294](https://github.com/VitalyTolstik/janosik/pull/294) | [`d8f26007`](https://github.com/VitalyTolstik/janosik/commit/d8f26007) | [Docs, deployment and onboarding](TASK-180.8-docs-deploy.md) | 8 IDs. Docs, first-run and deployment paths shipped. L5 keeps a static fallback, and the published-image M37 check is deferred. |
| 180.9 | [#295](https://github.com/VitalyTolstik/janosik/pull/295) | [`c70b93e7`](https://github.com/VitalyTolstik/janosik/commit/c70b93e7) | [Navigation, i18n and accessibility](TASK-180.9-nav-i18n-a11y.md) | 18 IDs. Navigation, locale, shortcut and ARIA fixes shipped, with the H15 limit and M1/M41 manual gaps below. |

### Accepted residuals

This table lists only closeout-critical residuals in the central register.
Additional per-subtask limits remain documented in the evidence for
[180.1 — Known residuals](TASK-180.1-rollback-correctness.md#known-residuals),
[180.2 — Known residuals](TASK-180.2-write-integrity.md#known-residuals),
[180.3 — Residuals](TASK-180.3-authz.md#residuals),
[180.4 — Queue and live state](TASK-180.4-approvals.md#queue-and-live-state),
[180.5 — Residuals](TASK-180.5-mcp-api.md#residuals),
[180.6 — Residual risks](TASK-180.6-notifications.md#residual-risks),
[180.7 — Compatibility and limits](TASK-180.7-demo-retention.md#compatibility-and-limits),
[180.8 — Residual risks](TASK-180.8-docs-deploy.md#residual-risks), and
[180.9 — Residual coverage](TASK-180.9-nav-i18n-a11y.md#residual-coverage).

| ID/area | Residual | Owner | Date |
| --- | --- | --- | --- |
| L18 · Restore replay | **Accepted.** Once a non-member assignee has been stripped from the stored payload, replay cannot distinguish a different non-member assignee from the original. | Vitaly | 2026-11-20 |
| L19 · Attachment references | **Accepted.** Attachment deletion scrubs editor-generated forms. Legacy HTML `<img>` references may still point to the deleted resource. | Vitaly | 2026-11-20 |
| M17 · MCP retries | **Accepted.** The transport retry reuses its key. A new invocation after a lost response must supply the original `idempotencyKey` to avoid a duplicate write. | Vitaly | 2026-11-20 |
| L5 · Site 404 | **Accepted.** With JavaScript disabled, the static 404 is English, including on Russian paths. | Vitaly | 2026-11-20 |
| M37 · Clean install | **Deferred.** Fresh-database onboarding and Docker smoke checks ran against locally built artifacts. A clean install from the published image remains a manual verification gap. | Vitaly | 2026-11-20 |
| M41 · Assistive technology | **Deferred.** Automated tests cover ARIA and focus. Real screen-reader announcements in NVDA, JAWS, VoiceOver and TalkBack remain unverified. | Vitaly | 2026-11-20 |
| M32 · MCP output files | **Accepted.** Atomic publication requires hard links. Confined writes also require `O_TMPFILE` support on the target filesystem. | Vitaly | 2026-11-20 |
| M34 · Revert authentication | **Accepted.** The shared route has body-dependent authorization. OpenAPI documents PAT access for `dryRun: true` and the board ADMIN browser session required to apply. | Vitaly | 2026-11-20 |
| H9 · Demo lifecycle | **Accepted.** Start and stop serialize per backend process. | Vitaly | 2026-11-20 |
| M18 · Legacy snapshots | **Accepted.** Legacy snapshots can read qualifying source rows while the source board remains available. Independent captures freeze their own content. | Vitaly | 2026-11-20 |
| M23 · Orphan approvals | **Accepted.** Approval rows orphaned by board purges before TASK-180.7 are outside the new board-purge cleanup path. | Vitaly | 2026-11-20 |
| H13 · SMTP delivery | **Accepted.** If SMTP accepts a message and the worker loses the database commit, a retry can send it again with the same Message-ID. | Vitaly | 2026-11-20 |
| H15 · Board Settings draft | **Accepted.** A forced switch silently discards the previous board's draft and restores focus on the destination board. | Vitaly | 2026-11-20 |
| M1 · OAuth provider | **Deferred.** HTTP e2e covers the callback with provider stubs and Chrome covers app navigation. A live-provider round trip remains a manual verification gap. | Vitaly | 2026-11-20 |

### Definition of Done

- [x] All 99 IDs are accounted for by shipped fixes, documented contract
  decisions or explicitly deferred checks with owners and dates. H11's original
  `expired` expectation was reclassified after #276, and replacement approval
  and the lapsed-window UI have regression coverage.
- [x] All nine subtasks have linked evidence. The evidence records regression
  boundaries, live or fault-injected checks for critical/high paths, and EN/RU
  and OpenAPI updates where the contracts changed.
- [x] CI passed on PR #295 head `1bebcd8c` and on the post-merge `main` push
  at `c70b93e7`. Both commits have Git tree
  `adcfae80f093bfbae68c681440e1b822fc837c29`. The PR's `verify` job passed UI
  and backend unit/e2e tests, type checks including `tsc -b`, builds, and
  OpenAPI validation and validator tests.
  [PR-head CI run `44630080321`](https://github.com/VitalyTolstik/janosik/actions/runs/44630080321),
  [post-merge CI run `44634141494`](https://github.com/VitalyTolstik/janosik/actions/runs/44634141494),
  [verify job](https://github.com/VitalyTolstik/janosik/actions/runs/44630080321/job/135934236136)
- [x] The PR gate passed the app browser lane with and without email, the
  admin browser lane, security-contract (backend and browser), and Docker
  smoke checks on amd64 and arm64. CodeQL passed on the PR head and on the
  post-merge `main` push.
  [PR-head CodeQL run `44630080400`](https://github.com/VitalyTolstik/janosik/actions/runs/44630080400),
  [post-merge CodeQL run `44634140593`](https://github.com/VitalyTolstik/janosik/actions/runs/44634140593)
