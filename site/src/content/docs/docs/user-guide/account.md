---
title: Account, keys and preferences
description: Sign in, manage your profile, password and API keys, set preferences, and back up your data.
---

Janosik runs in server mode: an account is required, and the app opens to the
sign-in screen before your boards load.

## Sign in and register

The sign-in screen has one form with two modes. `Sign in` asks for your
`Email` and `Password`; `Create account` also offers an optional `Name` field.
Your account lets you access the same boards across devices. The link
at the bottom switches between the two modes.

![The sign-in screen.](/screens/login.png)

If the operator has enabled external sign-in, buttons such as `Continue with
<provider>` appear below the form. An operator can also close registration;
when it is closed, only the sign-in form is shown.

After five wrong passwords for one address, sign-in pauses for that address:
first for 30 seconds, then twice as long after each further miss, up to 15
minutes. The message says how long to wait.

An existing password account must first link the provider in Account → Security.
If its email was never confirmed, the server removes the password, signs out
every device and revokes all API keys before linking the provider. You then sign
in through that provider.

## Forgot your password?

On the sign-in screen, choose **Forgot password?** and enter your email. If an eligible account exists, you will receive a single-use recovery code. Enter the code and your new password within 15 minutes. Check your spam folder if the email does not arrive. This works for accounts with a verified email and a local password. After a reset, all refresh sessions and API keys are revoked. If email recovery is unavailable, contact your administrator; OAuth-only accounts should sign in through their provider.

## Confirm your email

When email delivery is configured, the app asks you to `Confirm your email` after registration. It sends a
six-digit code to your address; type it in and press `Confirm`. If the code
does not arrive, use `Resend code`. You can also `Sign out` from this screen.

## The account panel

The account button in the header opens a panel with your account details at the top
and a section list on the left: `Profile`, `Security`, `API keys` and
`Preferences`. `Sign out` is at the bottom of the list and requires confirmation.

### Profile

![The Profile section: photo, avatar color, display name and email.](/screens/account-profile.png)

- `Profile photo` — upload a PNG, JPEG, GIF or WebP image. The uploaded photo
  replaces the initials.
- `Avatar color` — pick a color for your initials, or leave it on automatic.
- `Display name` — shows on cards, in the feed and in the list of online members.
- `Scheduled digests and due reminders` — uncheck to stop summary e-mails;
  board activity is unaffected.
- `Email` — your sign-in address, shown read-only. Use `Change` to start the
  change flow.

### Security

**To change your email**, enter the new address and, if the account has one, your current password. The
app sends a six-digit code to the new address. Type
the code to confirm. Other devices are signed out after the change.

**Change your password** asks for your current password when one is set, and a new one, entered
twice. After a change, other devices are signed out and every API key is
revoked, so create new keys for your scripts and agents.

To link a provider to a password account, enter the current password and choose
the provider in this section. Its verified email must match your account email.

### API keys

![The API keys section: create personal tokens for scripts and integrations.](/screens/account-api-keys.png)

API keys are personal tokens for scripts and integrations. A token acts as
you, so keep it secret.

Use `Create key`, give it a `Name`, and choose when it expires: `Never`,
`In 30 days`, `In 90 days` or `In a year`. You can also scope the key: pin it
to one board, choose a `Scope preset` (`Observer`, `Worker`, `Reviewer` or
`Admin`), make it read-only (every write is refused), give it its own
requests-per-minute budget, and optionally mark it `Trusted CI`. A new key
starts as `Worker`; the preset never raises your board role. `Observer` only
reads, `Reviewer` may also move cards into a done column, and `Admin` may
administer the board (members, shares, delete). Even `Admin` cannot delete
cards, columns or labels without a human approval; `Trusted CI` is the explicit
exception for a trusted pipeline, and a board policy can block destructive
actions entirely. A destructive agent call without approval is refused with
`409 approval_required`; the request names the exact plan, and a human board
ADMIN approves or rejects it in the browser before the agent repeats the call
with `X-Approval-Id`. Nothing is applied before that decision. If an agent only needs to
read data, use an `Observer` key restricted to one board. The key itself is
shown once, with a `jnk_` prefix; copy it then and store it in a password
manager. The list shows each key's name, status (`Active`, `Expired` or
`Revoked`), its effective scope, when it was created, when it was last used and
when it expires. `Revoke` stops a key immediately and cannot be undone; a live
connection opened with the key closes within about 25 seconds.

Keys are managed only here, in a signed-in browser. A key cannot list, create
or revoke keys, change your password or email, update the profile, or list and
accept invitations, so a leaked key can never mint a longer-lived one, change
your account or lock you out. Use `Edit` on an existing key to change its name,
board scope, scope preset, trusted-CI flag, read-only flag or rate limit; the
server validates and audits the change and never reveals the secret again. If
you need a new secret, create a new key and revoke the old one. The row keeps a
compact summary of the effective scope, board scope, rate limit and pause
state.

