# Contributing to Janosik

Thanks for wanting to help. This is a small, opinionated project — a self-hosted
Kanban board for a swarm of AI agents. Bug reports, docs fixes and focused pull
requests are all welcome.

## Licence and the DCO

Janosik is released under the [AGPL-3.0](./LICENSE). By contributing you agree
that your contribution is licensed under the same terms (**inbound = outbound**),
and you keep the copyright to your work.

We ask every commit to be **signed off** under the
[Developer Certificate of Origin](https://developercertificate.org/) (DCO). It is
a one-line statement that you wrote the change (or have the right to submit it).
Add it with:

```bash
git commit -s -m "fix: stop the column from jumping on drag"
```

That appends a trailer:

```
Signed-off-by: Your Name <you@example.com>
```

Use your real name and a reachable email. If you forget, `git commit --amend -s`
fixes the last commit; for several commits, `git rebase --signoff main`.

> Why the DCO? It keeps the project's licensing unambiguous. Without a sign-off
> on a contribution, the project can no longer be relicensed — so please do not
> merge pull requests that lack one.

## Set up

This is an **npm-workspaces monorepo**: one `npm install` at the root installs
every package (`ui`, `backend`, `shared`, `site`, `video`, `brand`). The rule of
thumb: **`shared` is a library; `ui` and `backend` are programs that use it.**

```bash
npm install
npm run dev          # UI dev server on http://localhost:5173 (local-first mode)
```

For server mode (accounts, shared boards, realtime) you need PostgreSQL:

```bash
docker compose -f backend/docker-compose.yml up -d   # janosik-postgres on :5433
cp backend/.env.example backend/.env                 # set JWT_SECRET
npm run prisma:deploy -w backend
npm run build:backend
npm run start -w backend                             # API on :3000
```

`README.md` has the full walkthrough, including self-hosting with Docker and the
master-admin CLI.

## Before you push

CI runs the same gates. Run them locally first:

```bash
npm run lint
npm run format:check      # `npm run format` to fix
npm test                  # ui + shared (Vitest)
npm run test:backend      # Jest + Supertest, needs the dev database
npm run build
npm run size -w ui
```

Other workspaces have their own checks (`npm run check -w site`,
`npm run typecheck -w video`, …) — run the ones that touch what you changed.

## Conventions

- **Branches:** work off `main` in `feat/<slug>`, `fix/<slug>` or `chore/<slug>`.
  Open a pull request and let CI run; a maintainer merges.
- **Commits:** short, imperative, conventional-style subject
  (`feat: …`, `fix: …`, `docs: …`).
- **Contract first:** change the data model, a board operation, validation or an
  API type in `@janosik/shared` first — both `ui` and `backend` compile against
  it, so the change lands once.
- **i18n:** every new UI string lands in both `src/locales/en` and
  `src/locales/ru` in the same commit.
- **Design tokens:** never hard-code colours; use the variables in
  `src/index.css`.
- **Tests:** UI tests are Vitest + React Testing Library. Browser end-to-end
  tests for single-user flows are intentionally out of scope; the backend e2e
  suite is Jest + Supertest against a real PostgreSQL test database.

## Reporting bugs and proposing changes

Open a GitHub issue with what you expected, what happened, and how to reproduce
it (version/commit, self-hosted or local mode, browser). For anything larger than
a bug fix, open an issue to agree on the approach before writing code.

By participating you agree to keep the discussion respectful and on topic.
