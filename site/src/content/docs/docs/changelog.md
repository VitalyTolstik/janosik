---
title: Changelog
description: The release history and the versioning scheme.
---

## Versioning

Notable changes are documented here in the style of
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Releases are tagged
in git as `v<version>` (for example `v0.1.0`), and the container image is
published to `ghcr.io/vitalytolstik/janosik` from CI on a version tag. To run a
specific release, set `JANOSIK_TAG` in `.env` (see
[Self-hosting](/docs/self-hosting/)).

## Unreleased

### Added

- Self-hosting deliverables. A multi-stage `Dockerfile` builds the SPA and the
  API into a single image that serves both. A root `docker-compose.yml` brings
  up app, PostgreSQL and Redis with healthchecks and runs
  `prisma migrate deploy` on boot. `.env.example` documents every variable.
  Images publish to `ghcr.io` from CI on a version tag.
- Self-host hardening. `COOKIE_SECURE` with a fail-fast boot guard, so a
  production install on plain HTTP refuses to start rather than silently drop
  the refresh cookie. `ALLOW_REGISTRATION`, plus a public `GET /auth/config`
  the sign-in screen reads to hide registration when closed. `PURGE_AFTER_DAYS`
  retention fallback. SSE asserts `X-Accel-Buffering: no` so realtime works
  behind nginx.
- File attachments and avatars on local disk, with media paste, video
  transcoding to a compact MP4, and image thumbnails and video posters
  generated in the background.
- Public read-only board sharing, both a frozen snapshot and a live view, with
  per-token rate limits, OG previews and `?embed=1`.
- Master admin panel at `/admin`: users, boards, entities, moderation, support
  actions, feature flags, operations and maintenance, communications and
  announcements, data export and compliance, observability, security (TOTP 2FA
  and IP allowlist), and a Bull Board queue dashboard.
- Collaboration: realtime SSE, presence and attribution, comments with history
  diffs, and board members with roles and expiring access.
- Four board views — kanban, calendar, table and a bare **watch** view for
  observing a swarm: a large status, a column and online rail, and a live
  activity feed with from → to diffs and paging. A persisted "Simplify design"
  toggle swaps the full card for a compact one-line face.
- Backend: command log with idempotency and conflict handling, BullMQ queues
  (mail, transcode, maintenance, media, exports, comms, demo), OAuth login
  (Google and Yandex), email flows (verification, change, templates), and Redis
  fan-out for multi-node realtime.
- **Agent-ready cards (TASK-157).** The card description is now the card's
  document: the limit is raised from 10k to 64k characters — 10k was a leftover
  of the 5 MB localStorage budget of local/offline mode, which server mode
  never uses. The `janosik` skill also defines a canonical card shape a swarm
  can pick up cold: description sections (`Why` / `Scope` / `Acceptance
  criteria` / `Out of scope` / `Verify`), a `Definition of Done` checklist,
  typed comments (`[status]` / `[question]` / `[blocker]` / `[evidence]` /
  `[handoff]`) and reserved `agent:*` state labels.

### Security

- Personal API keys can no longer manage credentials: listing, creating and
  revoking keys, changing the password and changing the email answer `403`
  with `code: "pat_forbidden"` and need a browser session. Changing the
  password revokes every API key. A key created through the API without an
  expiry now lasts 90 days; `null` still means never.
- Signing in with Google or Yandex into an existing unverified account first
  removes its password and revokes its sessions and API keys, closing a
  pre-account-takeover path. Unverified accounts see no invitations until
  they confirm their email.
- Inviting by email no longer reveals whether an account exists: every
  address answers `201` with a masked member, and only an accepted member is
  a `409`.
- Login backs off per account from the fifth failed password (30 seconds,
  doubling up to 15 minutes, `429` with `code: "login_backoff"`). Rate limits
  count per user or API key instead of per IP on authenticated routes, shared
  through Redis when `REDIS_URL` is set.
- Commands: an `at` more than five minutes off the server clock is replaced
  with server time, timestamps outside the Date range answer `400`, unknown
  action fields are dropped, and reusing a `commandId` with a different
  action answers `409`. `ifMatchVersions` keys are scoped to the target
  board. A board write that times out answers `503` with
  `code: "board_write_timeout"`.
- The command delta answers `X-Delta-Resync: 1` and SSE streams send a
  `resync` frame when a gap cannot be replayed; command frames carry
  `commandId`. Open streams re-check access on every keep-alive and close when
  access, the API key or the share is gone.
- JSON bodies are capped at 256 KB outside board import and commands. The CSP
  drops `'unsafe-inline'` for scripts in favour of hashes computed at
  startup. Snapshot share links show only comments and attachments that
  existed at capture time.
- Master panel: the IP allowlist is enforced on every request and refresh,
  and a list that excludes your own address cannot be saved. Deleting a user
  is owner-only.
- The container image drops root after fixing the uploads volume owner,
  refuses to start with `POSTGRES_PASSWORD=change-me`, and warns while
  registration is open. A migration adds time indexes to the command log.

## 0.1.0 - 2026-10-26

Initial self-hosted release: an offline-first PWA Kanban board with drag and
drop, calendar and table views, undo and redo, WIP limits, labels, checklists,
links, priorities, assignees, due dates, i18n (English and Russian), and a
NestJS and PostgreSQL backend.
