---
title: Email, security and operations
description: The email service, OAuth login, security, traffic, the demo swarm, operations, communications, observability, and the user-facing announcements banner.
---

The settings and operations pages configure the platform and run its
maintenance. Writes on these pages are owner-only on the server; an operator
sees the state read-only.

## Email service

`/admin/email` configures the outgoing mail transport. The subtitle is
`Outgoing mail, pick a provider, enter credentials, no code changes needed`.
Saving reconfigures the running backend in place, with no restart and no code
or environment change.

### Status

A status banner reports where the active transport comes from:

| State | Meaning |
| --- | --- |
| `Delivery is active via {provider} ({host}:{port}).` | a saved, enabled row |
| `Delivery is active via the server's SMTP_* env bootstrap` | the environment bootstrap is in use |
| `Delivery is off` | a saved row is kept but unused |
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

The test panel sends a probe to an address. The outcome is returned and
recorded. When delivery is off, the probe is written to the server log instead
and the panel says so. A failed probe shows the error text.

### Sandbox

The `Mailpit (sandbox)` test provider is a local mail catcher that never
reaches real inboxes. It points at a Mailpit sidecar on the host: SMTP
`localhost:1025`, web inbox `http://localhost:8025`. No credentials are needed.
A sandbox panel then offers `Open the inbox`. Letters land in the local web
inbox, which runs on the same machine only.

## OAuth login

`/admin/oauth` configures sign-in through external providers. The subtitle is
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

`/admin/security` manages the signed-in master's own posture. The scope note
reads: these settings apply only to your own master account, and regular users
are not affected.

### Two-factor authentication

| Control | Effect |
| --- | --- |
| Enable 2FA | starts enrollment and shows a base32 secret and an `otpauth://` URL |
| Confirm | finishes enrollment with a six-digit code |
| Disable 2FA | turns it off; requires a valid code |

The secret is stored encrypted. The TOTP is SHA-1, six digits, a 30-second
period, verified inside a one-step window. Once enabled, the login flow
requires the code after the password.

### IP allowlist

The allowlist is a comma- or space-separated list of IPs and CIDR ranges. An
empty list allows any address. An exact string match or an IPv4 CIDR match
passes. The list is trimmed and de-duplicated on save. It is owner-only: an
operator cannot restrict their own sign-in origin.

The list is enforced on every request of the master's session and on every
refresh, not only at sign-in. Saving a list that does not include your current
address is therefore refused with `400` (`The allowlist must include your
current address (…)`), so you cannot lock yourself out mid-session. Behind a
reverse proxy, set `TRUST_PROXY` so the server sees the real client address.

### Suspicious activity

The alerts feed lists failed and locked sign-ins from the last 24 hours, up to
50 rows. Each line shows a `locked` or `failed sign-in` badge, the master
email, the IP and the time.

## Traffic and rate limit

`/admin/traffic` shows the live API request rate and the global rate limit.
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
Saving takes effect on the next request, without a restart. The limit is
owner-only; an operator sees it read-only.

## Demo swarm

`/admin/demo` starts a swarm of AI agents on a throwaway board, watches them
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

`Start demo` provisions the population and starts the swarm. `Stop & clean up`
is enabled while a run's footprint still exists; it is confirmed and deletes
exactly the recorded rows: the board when the run created it, its cards, its
demo users and its share.

Behind the scenes the runner creates a dispatcher and the requested agents on
the reserved `@janosik.demo` domain, the five flow columns (Новые, В работе,
На ревью, Тестирование, Готово), a label set and one card per agent, then
drives the cards across the flow. Every id it creates is recorded, so cleanup
never guesses by name.

## Operations

`/admin/ops` is the runtime control panel. The subtitle is `Flags,
maintenance, rate limits and data retention`. Every control writes through and
takes effect without a restart. All controls are owner-only.

### Feature flags

| Flag | Description | Default source |
| --- | --- | --- |
| `registration_open` | allow anyone to create a new account | env `ALLOW_REGISTRATION` |
| `public_shares` | allow read-only public links to boards | env `ALLOW_PUBLIC_SHARES` |
| `video_transcode` | re-encode uploaded videos to a compact MP4 | on |
| `realtime_sse` | stream live board changes over SSE | on |

Each flag has a toggle. When a flag has per-user overrides, their count is
shown. The effective value for a user is the per-user override when present,
otherwise the global switch, otherwise the environment default. Flags apply at
request time.

### Maintenance mode

The maintenance toggle takes an optional message (at most 500 characters).
When on, every user request is answered `503` with the message; the panel and
the sign-in stay open, so an operator can switch it off.

### Rate limit

The per-user limit is a number stepper from 1 to 100,000 requests per minute.
An empty value disables it, leaving only the global IP limit. The limit applies
to every account equally, each with its own counter. The `/admin`, `/auth` and
`/health` paths are exempt.

### Soft-deleted data and retention

