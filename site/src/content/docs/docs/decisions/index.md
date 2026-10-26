---
title: Architecture decisions
description: How Janosik records architecture decisions and where to find each one.
---

An architecture decision record (ADR) captures one decision, the context it was
made in, and what it costs. The records here follow the Nygard format: a status
header, then Context, Decision, Consequences, Alternatives considered, and
References.

## What belongs in an ADR

An ADR records a decision that is already implemented in the repository and is
hard to reverse without real work. It states the decision as a fact, names the
forces that led to it, and lists the consequences, including the negative ones.
If a decision cannot be traced to code, a test, or a document, it does not
belong here.

## Numbering

Records are numbered `ADR-NNN` and a number never changes. Numbers are not
reused when a record is superseded, so a link to `ADR-001` always points at the
same decision. The files are named `adr-NNN-<slug>.md` and live in
`decisions/`.

## Lifecycle

A record starts as `Proposed` and becomes `Accepted` when the decision ships.
Records are append-only:

- The header `Status` may change to `Superseded by ADR-NNN` or `Deprecated`.
- The body of an accepted record is not rewritten. A reversal is a new record
  that supersedes the old one.
- Editing an accepted record is limited to fixing a factual error or adding a
  reference.

## Records

| ADR | Decision | Status |
| --- | --- | --- |
| [ADR-001: The command log is the only write path](./adr-001-command-log/) | Every board content mutation travels through one command endpoint and the shared reducer. | Accepted |
| [ADR-002: One image serves the site, the docs and the app](./adr-002-single-image-deploy/) | A single container image serves the marketing site at `/`, the docs, and the SPA at `/app/`. | Accepted |
| [ADR-003: AGPL-3.0 with a separate trademark policy](./adr-003-agpl-trademark/) | The code is AGPL-3.0-or-later; the name and logo are governed by a separate policy. | Accepted |
