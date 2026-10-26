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
[Security checklist](runbooks/#security-checklist). The short version:

- Serve the app over HTTPS and keep `COOKIE_SECURE=true`.
- Set `ALLOW_REGISTRATION=false` after your first account exists.
- Use a strong, unique `JWT_SECRET`; never reuse the example value.
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

A global per-client limit runs at `THROTTLE_LIMIT` requests per minute
(default 300). The `/health` probe is exempt. Individual auth routes add
tighter windows on top, and the public share contour has its own per-token
budget. The exact windows are in the [API reference](api/#rate-limits). A
rejection answers `429`.

### Security headers and CSP

Every response runs through helmet. The content security policy is tuned for
the app shell: `script-src` and `style-src` are `'self' 'unsafe-inline'`,
`img-src` is `'self' data: blob:`, `media-src` is `'self' blob:`,
`connect-src` is `'self'`, `worker-src` is `'self' blob:`, and `font-src` is
`'self' data:`. `upgrade-insecure-requests` is dropped so a plain-HTTP
self-host works. Public share pages relax `frame-ancestors` so `?embed=1` can
be embedded, and stay `noindex`.

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

## Notes on the architecture

- The board model is edited through a command log with server-side strict
  validation. The client is never trusted with identity or inverse commands.
- Markdown surfaces (card descriptions and comments) run through a hardened
  renderer. Keep dependencies up to date.
- Access is role-based per board (ADMIN, MEMBER, VIEWER), plus a separate
  master-account contour for the platform admin panel with its own audience,
  cookies and refresh table.
