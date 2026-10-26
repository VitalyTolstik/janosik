---
title: "ADR-003: AGPL-3.0 with a separate trademark policy"
description: The code is licensed under AGPL-3.0-or-later, while the name and logo are governed by a separate trademark policy.
---

| Field | Value |
| --- | --- |
| Status | Accepted |
| Date | 2026-10-27 |
| Deciders | Janosik maintainers |

## Context

Janosik is open source and self-hostable, and there is a hosted option run by
the maintainer. Anyone can run the code, including a competitor, and a
permissive license would let a competitor run a closed managed service on it.
MIT was chosen first and later changed to AGPL-3.0.

A license covers code. It does not cover the project's name or logo, so
protecting the brand needs a separate document.

## Decision

The code is licensed under AGPL-3.0-or-later. The `LICENSE` file holds the
terms and the `license` field in `package.json` states the same. Contributions
are accepted under the same terms, as stated in the contributing guide.

The name and logo are governed by a separate trademark policy in
`TRADEMARK.md`. A fork must use a different name and logo and may describe
itself as "based on Janosik" or "a fork of Janosik". Only the maintainer's
hosted offering may be presented as the official Janosik service.

## Consequences

### Positive

- A modified version run as a network service must offer its source to its
  users, so a closed managed fork cannot be run quietly.
- Self-hosting, modification and commercial use stay allowed under the license.
- The trademark policy keeps the name from being used to pass a fork off as the
  official project or its hosted service.

### Negative

- AGPL is a strong copyleft license. Some organizations ban AGPL code outright,
  so they will not embed Janosik even when they would use a permissive license.
- The copyleft obligation is a real duty: a self-hoster who modifies the code
  and exposes the service must offer the modified source.
- The trademark policy adds a non-code restriction on top of the license, so a
  redistributor has to read two documents instead of one.

### Neutral

- Forks are welcome under a different name.
- The license and the trademark policy are separate documents with separate
  scope.
- Bundled third-party assets keep their own licenses.

## Alternatives considered

- **MIT.** Strongest argument for: maximum adoption and no copyleft friction.
  Rejected because it lets a competitor run a closed managed service on the
  code.
- **Apache-2.0.** Strongest argument for: a permissive license with an explicit
  patent grant. Rejected for the same reason as MIT: a hosted fork could be
  closed.
- **BSL (Business Source License).** Strongest argument for: it protects a
  hosted offering directly for a fixed period. Rejected because it is not an
  open-source license, which conflicts with the self-hostable open-source
  positioning.
- **Open-core.** Strongest argument for: it keeps the core open while
  monetizing advanced features. Rejected because it splits one product into two
  codebases and adds a licensing boundary the project does not want to
  maintain.

## References

- `LICENSE`
- `TRADEMARK.md`
- README, license section
- `package.json`
