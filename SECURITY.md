# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Report them
privately via GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
(Security → Advisories → "Report a vulnerability") on the repository.

Include, as far as you can:

- a description of the issue and its impact;
- steps to reproduce (a minimal request/response or a repro repo);
- the version/commit you tested, and your deployment shape (HTTPS? behind a
  proxy? single instance?).

We aim to acknowledge within a few days and to ship a fix or mitigation for
confirmed issues as soon as is practical. Please give us a reasonable window
to release a fix before any public disclosure.

## Supported versions

Janosik is self-hosted and shipped as container images and from `main`. Only
the latest release (and `main`) receives security fixes.

## Hardening checklist for self-hosters

- Serve the app over **HTTPS** and keep `COOKIE_SECURE=true` (the default).
  The refresh cookie is `httpOnly Secure SameSite=Strict`; over plain HTTP a
  browser silently drops it, and the API refuses to boot in that combination
  unless you explicitly opt out with `COOKIE_SECURE=false`.
- Set `ALLOW_REGISTRATION=false` after creating your first account (or toggle
  "Open registration" off in the master panel).
- Set a strong, unique `JWT_SECRET` (`openssl rand -hex 32`). Never reuse the
  example value.
- Put the app behind a reverse proxy that terminates TLS and set
  `TRUST_PROXY=1` so rate limiting and the audit log see real client IPs.
- Keep the database and uploads volume backed up (`pg_dump` plus the JSON
  export in the master panel).

## Notes on the architecture

- The board model is edited through a **command log** with server-side strict
  validation; the client is never trusted with identity or inverse commands.
- Markdown surfaces (card descriptions and comments) run through a hardened
  renderer; a past XSS vector in the rich-text editor is tracked in the
  changelog and covered by tests. Keep dependencies up to date.
- Access is role-based (ADMIN / MEMBER / VIEWER) per board, plus a separate
  master-account contour for the platform admin panel with its own audience,
  cookies and refresh table.