The retention window is the number of days before the purge may remove
soft-deleted rows (1 to 3650, default 30). The page shows how many cards,
comments, attachments and columns are currently eligible, and the backup
location when `BACKUP_DIR` is configured.

`Purge now` permanently deletes already-deleted cards, comments, attachments
and columns older than the window. Live data is never touched. The action is
confirmed.

### Scheduled housekeeping

The sweep interval is in minutes (0 to 10,080; 0 disables the schedule;
default 60). `Run sweeps now` runs the whole set immediately. The named sweeps
are:

| Sweep | Removes |
| --- | --- |
| `purge-soft-deleted` | soft-deleted rows (and whole boards) past the retention window |
| `sweep-codes` | expired or consumed verification and email-change codes |
| `sweep-tokens` | expired or long-revoked refresh tokens (user and admin) |
| `sweep-shares` | board shares past their TTL or revoked over a day ago |
| `sweep-invitations` | lapsed pending invitations |
| `sweep-exports` | expired background data exports and their files |
| `sweep-commands` | command-log rows past the retention window |
| `sweep-reminders` | stale due-reminder dedupe rows |
| `sweep-activity` | membership/comment feed rows past the retention window |
| `sweep-audit` | master audit-log rows older than `AUDIT_RETENTION_DAYS` |
| `sweep-orphan-blobs` | blobs no row points at (and abandoned `.tmp-*` files), older than a one-hour grace window |

When Redis is configured the sweep runs on a durable schedule; without Redis it
runs inline and the schedule is lost on restart.

### Scheduled email

Two recurring jobs run from here. The digest interval is in hours (0 to 720; 0
disables it). The due reminder lead is in hours (0 to 720; 0 disables it).
Recipients can opt out of both. The digest summarises what changed on each
board since the last run. The reminder lists the cards assigned to a user whose
due date falls inside the lead window. Each reminder is sent once per card,
user and due date.

### Queue dashboard

When the queue dashboard is enabled, an `Open queue dashboard` button opens
`/api/v1/admin/queues` in a new tab. It inspects and retries background jobs
(Bull Board). It is owner-only and requires Redis.

## Communications

`/admin/comms` composes broadcasts and edits the mail templates. The subtitle
is `Announcements, mail and templates`. Writes are owner-only.

### Announcements

`New announcement` opens a dialog:

| Field | Notes |
| --- | --- |
| Title | at most 200 characters |
| Body | at most 2000 characters |
| Level | `Info`, `Warning` or `Alert` |
| Audience | all users or selected users |
| Recipients | for selected users, an autocomplete over the user directory |
| Also send by email | queues the letter to the recipients' inbox |

An announcement with `Also send by email` is shown as an in-app banner and also
emailed to the resolved recipients.

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
`{{name}}`. `Preview` renders the letter with sample values in an iframe.
`Save` stores an override and marks the template `custom`; `Reset to default`
drops the override so the built-in letter takes over. With no override the
built-in letter is shown, so the editor is never empty.

### Announcement history

The full announcement history is its own page at `/admin/announcements`. The
subtitle is `{total} broadcasts, the full announcement history`.

| Column | Value |
| --- | --- |
| Title | the announcement title |
| Message | the body |
| Level | info, warning or alert |
| Audience | all users or the segment |
| Email | an `email` badge when the letter is also emailed |
| Active | on or off |
| Created | creation time |
| Author | the creating master |

The page has a search box and status tabs (active, inactive). Row actions:

| Action | Effect |
| --- | --- |
| Edit | opens a dialog to change title, body, level, audience, segment, start and end times, active and send-by-email |
| Activate | sets `active` true |
| Deactivate | sets `active` false |
| Delete | deletes the announcement |

## Observability

`/admin/observability` shows runtime, database and job state. The subtitle is
`Runtime, database and jobs`.

- The runtime panel shows Version, Environment, Uptime, Started, Database size
  and Commit.
- The frontend panel describes the app build serving the panel: App version,
  Build, Commit, Theme, Service worker, Display and Connection.
- The jobs panel shows Transcode (pending/done/failed), Realtime
  (boards/clients) and the Demo runner (on or off).
- A queues grid shows each queue's name, pending, done and failed counts and
  its backend (`redis` or `memory`).
- The `Biggest tables` table lists up to 12 tables with rows and size.
- The health panel lists `database` (`SELECT 1` and its latency), `realtime`
  (board channels) and `maintenance` (on or off).

## The user-facing announcements banner

Active announcements reach signed-in users as a banner under the app header.
The endpoint is `GET /announcements/active`, reached through the ordinary user
auth contour, so a signed-out visitor gets nothing and a user sees only
announcements addressed to them.

Each banner is styled by level (info, warning, danger) and can be dismissed.
A dismissal is remembered per announcement in `localStorage`, so a user sees
each one once.

## Where to go next

The monitoring pages are on [monitoring and logs](/docs/admin/monitoring/). People and
master management are on [users and masters](/docs/admin/people/).
