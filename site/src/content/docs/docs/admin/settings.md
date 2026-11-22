---
title: Email, security and operations
description: The email service, OAuth login, security, traffic, the demo swarm, operations, communications, observability, and the user-facing announcements banner.
---

:::note
These pages are now tabs of the **Settings** hub (`/app/admin/settings?tab=…`).
Communications and announcements moved to the **Communications** hub, and
public shares are its third tab. Old URLs redirect. See
[Admin redesign](../redesign/).
:::

The settings and operations pages configure the platform and run its
maintenance. Writes on these pages are owner-only on the server; an operator
sees the state read-only.

## Email service

`/app/admin/settings?tab=email` configures the outgoing mail transport. The subtitle is
`Outgoing mail, pick a provider, enter credentials, no code changes needed`.
Saving Email settings updates the transport in the process handling the
request. Other API and queue-worker processes apply the saved enabled
configuration at startup. Restart those processes after a change and keep
their SMTP environment and credential encryption key aligned.
A disabled saved row leaves the environment bootstrap in effect on startup.
For a cluster-wide disable, clear the SMTP environment on every process before
restarting them.

### Status

A status banner reports where the active transport comes from:

| State | Meaning |
| --- | --- |
| `Delivery is active via {provider} ({host}:{port}).` | saved email delivery settings are active |
| `Delivery is active via the server's SMTP_* env bootstrap` | SMTP settings from environment variables are in use |
| `Delivery is off` | settings are saved, but delivery is disabled |
| `Delivery is not configured` | emails are written to the server log |

When a probe has run, the last test result and its time are shown.

### Providers

Pick one provider preset; the host, port and TLS come from the preset.

| Provider | Host | Port | TLS |
| --- | --- | --- | --- |
| Gmail | `smtp.gmail.com` | 465 | implicit TLS |
| Yandex | `smtp.yandex.ru` | 465 | implicit TLS |
| Mail.ru | `smtp.mail.ru` | 465 | implicit TLS |
| Brevo | `smtp-relay.brevo.com` | 587 | STARTTLS |
| SendGrid | `smtp.sendgrid.net` | 587 | STARTTLS, username `apikey` |
| Custom SMTP | your own | 587 | editable |

`Custom SMTP` keeps the host, port and implicit-TLS fields editable. The port
must be between 1 and 65535 and the host is at most 255 characters.

### Fields

| Field | Notes |
| --- | --- |
| From address | required except for the sandbox; at most 255 characters |
| SMTP username | required except for the sandbox; at most 255 characters |
| SMTP password | blank keeps the stored password; at most 1024 characters |
| Enable delivery | the on/off switch |

The password semantics are: blank keeps the stored secret, a value replaces
it. The secret never leaves the backend; the page only knows whether one is
stored. Providers require an app password or API key instead of the account
password, and a help link points at the provider's instructions.

### Test delivery

The test panel sends a test email to the specified address. The outcome is returned and
recorded. When delivery is off, the test email is written to the server log instead
and the panel says so. If sending fails, the error message is shown.

### Sandbox

The `Mailpit (sandbox)` test provider is a local mail catcher that never
reaches real inboxes. It points at a Mailpit sidecar on the host: SMTP
`localhost:1025`, web inbox `http://localhost:8025`. No credentials are needed.
A sandbox panel then offers `Open the inbox`. Test emails appear in the local
web inbox, which is available only on the same machine.

## OAuth login

`/app/admin/settings?tab=oauth` configures sign-in through external providers. The subtitle is
`Sign-in through external providers (Google, Yandex)`. The client secret never
leaves the backend; a blank field keeps the stored one.

Two providers are supported:

| Provider | Status field |
| --- | --- |
| Google | Enabled or Disabled |
| Yandex | Enabled or Disabled |

Each provider panel has:

| Field | Notes |
| --- | --- |
| Client ID | required, at most 255 characters |
| Client secret | blank keeps the stored secret; at most 255 characters |
| Callback URL | shown read-only, register it in the provider console |
| Enable sign-in | the on/off switch |

