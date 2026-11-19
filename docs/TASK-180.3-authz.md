# TASK-180.3 — Auth, roles, PATs and shares

All 14 findings in the authorization slice were addressed in
[PR #289](https://github.com/VitalyTolstik/janosik/pull/289), merged as
[`94aae494`](https://github.com/VitalyTolstik/janosik/commit/94aae494).

| ID | Shipped behavior | Regression evidence |
| --- | --- | --- |
| H1 | With registration and bootstrap enabled on an empty install without SMTP, `/auth/config` offers signup and the API verifies the first account. The offer closes after bootstrap is used. | HTTP tests cover the empty install, verified first account, spent bootstrap and bootstrap disabled. [auth-bootstrap](../backend/test/auth-bootstrap.e2e-spec.ts) |
| H7 | Only an OWNER can change another user's email or verification status. Operators can still rename users. The user detail and row menus follow the same permission boundary. | HTTP tests assert operator refusals, permitted rename, and the audited owner change. Browser tests cover the user-detail actions menu for owners and operators. A UI unit test checks that owner-only actions are absent from an operator's users row menu. [authz-admin-1803](../backend/test/authz-admin-1803.e2e-spec.ts), [admin permissions](../e2e/tests/admin/permissions.spec.ts), [users row menu test](../ui/src/admin/AdminApp.test.tsx#L1352) |
| H8 | Only an OWNER can run the retention purge. | The HTTP matrix asserts the operator gets `403` and the owner can run the purge. [authz-admin-1803](../backend/test/authz-admin-1803.e2e-spec.ts) |
| M3 | The verification gate offers resend and change of address. The maintenance sweep releases abandoned registrations after `UNVERIFIED_ACCOUNT_TTL_DAYS` (14 by default). It preserves fresh, verified or active accounts and rechecks eligibility inside the deletion transaction. | PostgreSQL tests cover address reuse, membership and content exclusions, and concurrent writes including the foreign-key backstop. UI tests cover resend and opening the change-email dialog. [auth-cleanup](../backend/test/auth-cleanup.e2e-spec.ts), [EmailVerificationGate](../ui/src/components/auth/EmailVerificationGate.test.tsx) |
| M4 | Disabling public shares blocks creation, snapshot refresh and public resolution. `/auth/config` propagates the flag to the Share entry point, and demos that need a public link cannot start. | HTTP tests cover the runtime flag, `404` before approval or idempotency state is written, and demo refusal and cleanup. UI tests cover the hidden Share entry and disabled demo start. [share-authz-1803](../backend/test/share-authz-1803.e2e-spec.ts), [admin-throttle-demo](../backend/test/admin-throttle-demo.e2e-spec.ts), [ShareDialog](../ui/src/components/board/ShareDialog.test.tsx), [DemoPage](../ui/src/admin/DemoPage.test.tsx) |
| M5 | Disabling `realtime_sse` refuses new member and public streams and closes open streams on revalidation. | The HTTP tests toggle the flag with connected member and public SSE clients and assert both admission refusal and stream closure. [events-authz-1803](../backend/test/events-authz-1803.e2e-spec.ts), [share-authz-1803](../backend/test/share-authz-1803.e2e-spec.ts) |
| M6 | Open member SSE streams revalidate access-token expiry, the security stamp, refresh-family revocation and the PAT's current validity and board scope. | Connected HTTP tests cover access-token expiry, security-stamp change, logout, normal refresh rotation, PAT revocation and expiry, and narrowing the PAT to another board. [events-authz-1803](../backend/test/events-authz-1803.e2e-spec.ts) |
| M9 | Snapshot refresh honors the `share.update` approval policy and records a `refreshed` share audit entry. An approval can be consumed once. | HTTP tests cover required approval, successful approved refresh, refused replay, and audit attribution. A live-share refresh is refused before an approval is created. [share-authz-1803](../backend/test/share-authz-1803.e2e-spec.ts) |
| M10 | Archiving a board revokes its live share, including nested comment and attachment reads. | The HTTP test checks successful nested lists before archive and `410` after archive for the share, comment and attachment lists, and attachment content. [share-authz-1803](../backend/test/share-authz-1803.e2e-spec.ts) |
| M11 | Setting `includeComments=false` also affects already-open public SSE streams after revalidation. | A connected HTTP test sees comment activity before the flag change, verifies comment reads return `404`, and sees no comment activity after the stream rechecks access. [share-authz-1803](../backend/test/share-authz-1803.e2e-spec.ts) |
| M12 | Replacing an active master TOTP factor requires the current code or password. A short-lived setup ticket binds confirmation to the active factor state. The confirmed secret and audit entry commit together. | HTTP tests cover both proof paths, the old factor during staging, stale or replayed setup, concurrent confirmation and rollback on audit failure. UI tests cover the proof and setup-ticket flow. [authz-admin-1803](../backend/test/authz-admin-1803.e2e-spec.ts), [SecurityPage](../ui/src/admin/SecurityPage.test.tsx) |
| M15 | Board admins can list expired accepted VIEWER memberships with `includeExpired=1`, remove them or turn them into new pending invitations. The default roster still includes only active members. | HTTP tests cover default roster exclusion, the admin-only option, removal and re-invitation. The admin dialog test checks visibility and removal. [boards-members](../backend/test/boards-members.e2e-spec.ts), [security-hardening](../backend/test/security-hardening.e2e-spec.ts), [BoardMembersDialog](../ui/src/components/board/BoardMembersDialog.test.tsx) |
| L25 | Token creation and PATCH reject `trustedCi:true` when the resulting token is observer or read-only. | HTTP tests reject observer and read-only creation and invalid PATCH combinations, including changing a trusted token to read-only. [api-tokens](../backend/test/api-tokens.e2e-spec.ts), [token-update](../backend/test/token-update.e2e-spec.ts) |
| L26 | Public live and snapshot board payloads omit `agentPolicy`. | The share suite asserts omission in both modes. A related public-share test separately checks token and session identity redaction. [share-authz-1803](../backend/test/share-authz-1803.e2e-spec.ts), [agent-sessions](../backend/test/agent-sessions.e2e-spec.ts) |

## Verification

PR #289 passed `verify`, `security-contract`, app and admin browser suites,
and amd64 and arm64 Docker checks. The `verify` log records passing e2e
suites for the backend evidence above. CodeQL also passed.
[CI run](https://github.com/VitalyTolstik/janosik/actions/runs/44467752157),
[verify log](https://github.com/VitalyTolstik/janosik/actions/runs/44467752157/job/135369528246),
[CodeQL run](https://github.com/VitalyTolstik/janosik/actions/runs/44467752160)

## Residuals

- M3 cleanup applies only to abandoned registrations. Content-bearing
  accounts and accounts with accepted memberships are preserved.
- M5, M6 and M11 changes on an open stream can take until the next keep-alive
  to take effect (25 seconds by default). An otherwise valid read-only PAT
  retains its authorized read stream.
- M12 first enrollment relies on the authenticated master session when 2FA
  is off. An already stolen live master session can enroll the first factor.
  [Admin security docs](../site/src/content/docs/docs/admin/settings.md#two-factor-authentication)
