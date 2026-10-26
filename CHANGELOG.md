# Changelog

All notable changes to this project are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Self-hosting deliverables (TASK-38a/38b).** A multi-stage `Dockerfile`
  builds the SPA and the API into a single image that serves both; a root
  `docker-compose.yml` brings up app + PostgreSQL + Redis with healthchecks
  and runs `prisma migrate deploy` on boot; `.env.example` documents every
  variable; images publish to `ghcr.io` from CI on a version tag.
- **Self-host hardening (TASK-38a).** `COOKIE_SECURE` with a fail-fast boot
  guard (a production install on plain HTTP refuses to start rather than
  silently drop the refresh cookie); `ALLOW_REGISTRATION`; a public
  `GET /auth/config` the sign-in screen reads to hide registration when
  closed; `PURGE_AFTER_DAYS` retention fallback; SSE asserts
  `X-Accel-Buffering: no` so realtime works behind nginx.
- **File attachments & avatars** on local disk (no S3 needed), Jira-style
  media paste, video transcoding to a compact MP4, image thumbnails and video
  posters generated in the background.
- **Public read-only board sharing** (frozen snapshot and live), with
  per-token rate limits, OG previews and `?embed=1`.
- **Master admin panel** (`/admin`): users, boards, entities, moderation,
  support actions, feature flags, ops/maintenance, comms/announcements, data
  export & compliance, observability, security (TOTP 2FA, IP allowlist),
  and a Bull Board queue dashboard.
- **Collaboration**: realtime SSE, presence and attribution, comments with
  history diffs, board members with roles and expiring access.
- **Backend**: command log with idempotency and conflict handling, BullMQ
  queues (mail, transcode, maintenance, media, exports, comms, demo), OAuth
  login (Google / Yandex), email flows (verification, change, templates),
  Redis fan-out for multi-node realtime.

## [0.1.0] - 2026-10-26

Initial self-hosted release: offline-first PWA Kanban board with drag & drop,
calendar and table views, undo/redo, WIP limits, labels, checklists, links,
priorities, assignees, due dates, i18n (en/ru) and a NestJS + PostgreSQL
backend.

[Unreleased]: https://github.com/VitalyTolstik/janosik/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/VitalyTolstik/janosik/releases/tag/v0.1.0