The callback URL is derived from the public origin. Saving updates the sign-in
screen the moment it succeeds: the button appears when the provider is enabled.

## Security

`/app/admin/settings?tab=security` manages the signed-in master’s security settings. The scope note
reads: these settings apply only to your own master account, and regular users
are not affected.

### Two-factor authentication

| Control | Effect |
| --- | --- |
| Enable 2FA | starts enrollment and shows a base32 secret and an `otpauth://` URL |
| Confirm | finishes enrollment with a six-digit code |
| Disable 2FA | turns it off; requires a valid code |
| Replace authenticator | issues a new secret; while 2FA is active this requires the current code or the account password and is written to the master audit log |

The secret is stored encrypted. The TOTP is SHA-1, six digits, a 30-second
period, verified inside a one-step window. Once enabled, the login flow
requires the code after the password.

A replacement is staged: the new secret becomes active only after `Confirm`
accepts a code from it and the short-lived setup ticket returned by the
enrollment call, so a lost response cannot invalidate the working factor. The
ticket is bound to the active factor state and is single-use; a newer
**confirmed** enrollment or replacement, a disable or an already-consumed
ticket answers `409 setup_stale`. Staging another secret writes nothing, so it
does not invalidate the first ticket by itself. The current code is checked
without consuming its step. A successful replacement is audited as
`security.totp_replaced`; first enrollment remains `security.totp_enabled`.

First enrollment (while 2FA is off) starts from an authenticated master
session without asking for a second proof. A stolen live master session can
therefore enroll its own authenticator before the owner does; this is a known
residual. Enabling 2FA immediately after account creation and keeping master
sessions short are the mitigations. Once a factor is active, replacing it
always requires the current code or the account password.

### IP allowlist

The allowlist is a comma- or space-separated list of IPs and CIDR ranges. An
empty list allows any address. Exact IPv4/IPv6 addresses and IPv4/IPv6 CIDR
ranges are supported. The list is trimmed and de-duplicated on save. An
operator can view their own list here but only an owner can change it.

To manage another master's list, open **Masters**, choose **IP access** in that
master's action menu, and save the addresses or ranges. Changes take effect on
their existing sessions immediately and are recorded in the audit log.

The list is enforced on every request of the master's session and on every
refresh, not only at sign-in. When editing your own list, saving a list that
does not include your current address is refused, so you cannot lock yourself
out mid-session. Another master's list does not need to include your address. Behind a
reverse proxy, set `TRUST_PROXY` so the server sees the real client address.

### Suspicious activity

The alerts feed shows up to 50 groups from the last 24 hours, including failed
sign-ins, lockouts and IP restrictions on sign-in, session renewal and requests.
Each line shows the reason, stage, account, IP address and most recent time;
unavailable account or IP information is marked as unknown. Repeated events
with the same account, IP, reason and stage are grouped per minute, with a count
and the first occurrence time. Older events are available in the audit log,
subject to audit retention. Changes to an IP allowlist are recorded separately
in the audit log with the author and target master.

## Traffic and rate limit

`/app/admin/settings?tab=traffic` shows the live API request rate and the global rate limit.
The subtitle is `Live API request rate and the global rate limit`.

Three values are shown and polled once a second while the page is visible:

| Value | Meaning |
| --- | --- |
| Requests / minute | requests observed in the last 60 seconds |
| Rejected (429) / minute | requests rejected by the rate limiter in the last 60 seconds |
| Rate limit | the limit currently enforced |

A chart plots requests per second over the last 60 seconds, oldest first.

The limit editor is a number stepper from 1 to 1,000,000. A source badge says
whether the limit is `set in this panel` or `from environment (THROTTLE_LIMIT)`.

The limit takes effect on the next request handled by the process that saved
it. Other running nodes keep their current limit until restart, even when Redis
shares the request counters. Restart the remaining API nodes to apply the
persisted limit across the deployment.
Only the owner can edit the limit. Operators have read access.

## Demo swarm

`/app/admin/settings?tab=demo` starts a swarm of AI agents on a throwaway board, watches them
work, then cleans up. The subtitle is `Seed a demo board of AI agents, watch
them work, then clean up`.

