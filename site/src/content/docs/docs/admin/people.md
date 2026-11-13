---
title: Users and masters
description: The user list and its actions, the user detail page, and the masters page.
---

:::note
Users are the **Users** hub. Masters is now an owner-only tab inside
**Access & security** (`/admin/access?tab=masters`); `/admin/masters` redirects
there. See [Admin redesign](../redesign/).
:::

The people section manages regular users and master accounts. The user list is
visible to every master; the masters page is owner-only.

## Users

`/admin/users` lists registered accounts. The subtitle is `{total}
registered`.

| Column | Value |
| --- | --- |
| Email | address, linked to the user detail page, with a copy control |
| Name | display name, truncated |
| Registered | creation time |
| Status | `Active` or `Blocked` |

The page has a search box, status tabs (all, active, blocked), pagination and a
`Create user` button. Rows link to the user detail page.

### Create a user

The `Create user` dialog takes:

| Field | Constraints |
| --- | --- |
| Email | required, valid address |
| Name | optional, at most 50 characters |
| Password | optional, 8 to 100 characters |

When the password is left empty, the server generates one and returns it
exactly once. The dialog then shows `Password (shown once)` with a copy button.

### Row actions

Every row has an actions menu with the following entries.

| Action | Effect | Notes |
| --- | --- | --- |
| Block | sets `disabledAt` | destructive, confirmed; also revokes every session immediately |
| Unblock | clears `disabledAt` | confirmed; sessions are not restored |
| Change email | opens the change email dialog | see below |
| Revoke sessions | revokes every live refresh session | destructive, confirmed |
| Revoke API tokens | revokes every personal API token | destructive, confirmed |
| Verify email | sets the address verified | shown when unverified; confirmed |
| Unverify email | withdraws the confirmation | destructive, shown when verified; confirmed |
| Resend verification | sends a fresh confirmation code | shown always |
| Reset password | issues a temporary password | owner-only server-side; opens a dialog |
| Promote to master | creates an `OPERATOR` master | warning color; opens a dialog |
| Impersonate | opens a short support session | owner-only; opens the app in a new tab |
| Export data | downloads a GDPR bundle | owner-only server-side |
| Delete user | erases the account | owner-only server-side; opens a dialog that requires typing the email |

The list page shows a subset of these actions; the user detail page exposes the
full set.

### Change email

`Change email` opens a dialog with the current address as the description and a
`New email` field. Unlike the self-service flow there is no verification code:
the master is accountable through the audit trail. On success every session of
the user is revoked, the change is audited as `user.email_changed`, and a
notice is sent to the old address. A duplicate address answers `409` and an
invalid address answers `400`.

### Reset password

`Reset password` issues a fresh temporary password, shown once, and revokes
every session of the user. It is owner-only server-side. The dialog fires the
request as soon as it opens.

### Promote to master

`Promote to master` creates an `OPERATOR` master with the same email and a new
temporary password. The dialog requires typing the account's email to confirm,
then shows the one-time password. If a master account with that email already
exists, the server returns `409`.

### Impersonate

`Impersonate` creates a short-lived user token (15 minutes) scoped to one
account and opens the app with it in a new tab. The app shows an irremovable
banner naming the master. It is owner-only and refuses a disabled account. The
token creation is recorded as `user.impersonated` in the audit log.

### Export data

`Export data` requests a JSON bundle of everything tied to the user (profile,
memberships, comments, attachments, sessions, tokens, commands, activity). A
small data export is generated and downloaded immediately; a large export is
queued and
the panel polls until the artifact is ready. The artifact has a seven-day
lifetime. It is owner-only server-side.

### Delete user

`Delete user` erases the account and the rows it authored in one transaction,
then removes its blobs. Unlike `Block`, this permanently removes the account’s data. The dialog
requires typing the account's exact email to confirm. It cannot be undone. It
is owner-only server-side: an operator gets `403` with `Owner rights are
required`.

## User detail

`/admin/users/:id` shows the user’s details and related records needed by support staff. The header
carries the display name (or email), the email, the id, a status badge, the
registration time, the disabled time when blocked, and a verified or unverified
badge. The actions menu repeats the full action set.

### Counter cards

Eight counters are shown. Every counter is an exact server-side count, never
the length of the visible page:

