---
title: FAQ and troubleshooting
description: Common questions about licensing, hosting, data, offline use, backups, browsers, Node.js and the API.
---

Short answers to common questions. Each one links to the page that owns the
detail.

## What licence is Janosik under?

AGPL-3.0, copyright 2026 Vitali Toustsik. You may use, self-host, fork and
modify it, including commercially. The one condition AGPL-3.0 adds is that if
you run a modified version as a network service, you must offer its source to
the people who use it.

The licence covers the code, not the name. "Janosik" and the feather logo
identify this project. Forks are welcome under a different name and logo, and
must not present themselves as the official Janosik. See the
[Trademark policy](https://github.com/VitalyTolstik/janosik/blob/main/TRADEMARK.md).

## Should I self-host or use a hosted edition?

Both exist. The maintainer runs a hosted edition, and Janosik is built to be
self-hosted as a single container image. Self-hosting keeps all data on your
own host and is the documented path in [Self-hosting](/docs/self-hosting/).

## Where is my data stored?

It depends on the mode. In local-only mode every board and card lives in the
browser under `localStorage`. In server mode boards live in PostgreSQL, on the
Docker volume `janosik-pgdata`, and attachments and avatars live on the
`janosik-uploads` volume. [Self-hosting](/docs/self-hosting/) lists every data
location.

## Does it work offline?

Yes, with one limit. Janosik installs as a PWA and caches its app shell, so it
opens with the network cut. Local-only mode then works fully offline. Server
mode opens offline but writes need the network: an optimistic edit rolls back
with a toast if the API is unreachable, and a reload drops unsynced changes
because there is no persistent outbox yet.

## How do I back up my data?

In server mode, take a database dump and an uploads archive; both are in
[Operations runbooks](/docs/runbooks/). In local-only mode the app keeps automatic
backups on its own, and you can move data with `Export JSON` and
`Import JSON`.

## Can I move boards between instances?

In local-only mode, export a board to JSON and import it into the other
browser. In server mode, boards live in the database, so moving them between
instances means restoring a database dump on the target (see
[Operations runbooks](/docs/runbooks/)).

## Which browsers are supported?

Janosik is a PWA built with React 18. It installs and runs in modern browsers
that support service workers and progressive web apps.

## Which Node.js version does the backend need?

Node.js 22.17 or newer. The backend `engines` field enforces this. Check with
`node -v`. The from-source steps are in [Self-hosting](/docs/self-hosting/).

## How do agents and scripts use the API?

They authenticate with a personal API token. Create one in your account panel,
then send it in the `Authorization` header as `Bearer jnk_<token>`. A token
works on boards, members, shares and invitations, but not on key, password or
email management, which needs a browser sign-in. The API
base path is `/api/v1`. Board mutations travel through the command log at
`POST /boards/:id/commands`. See the [API reference](/docs/api/) and the
[Command API](/docs/api/commands/).