Three counters move on their own while a run is live: Agents, Cards and Done.
The board row shows the run's board id and, when a live share exists, an
`Open live view` link to `/s/<token>` and a `Copy share link` button.

Owner-only inputs:

| Input | Range | Notes |
| --- | --- | --- |
| Board id | optional | empty creates a dedicated demo board |
| Agents | 1 to 100 | |
| Tasks | 1 to 1000 | cards to seed |

The demo needs the live observation link, so it is unavailable while public
sharing is disabled (`public_shares` off / `ALLOW_PUBLIC_SHARES=false`). A
start attempt answers `409 public_shares_disabled` before any demo users or
board rows are created.

Saving a Board id targets an existing board. Starting the demo publishes a
live observation link that includes the board's existing content and
comments. Anyone with the link can read them while it is active.

`Start demo` records the generated IDs before provisioning, then creates the
users and cards and starts the scenario. `Stop & clean up` and startup
cleanup use those IDs and remove the observation link. The selected existing
board and user-created data are preserved, including links to demo cards
and any demo rows those links need. A dedicated demo board is deleted only
if it is empty after cleanup. If a dedicated board or demo account is kept
by other rows, the run stays pending and the operator can retry. Interrupted
starts can also be cleaned up. A provided-board run can finish cleanup with
recorded demo rows still needed by user-created data. After the run is
marked stopped, those rows remain for manual board maintenance. Older runs
use surviving creation commands for child IDs absent from their records.

Behind the scenes the runner creates a dispatcher and the requested agents on
the reserved `@janosik.demo` domain, the five flow columns (Новые, В работе,
На ревью, Тестирование, Готово), a label set and one card per requested task, then
drives the cards across the flow. Board titles, task names and email suffixes
are display conventions.

## Operations

