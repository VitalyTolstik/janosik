---
title: Security
description: How to report a vulnerability, supported versions, the hardening checklist, and the security controls the server implements.
---

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them privately
through GitHub's private vulnerability reporting (Security, then Advisories,
then "Report a vulnerability") on the repository.

Include, as far as you can:

- a description of the issue and its impact;
- steps to reproduce, such as a minimal request and response or a repro repo;
- the version or commit you tested, and your deployment shape (HTTPS, behind a
  proxy, single instance).

The maintainer aims to acknowledge within a few days and to ship a fix or
mitigation for confirmed issues as soon as practical. Please give a reasonable
window to release a fix before any public disclosure.

## Supported versions

Janosik is self-hosted and shipped as container images and from `main`. Only
the latest release and `main` receive security fixes.

## Hardening checklist for self-hosters

The operational checklist lives with the other runbooks:
[Security checklist](/docs/runbooks/#security-checklist). The short version:

- Serve the app over HTTPS and keep `COOKIE_SECURE=true`.
- Set `ALLOW_REGISTRATION=false` after your first account exists.
- Use a strong, unique `JWT_SECRET`; never reuse the example value.
- Replace the example `POSTGRES_PASSWORD`: the container refuses to start
  while it is still `change-me`.
- Put a TLS-terminating reverse proxy in front and set `TRUST_PROXY=1`.
- Keep the database and uploads volume backed up.

## Security controls the server implements

### Refresh cookie

The refresh token never appears in a response body. It rides an httpOnly cookie
named `refresh_token`, scoped to path `/api/v1/auth` with `SameSite=Strict`.
The `Secure` attribute follows `COOKIE_SECURE` (auto: on in production, off
elsewhere). Over plain HTTP a browser silently drops a `Secure` cookie, which
is why the boot guard below exists.

The master-account contour uses its own cookie, `admin_refresh_token`, scoped
to `/api/v1/admin/auth`, with a separate JWT audience (`janosik-admin`) and a
separate `typ` claim. A user token never authenticates an admin route, and an
admin token never authenticates a user route.

### Password hashing

Passwords are hashed with argon2id, both for user accounts and for master
accounts created by the CLI. Response shapes never include password or token
hashes.

### Personal API keys

A personal API key (`jnk_…`) acts as its owner for board work, but it cannot
manage the account's credentials. Listing, creating and revoking keys,
changing the password and changing the email all require a browser session; a
key on those routes gets `403` with `code: "pat_forbidden"`. A key leaked
through a log line or a prompt-injected agent therefore cannot mint a
longer-lived key, lock the owner out or move the account to another mailbox.

Changing the password revokes every API key of the account, so the "I think
something leaked" button covers keys as well as sessions. A key created
through the API without an expiry gets 90 days; only an explicit `null` (the
app's `Never` choice) makes it permanent. Only the key's sha256 hash is
stored.

### Account ownership and email verification

An unconfirmed email address proves nothing, so the server does not hand it
anything addressed to that mailbox:

- **OAuth sign-in into an unverified account.** When someone signs in with
  Google or Yandex and an account with the same address exists but never
  confirmed its email, the server first wipes that account's credentials:
  the password is removed, every session and API key is revoked, and pending
  confirmation codes are deleted. Only then is the account linked and marked
  verified. Whoever registered the address earlier, without owning the
  mailbox, loses all access. This closes the pre-account-takeover path.
- **Invitations.** Invitations wait for the email to be confirmed: an
  unverified account sees none and cannot accept one.
- **No account enumeration.** Inviting an address answers the same way
  whether or not an account exists for it, and the login backoff is keyed by
  address whether or not an account exists.

### Boot guard on HTTP

In production, if `PUBLIC_ORIGIN` is not HTTPS while the refresh cookie is
`Secure`, the API refuses to start rather than silently drop the cookie:

```
Refusing to start: NODE_ENV=production but PUBLIC_ORIGIN is not HTTPS (...)
```

The full message explains the 15-minute logout trap and offers
`COOKIE_SECURE=false` as an explicit opt-out. When that opt-out is set in
production, the server logs a loud warning instead. The guard is a no-op
outside production, so dev and e2e over plain HTTP are untouched.

### Rate limits

A global limit runs at `THROTTLE_LIMIT` requests per minute (default 300) per
principal: the user for a signed-in session, the key for a personal API key,
and the client IP for anonymous traffic. The `/health` probe is exempt. With
`REDIS_URL` set the counters are shared by every node. Individual auth routes
add tighter windows on top, and the public share contour has its own
per-token budget. The exact windows are in the
[API reference](/docs/api/#rate-limits). A rejection answers `429`.

User sign-in also backs off per account. From the fifth failed password for
one address, that address is locked for 30 seconds, and the lock doubles with
each further failure up to 15 minutes. A locked login answers `429` with
`code: "login_backoff"` and `retryAfter` in seconds; a successful login
clears it. This stops a distributed guesser that spreads attempts over many
IPs.

### Request size

A JSON body is capped at 256 KB, so an unauthenticated request cannot make
the server buffer and parse megabytes. Only board import and the command
endpoints accept up to 5 MB, and one command is capped at 2 MB. File uploads
have their own limits (25 MB per attachment, 2 MB per avatar).

### Security headers and CSP

Every response runs through helmet. The content security policy is tuned for
the app shell: `script-src` is `'self'` plus a `'sha256-…'` hash for each
inline script of the served frontends, `style-src` is `'self' 'unsafe-inline'`,
`img-src` is `'self' data: blob:`, `media-src` is `'self' blob:`,
`connect-src` is `'self'`, `worker-src` is `'self' blob:`, and `font-src` is
`'self' data:`. `upgrade-insecure-requests` is dropped so a plain-HTTP
self-host works. Public share pages relax `frame-ancestors` so `?embed=1` can
be embedded, and stay `noindex`.

`script-src` has no `'unsafe-inline'`. At startup the server reads the HTML
files in `STATIC_DIR` and `SITE_DIR`, hashes every inline script it finds,
and allows exactly those, so an injected inline script is refused. The hashes
are computed once per process: after rebuilding the frontend outside the
image, restart the API, or the browser blocks the new inline scripts. The
container image does this on every deploy anyway.

### Master account lockout

The master login locks an account after five wrong passwords for 15 minutes. A
leaked password cannot be brute-forced. Every login attempt and mutation writes
an audit row, visible on the panel's audit page.

### Two-factor authentication and IP allowlist

Two-factor authentication exists only on the master-account login: the admin
login body accepts an optional `totpCode`. The master panel's security page at
`/admin/security` reports whether TOTP is enabled, the configured IP allowlist,
and a list of suspicious-activity alerts. Enabling or disabling TOTP and
changing the allowlist are recorded in the audit trail. User accounts have no
second factor; the 6-digit codes for email confirmation and email change are
out-of-band confirmations, not login factors.

A master's IP allowlist is enforced on every admin request and on every
session refresh, not only at sign-in, so a token or refresh cookie carried off
an allowed network stops working elsewhere with `403`. Saving a list that
does not include your own current address is refused with `400`, so you
cannot lock yourself out mid-session.

### Realtime streams

A board's SSE stream re-checks its caller on every 25-second keep-alive tick,
not only when it opens. It closes when the membership is removed or a
viewer's access expires, the account is disabled, the board is deleted, or
the API key it was opened with is revoked or expires. A public live-share
stream closes the same way once the share is revoked or expires.

### Container

The image starts as root only long enough to hand the uploads volume to the
unprivileged `node` user, then runs migrations, the API and ffmpeg as `node`.
It refuses to start while `POSTGRES_PASSWORD` is the example `change-me`, and
it logs a warning at start while `ALLOW_REGISTRATION` is `true` (the default).

## Notes on the architecture

- The board model is edited through a command log with server-side strict
  validation. The client is never trusted with identity or inverse commands:
  the validator rebuilds each action from an allow-list, keeps inverse-only
  fields only on undo commands, and the server replaces a command clock more
  than five minutes off its own.
- Snapshot share links serve only the comments and attachments that existed
  when the snapshot was captured.
- Markdown surfaces (card descriptions and comments) run through a hardened
  renderer. Keep dependencies up to date.
- Access is role-based per board (ADMIN, MEMBER, VIEWER), plus a separate
  master-account contour for the platform admin panel with its own audience,
  cookies and refresh table.
