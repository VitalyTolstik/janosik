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
- **Documentation site** at `/docs` (Astro Starlight): a getting-started
  guide, self-hosting with the full environment reference and operations
  runbooks, a complete user guide, an admin-panel guide, an HTTP API reference
  with the command catalog, an FAQ and a security policy, in English and
  Russian with full-text search and a light/dark theme.
- **Real feature clips.** The landing page's six clips are now genuine
  recordings of the running app (light and dark), produced by a Playwright
  pipeline in `video/record/` that seeds a demo board, records the real UI and
  the self-host terminal, and encodes mp4/webm/posters.
- **Screenshots in the user guide.** The user guide is rewritten around
  functions, with real screenshots of the running app on every screen
  (produced by `video/record/screenshots.mjs`), a new calendar-and-table views
  page, and a dedicated section for the card right-click quick menu.
- **In-app 404.** An unknown URL or an unknown board id now shows a themed
  not-found screen with a "Back to boards" action, instead of silently
  redirecting to another board (which hid typos and stale links). Revoking a
  member's access still moves them to another board. The marketing site's 404
  is now bilingual (English / Russian) and reads the language from the URL.
- **Dead card links.** A `?card=` that points at a card not on the board no
  longer fails silently: the stale param is dropped from the address bar and a
  short "Card not found" toast explains why nothing opened.
- **Docs version and an in-app Help menu.** The docs header now shows the
  version it describes (`v0.1.0`, read from the repo version at build time);
  the docs track the latest release and gain a version switcher once a second
  major exists. In the app, the header's "?" button is a Help menu that opens
  the keyboard-shortcut sheet and links to the documentation in the reader's
  language (`/docs/`, `/ru/docs/`).

## [0.1.0] - 2026-10-26

Initial self-hosted release: offline-first PWA Kanban board with drag & drop,
calendar and table views, undo/redo, WIP limits, labels, checklists, links,
priorities, assignees, due dates, i18n (en/ru) and a NestJS + PostgreSQL
backend.

[Unreleased]: https://github.com/VitalyTolstik/janosik/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/VitalyTolstik/janosik/releases/tag/v0.1.0