`/app/admin/settings?tab=general` is the runtime control panel. The subtitle is `Flags,
maintenance, rate limits and data retention`. All controls are owner-only.
The live global traffic limit and SMTP transport are process-local. Their
settings apply immediately to the process that handled the save. Restart the
remaining API nodes for the global limit and the remaining API and mail worker
processes for SMTP. The [Email service](#email-service) section explains how
SMTP environment variables and the credential encryption key affect startup.

### Feature flags

| Flag | Description | Default source |
| --- | --- | --- |
| `registration_open` | allow password sign-up when SMTP or one-time bootstrap is available | env `ALLOW_REGISTRATION` |
| `public_shares` | allow read-only public links to boards | env `ALLOW_PUBLIC_SHARES` |
| `video_transcode` | re-encode uploaded videos to a compact MP4 | on |
| `realtime_sse` | stream live board changes over SSE; off closes open streams and answers `404` on the SSE routes | on |

Each flag has a toggle. When a flag has per-user overrides, their count is
shown. The effective value for a user is the per-user override when present,
otherwise the global switch, otherwise the environment default. Flags apply at
request time.

### Maintenance mode

The maintenance toggle takes an optional message (at most 500 characters).
When on, every user request is answered `503` with the message; the panel and
the sign-in stay open, so an owner can switch it off.

### Rate limit

The per-user limit is a number stepper from 1 to 100,000 requests per minute.
An empty value disables it, leaving only the global IP limit. The limit applies
to every account equally, each with its own counter. Routes under `/api/v1/admin`,
`/api/v1/auth` and `/api/v1/health` are exempt.

### Soft-deleted data and retention

The retention window is the number of days before the purge may remove
soft-deleted rows (1 to 3650, default 30). The page offers the 30/90/365
presets and shows how many cards, comments, attachments and columns are
currently eligible. Once the panel is ready, the counts follow the number in
the field, including an unsaved draft (`GET /api/v1/admin/retention?retentionDays=365`).
While that request is pending the page shows a loading state; if it fails it
shows an error with Retry and keeps Purge disabled. It does not present stale
counts or an unconfigured backup status as the current answer. The same window
applies to the command log, activity
feed, ended agent sessions and approvals past their decision or apply window.
Age runs from the session end, the rejection or cancellation decision,
the approval expiry or the time it was consumed. Housekeeping marks overdue
pending requests expired across all boards. An approved request keeps its
decision and becomes eligible for removal after the retention window from
expiry. Open sessions and requests still within their decision or apply
window are kept until they become eligible or the board is purged. `AdminAuditLog` and `SecurityAuditLog` use
`AUDIT_RETENTION_DAYS` (365 by default).

Comment edit history has its own per-comment window: the newest 50 revisions
are kept. Older rows and the Activity copies that belong to them are removed
together, and the comment is marked `revision_limit`; a comment whose history
is incomplete for any reason (`legacy_cutover`, `revision_limit`, `gdpr_erase`
or `writer_gap`) keeps that reason until a more severe one replaces it. The raw
UTF-8 text budgets are 4,000,000 bytes (4 MB) in revisions and 6,000,000
bytes (6 MB) in their Activity copies per
comment; they are reported, not enforced by deleting a live chain. A normal
`sweep-activity` run may remove old Activity before the revisions, which is
safe: revisions are independent. `sweep-comment-history` reconciles a comment
written by an older release, adopts its current text as the new verified
point, strips post-cutover Activity text that no revision backs and preserves
the confirmed revisions and the monotonic number. Hard purge and GDPR erase
remove revisions and their Activity explicitly; GDPR exports never include
them. Metrics and logs count rows and bytes only and never contain comment
text.

The backup line is deliberately honest: `BACKUP_DIR` is only a location you
configured, not a backup Janosik creates. The API reports
`{mode, automatic: false, lastBackupAt: null, verified: false}` and the UI says
that Janosik neither creates, schedules nor verifies backups. Use `pg_dump`
and back up the uploads volume yourself.

`Purge now` permanently deletes boards and other data soft-deleted before
the retention cutoff. The confirmation always uses the window currently
visible in the field, and the request carries it explicitly
(`POST /api/v1/admin/retention/purge` with `{ "retentionDays": 365 }`); the
server validates the value (1 to 3650) instead of silently reading the last
saved setting. Saving the field changes the default for the scheduled sweep
and for clients that omit `retentionDays`. Purging a board also deletes all
of its agent sessions and approval requests, regardless of age or status. The
action requires confirmation.

### Scheduled housekeeping

The sweep interval is in minutes (0 to 10,080; 0 disables the schedule;
default 60). `Run sweeps now` runs the whole set immediately. The named sweeps
are:

| Sweep | Removes |
| --- | --- |
| `purge-soft-deleted` | soft-deleted rows past the retention window, including whole boards with their agent sessions and approvals |
| `sweep-codes` | expired or consumed verification and email-change codes |
| `sweep-tokens` | expired or long-revoked refresh tokens (user and admin) |
| `sweep-shares` | board shares past their TTL or revoked over a day ago |
| `sweep-invitations` | lapsed pending invitations |
| `sweep-exports` | expired background data exports and their files |
| `sweep-commands` | command-log rows past the retention window |
| `sweep-agent-sessions` | agent sessions that ended before the retention cutoff |
| `sweep-approvals` | marks overdue pending requests expired, then removes rejected, cancelled, expired, lapsed approved and consumed requests past the retention window |
| `sweep-reminders` | stale due-reminder dedupe rows |
| `sweep-comment-history` | reconciles old-writer comment chains, marks `writer_gap`, adopts the current text and strips unconfirmed Activity snapshots |
| `sweep-activity` | membership/comment feed rows past the retention window |
| `sweep-audit` | master audit-log rows older than `AUDIT_RETENTION_DAYS` |
| `sweep-security-audit` | `SecurityAuditLog` rows older than `AUDIT_RETENTION_DAYS` (deletion lifecycle and `board.cleanup_failed` markers are kept) |
| `sweep-accounts` | accounts whose seven-day self-service deletion window elapsed (still disabled) |
| `sweep-unverified-users` | abandoned registrations that never confirmed their e-mail, accepted a membership or wrote content (older than `UNVERIFIED_ACCOUNT_TTL_DAYS`); releases the address |
| `sweep-orphan-boards` | retries soft-deletion of boards left behind by an account erase (pending invites do not count) |
| `sweep-orphan-blobs` | blobs no row points at (and abandoned `.tmp-*` files), older than a one-hour grace window |
| `sweep-idempotency` | `IdempotencyRecord` rows past their 24-hour expiry |

API processes reconcile Redis schedules at startup and every 30 seconds.
Missing schedules and settings changes are repaired after Redis recovers.
With Redis unset, maintenance and mail schedules use in-process timers. The
30-second reconciliation also retries failed settings reads on this path and
keeps the next tick when cadence is unchanged. These timers start over on restart.

### Scheduled email

Two recurring jobs run from here. The digest interval is in hours (0 to 720; 0
disables it). The due reminder lead is in hours (0 to 720; 0 disables it).
Recipients can opt out of both. The digest summarises what changed on each
board since the last run. The reminder lists the cards assigned to a user whose
due date falls inside the lead window. Each reminder is sent once per card,
user and due date. Reminders use the recipient's saved locale (EN or RU), with
English as the default. A grouped reminder can be canceled if the recipient
opts out or loses access to any board in the letter. The card, user and due-date
markers remain reserved, so restoring access or opting back in does not requeue
that reminder for the same due date.

Scheduled and immediate notification letters are staged in PostgreSQL. Queued
letters stay pending while SMTP is disabled. Transient failures retry with
backoff and stop after eight attempts. A permanent SMTP 5xx reply stops
delivery immediately. Terminal failures are logged and their delivery records
are pruned according to the retention window. Attention email and digest
timestamps record SMTP acceptance.

### Queue dashboard

When the queue dashboard is enabled, an `Open queue dashboard` button opens
`/api/v1/admin/queues` in a new tab. It inspects and retries background jobs
(Bull Board). It is owner-only and requires Redis.

## Communications

`/app/admin/communications?tab=announcements` composes broadcasts and edits the mail templates. The subtitle
is `Announcements, mail and templates`. Writes are owner-only.

### Announcements

`New announcement` opens the bilingual editor:

| Field | Notes |
| --- | --- |
| English / Russian tabs | one logical announcement, one text per language |
| Source language | the original version; used as the fallback text |
| Title | at most 200 characters per language |
| Body | at most 2000 characters per language |
| If a translation is missing | `Require both languages` (default) blocks publishing until EN and RU exist; `Allow one language with a notice` publishes the source and shows every other viewer an explicit "available only in …" notice |
| Level | `Info`, `Warning` or `Alert` |
| Audience | all users or selected users |
| Recipients | for selected users, an autocomplete over the user directory |
| Also send by email | queues a localized letter to the recipients' inbox |
| Schedule | optional start and end times for the banner |

The editor shows completeness per language and a banner/email preview for both
audiences. `Save draft` stores an unfinished announcement. `Publish` applies
the selected policy. With SMTP enabled on the publishing process, the
letter is staged on active creation or on the first eligible draft → active
transition. `Email queued` records staging in PostgreSQL. With SMTP disabled,
the banner still publishes and no mail is staged. Restoring SMTP alone does
not queue that announcement.

Redis dispatch and SMTP delivery happen afterward. With Redis unset, the API
process dispatches directly. Each recipient is retried independently. The
worker skips accounts that have since been disabled or deleted or whose address
changed. Editing an active announcement updates the banner. To email a previous
announcement with no queued mail, return it to draft and publish with SMTP enabled.
If the banner start is in the future, the editor warns that saving queues the
letter immediately.

Announcement text is part of the product communication, not board data, so it
is translated. Every banner is rendered in the viewer's language. If a
translation is missing under the fallback policy, the original text is shown
with a localized notice and the correct `lang` attribute for screen readers.
Email is sent per recipient in their language, with the same notice in the
subject and body when the translation is missing. Accounts without a stored
language adopt the current interface language once after sign-in (unless a
`?lng=` handoff is present); the save is best-effort while online. Stored
accounts keep their chosen language across devices.

### One-off email

The send-email panel takes a recipient, a subject (at most 200 characters) and
a message body (at most 20,000 characters). The outcome is returned and the
send is audited.

### Email templates

Five templates are editable:

| Key | Label |
| --- | --- |
| `verification_code` | Email verification code |
| `email_change_code` | Email change code |
| `email_changed_notice` | Email changed notice |
| `digest` | Board digest |
| `due_reminder` | Due-date reminder |

Each template has a subject and an HTML body. Placeholders are shown as
`{{name}}`. `Preview` renders the email with sample values in an iframe.
`Save` stores an override and marks the template `custom`; `Reset to default`
drops the override so the default template is used again. With no override the
built-in letter is shown, so the editor is never empty.

### Announcement history

The full announcement history is at `/app/admin/communications?tab=history`. The
subtitle is `{total} broadcasts, the full announcement history`.

| Column | Value |
| --- | --- |
| Title | the source (or legacy) title |
| Message | the body |
| Languages | filled `EN`/`RU` chips, or `Legacy` when the language is unknown |
| Policy | `EN+RU` for strict, `Fallback` for one-language publishing |
| Level | info, warning or alert |
| Audience | all users or the segment |
| Email | an `email` badge plus `email queued`/`email pending` |
| Active | on or off |
| Created | creation time |
| Author | the creating master |

The page has a search box and status tabs (active, inactive). Search covers
every translation, not just the source text. Row actions:

| Action | Effect |
| --- | --- |
| Edit | opens the bilingual editor (tabs, policy, preview, draft/publish) |
| View | OPERATOR read-only view of the same dialog (no save actions) |
| Activate | sets `active` true |
| Deactivate | sets `active` false (the banner disappears; queued mail cannot be recalled) |
| Delete | deletes the announcement and its translations |

## Observability

`/app/admin/settings?tab=observability` shows runtime, database and job state. The subtitle is
`Runtime, database and jobs`.

- The runtime panel shows Version, Environment, Uptime, Started, Database size
  and Commit.
- The frontend panel describes the app build serving the panel: App version,
  Build, Commit, Theme, Service worker, Display and Connection.
- The jobs panel shows Transcode (pending/done/failed), Realtime
  (boards/clients) and the Demo runner (on or off).
- A queues grid shows each queue's name, pending, done and failed counts and
  its backend (`redis` or `memory`).
- The `Biggest tables` table lists up to 12 tables with row counts and sizes.
- The health panel lists `database` (`SELECT 1` and its latency), `realtime`
  (board channels) and `maintenance` (on or off).
- The `Comment history` panel reports saved revisions and their UTF-8 text
  bytes, related Activity rows and bytes, revisions beyond the latest 50
  (derived from the monotonic counter, not an exact trim-event count),
  incomplete histories broken down by `legacy_cutover`, `revision_limit`,
  `gdpr_erase` and `writer_gap`, and the number of comments over the
  4,000,000-byte revision / 6,000,000-byte Activity text budgets. It never
  collects comment text. These six aggregates scan large tables, so the
  admin-only response is cached for 30 seconds and bounded by a 10-second
  transaction timeout; on failure the panel says the metrics are unavailable
  and shows dashes instead of healthy zeros.

## The user-facing announcements banner

Active announcements reach signed-in users as a banner under the app header.
The endpoint is `GET /announcements/active`, protected by standard user
authentication, so a signed-out visitor gets nothing and a user sees only
announcements addressed to them. The banner requests the viewer's current
interface language and re-fetches when it changes.

Each banner is styled by level (info, warning, danger) and can be dismissed.
A dismissal is stored on the server per user and announcement version, so it
survives a new device, browser or session and never leaks to another account
signed in on the same browser. A dismissed announcement stays hidden until an
admin edits it: every PATCH increments its version, which shows the updated
banner again. The old device-local `janosik.announcements.dismissed` key is no
longer read. When the announcement has no translation in the viewer's
language, the fallback policy decides: strict announcements are not published
in that state, while a fallback announcement shows the original text with a
localized "This announcement is available in … only" notice.

## Where to go next

The monitoring pages are on [monitoring and logs](/docs/admin/monitoring/). People and
master management are on [users and masters](/docs/admin/people/).
