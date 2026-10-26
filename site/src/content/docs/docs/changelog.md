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
[Self-hosting](self-hosting/)).

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
- Backend: command log with idempotency and conflict handling, BullMQ queues
  (mail, transcode, maintenance, media, exports, comms, demo), OAuth login
  (Google and Yandex), email flows (verification, change, templates), and Redis
  fan-out for multi-node realtime.

## 0.1.0 - 2026-10-26

Initial self-hosted release: an offline-first PWA Kanban board with drag and
drop, calendar and table views, undo and redo, WIP limits, labels, checklists,
links, priorities, assignees, due dates, i18n (English and Russian), and a
NestJS and PostgreSQL backend.