| Counter | Meaning |
| --- | --- |
| Boards | accepted board memberships; pending invitations and deleted boards are not counted |
| Cards created | `ADD_CARD` / `DUPLICATE_CARD` commands authored by the user in the retained command log |
| Cards assigned | live cards where the user is the assignee |
| Comments | live (not soft-deleted) comments authored by the user |
| Attachments | live (not soft-deleted) files uploaded by the user |
| Sessions | active refresh sessions (not revoked and not expired) |
| API tokens | active personal tokens (not revoked) |
| Commands | all commands authored by the user |

`Cards created` has no creator column to read: it is derived from the command
log, exact for the retained log, and the Created cards tab pages that same log.

### Tabs

The detail page has nine tabs. Every tab is a window over an exact total: its
footer reads `N of M` and offers `Load more` while `M` is larger. The tab badge
is the total for the current filter, never the number of loaded rows.

| Tab | Columns |
| --- | --- |
| Memberships | Board, Role, Accepted, Expires, Invited by (linked), Joined |
| Created cards | Card, Board, Column, Updated, Status |
| Assigned cards | Card, Board, Column, Updated, Status |
| Comments | Comment, Card, Created, Status, Actions |
| Attachments | File, Card, Size, Created, Status |
| Sessions | Started, Expires, Session, Status, Actions |
| API tokens | Token, Created, Last used, Expires, Status, Actions |
| Commands | Action, Board, Seq, When |
| Activity | Event, Board, Card, When |

Memberships show a `Deleted` badge when the board is deleted and a `Pending`
badge until the invitation is accepted. The tab includes pending invitations
and memberships of deleted boards, which is why its total can be larger than
the Boards counter (accepted memberships only). Created cards and assigned
cards show the active, archived or deleted status.

Comments and attachments show live rows by default; `Show deleted (N)`
includes soft-deleted rows. Sessions show active sessions by default;
`Show inactive (N)` adds revoked and expired ones. API tokens show active
tokens by default; `Show revoked (N)` adds revoked ones. `N` is the number of
hidden rows that the control will add, not the new total. A tab whose live page
is empty still exposes the matching control when hidden rows exist, so
deleted/revoked rows can never hide the live ones. Empty tabs show a short
empty state. A tab window stops at 5,000 rows; for deeper history use the
searchable Commands and Activity lists, which accept the user id.

The Actions menu deletes one comment or revokes one session/token without
leaving the profile. Each write asks for confirmation and refreshes the tab
with inactive rows included, so the affected row keeps its `Deleted` or
`Revoked` badge. Already deleted/revoked rows have no action; a 403 shows the
standard forbidden toast and leaves the row untouched. Session and token
actions call the same audited endpoints as the moderation lists.

## Masters

`/admin/masters` is owner-only. It lists the panel accounts. The subtitle is
`Owner and operator accounts of the panel`.

| Column | Value |
| --- | --- |
| ID | the master id, as a copyable chip |
| Email | the address |
| Role | `Owner` (with a crown) or `Operator` |
| Name | display name |
| Failed logins | the lockout counter |
| Last login | the last successful login, or `never` |
| Locked until | the lockout expiry, or a dash |
| Status | `Active`, `Blocked` or `Locked` |

### Create a master

`Add master` opens a dialog with an email, an optional display name (at most 50
characters) and a `Grant owner rights` checkbox. The checkbox selects `OWNER`
when checked and `OPERATOR` when not. The server generates a one-time password
and shows it once with a copy button. If a master account with that email
already exists, the server returns `409`.

### Row actions

| Action | Effect | Notes |
| --- | --- | --- |
| Block | sets `disabledAt` and revokes every session | destructive; disabled for your own account |
| Unblock | clears `disabledAt`, the counter and the lockout | |
| Unlock | clears the account lockout and failed-login counter | shown only when locked |
| Reset password | issues a one-time password and revokes every session | shows the password once |
| Revoke sessions | revokes every session of that master | |
| Remove from masters | deletes the master account | destructive; disabled for your own account |

### Self-guards

The server refuses actions that would leave the panel without an owner or an
operator without access:

- You cannot disable your own account.
- You cannot disable the last active owner.
- You cannot demote your own account.
- The last owner cannot be demoted.

Removing a master deletes only the master account. If the same email also has a
regular user account, the user is untouched.

## Where to go next

The board, card and content listings live on
[boards, cards and content](/docs/admin/content/). The settings pages live on
[email, security and operations](/docs/admin/settings/).