### Pausing and stopping agents

Every API key row has two reversible controls and one permanent one. `Pause`
stops new writes with that key; an in-flight request still finishes, and the
next write is refused with `403 agent_paused` instead of being queued. Reads,
heartbeat and end-session keep working. `Resume` releases only that key's own
pause. `Stop all` at the top of the section pauses every live key at once;
`Resume all` clears only that bulk stop, so a key paused on its own stays
paused until you resume it individually. `Revoke` is the kill switch: the key
stops working at once, its sessions are cancelled, claims it holds are
released and the connection closes within about 25 seconds. Pause and resume
are available only in a signed-in browser; an API key cannot clear its own
pause.

### Preferences

![The Preferences section: language, time format, theme and board background.](/screens/account-preferences.png)

Preferences are personal. The language is stored on your account, so it follows
you across devices; the remaining display options apply to this browser:

- `Language` — English or Русский; also used for announcement banners and email.
- `Time format` — `Auto` (follows the language), `12-hour (AM/PM)` or
  `24-hour`.
- `Theme` — `Light` or `Dark`.
- `Board background` — `Solid`, `Paper`, `Dots`, `Grid` or `Concentric`.

Changing the language is saved to your account best-effort while online; a
`?lng=` handoff from the documentation or marketing site applies for that visit.

Column transparency and blur are set on the board itself, from the column
appearance menu in the board view.

## Offline use and installing the app

Janosik is installable as a web app. It ships a manifest that requests a
standalone window and a service worker that caches the app shell and its
hashed files, so the app opens while you are offline. Use your browser's own
install option to add it; the app has no separate install button.

The cached app shell can open offline, but loading boards and saving changes
require a connection. Previously loaded data remains visible in an open tab.
Offline edits are not saved, and reloading loses unsaved changes.

## Data and backups

The data menu in the header manages your data.

![The data menu: export, import, a manual copy, the card archive and automatic backups.](/screens/data-menu.png)

- `Export JSON` downloads all your boards as `janosik-boards.json`. A file
  above 25 MB is refused with advice to use `pg_dump` (the same limit applies
  to a single server board export), so an export can always be imported back.
- `Import JSON` reads a Janosik export and adds the imported boards to your
  account. Server mode imposes no 10-board product limit; an operator may set
  `MAX_BOARDS_PER_USER` in the environment, and an import above that cap is
  rejected without creating anything.
- `Save a copy now` writes a backup copy straight away.
- `Automatic backups` opens the list of copies the app kept on its own while
  you worked. From there you can restore a copy or delete it. Restoring takes
  a safety copy of the current state first.
- `Card archive` opens the active board's archived cards. Search and select
  cards across pages to restore them to a column or delete them. Select all
  applies to all search results; the restore destination must allow every
  selected card and have enough capacity. Deletion asks for confirmation.
  Selected cards disappear from the archive immediately while the operation
  runs in the background. Keep Janosik open until it finishes; if it stops,
  cards that were not processed appear again.

![The card archive: archived cards of the active board, with restore and delete.](/screens/archive.png)

`Save a copy now` and `Automatic backups` belong to the local mode (the no-API build the tests use). In
the shipped server mode your boards live in the database and are not mirrored
into the browser. **Janosik does not create, schedule or verify server
backups.** Running `pg_dump` and copying the uploads volume is an operator
task (see the runbooks).

### Your data and account

The account panel has a **Data & privacy** section:

- `Prepare a copy` queues a personal JSON bundle (profile, comments, activity,
  attachment metadata and full envelopes of boards where you are an ADMIN or
  MEMBER; boards you can only view are not copied). `Download` appears when
  the bundle is ready and stays valid for seven days. One export can be pending
  at a time; the bundle is capped at 50 MB. This file is for your records and
  cannot restore your account. To transfer boards, use `Export JSON` and
  `Import JSON` in the data menu described above. Attachment files are not included.
- `Delete account` disables the account immediately, revokes sessions and API
  keys and schedules permanent erasure after seven days. A password account
  confirms with its current password; an OAuth-only account requests a
  one-time email code and supplies the current OAuth-issued access token as
  proof. A new request always restarts the seven-day window. Once it passes the
  data cannot be recovered.

### The data-safety banner

When local storage is at risk, a banner appears above the header.

- `Data is not being saved` — storage refused the last write. The banner
  cannot be dismissed; its action downloads a backup of what is still in
  memory. It clears when a write succeeds again.
- `Storage is almost full` — saving still works, but the data is near the
  storage limit. Download a backup and delete boards you no longer need.
- `Saved data was damaged` — the stored data could not be read. You can
  download the damaged copy or restore an automatic backup.
