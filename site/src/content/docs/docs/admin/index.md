---
title: Admin panel
description: The master panel at /admin, who may use it, how to create a master and sign in, and a map of its pages.
---

The admin panel is the platform operator surface. It is served at `/admin`,
lazy-loaded on top of the app, and talks to its own API client with its own
token. It is structurally separate from the user app: the admin route tree
never mounts the user `AuthProvider` or `BoardProvider`, and the two sessions
cannot leak into each other.

## Who can use the panel

The panel is for master accounts, not for regular users. A master is an
`AdminUser`, a different table from `User`, and it signs in through
`/api/v1/admin/auth/*` with its own JWT audience (`janosik-admin`) and its own
refresh cookie.

Masters come in two tiers:

| Role | Panel access |
| --- | --- |
| `OWNER` | Full data access plus the masters area and every owner-only control. |
| `OPERATOR` | Full data access, but cannot manage masters or change owner-only settings. |

The owner-only controls are enforced on the server, not only in the UI. An
operator who calls one of them receives `403` with `Owner rights are
required`. In the sidebar, the `Masters`, `Email service` and `OAuth login`
entries are hidden from operators. On the settings pages an operator sees the
state read-only: the traffic limit, the demo runner, the operations controls,
the communications writes, the security IP allowlist and the retention purge
are all owner-only.

## Three ways to create a master

There is no public HTTP endpoint that creates a master. A master account comes
from one of three paths.

### 1. The server CLI (bootstrap)

The CLI is the only way to create the first master on a fresh install. Run it
from the repository root with backend dependencies installed and `backend/.env`
present:

```sh
npm run admin:create -w backend -- --email me@example.com
npm run admin:create -w backend -- --email me@example.com --display-name "Ops" --owner
npm run admin:passwd -w backend -- --email me@example.com
npm run admin:list   -w backend
```

- `create` normalizes the email to lowercase and rejects an invalid address.
  The first master in an empty database becomes `OWNER` automatically. Every
  later one is `OPERATOR` unless `--owner` is passed. `--display-name` is
  optional.
- The password is never taken from the command line. It is prompted with a
  hidden input and confirmed, or read from the `ADMIN_PASSWORD` environment
  variable for automation. It must be 8 to 100 characters.
- `passwd` re-keys an existing master, revokes all of its refresh sessions and
  clears any lockout.
- `list` prints every master (email, role, display name, last login, disabled
  or locked flags). No secrets are shown.
- The CLI writes an audit row, so a creation or re-key appears in the panel's
  audit trail.

### 2. The panel (owner only)

An owner opens `Masters` and clicks `Add master`. The dialog takes an email, an
optional display name (at most 50 characters) and a `Grant owner rights`
checkbox that selects `OWNER` or `OPERATOR`. The server generates a one-time
password and shows it once.

### 3. Promote an existing user (owner only)

An owner opens a user's detail page and runs `Promote to master`. This creates
an `OPERATOR` master with the same email and a new temporary password. The
dialog requires typing the account's email to confirm. If a master already
exists with that email, the request answers `409`.

## How to sign in

Open `/admin`. An unauthenticated visit shows the master sign-in screen, which
is deliberately different from the user login: no registration link, no
password recovery, no social entry.

- The form posts to `POST /admin/auth/login` with email and password, plus an
  optional six-digit two-factor code.
- The session uses a separate access token and a separate refresh cookie named
  `admin_refresh_token`, scoped to path `/api/v1/admin/auth` with
  `SameSite=Strict`. User routes never receive that cookie and the admin cookie
  never reaches user routes.
- The login route is throttled to 10 attempts per minute per IP.
- After 5 failed logins the account is locked for 15 minutes. A locked account
  answers `429` and the form shows `Account is temporarily locked`. A
  successful login clears the counter and the lockout.
- An unknown email costs the same password-hash work as a wrong password, so
  response time never reveals whether a master exists.
- A disabled account is refused after the password check with `403`.
- When two-factor is enabled, the password alone is not enough. The server
  answers `401` with `code: "totp_required"` and the form reveals a two-factor
  code field. The code is the six digits from an authenticator app.
- An IP allowlist, when set for the master, is checked after the password so an
  attacker never learns the list without valid credentials. It is enforced
  again on every admin request and every session refresh: a token or refresh
  cookie used from an address outside the list answers `403`.
- Refresh tokens rotate on every use. Reusing a revoked token revokes every
  session of that master.

A successful sign-in lands on the dashboard. The login screen also carries the
hint `Master accounts are created on the server via the admin CLI.`

## The shell

The shell is a fixed sidebar plus a dense content area with a compact type
scale.

### Sidebar sections

| Section | Entries |
| --- | --- |
| Monitoring | Dashboard, Activity, Command log, Audit trail |
| People | Users, Masters (owner only) |
| Content | Boards, Cards, Columns, Labels, Checklists, Card links |
| Collaboration | Comments, Attachments |
| Security | Sessions, API tokens, Email service (owner only), OAuth login (owner only), Security |
| Operations | Traffic and limits, Demo runner, Public shares, Operations, Communications, Announcements, Observability |

The top bar shows the signed-in identity and a `Master` badge for owners. It
also holds the sidebar toggle, the search button, the theme toggle, the
language switcher, the `Back to boards` link and `Sign out`.

### Keyboard and preferences

- `Ctrl` or `Cmd` + `K` opens the omnibox from anywhere in the panel.
- `Ctrl` or `Cmd` + `B` toggles the sidebar. The collapsed state is a narrow
  icon rail, and the choice is remembered in `localStorage` under
  `janosik.admin.sidebar`.
- The theme toggle switches between light and dark.
- The language switcher switches the panel between English and Russian.

### The omnibox

The omnibox searches users, boards, cards, comments, attachments and labels in
one query. Results are grouped and keyboard-navigable: the arrow keys move the
selection and Enter opens the highlighted row. Opening a result navigates to
the related detail page. The search is debounced and runs against
`GET /admin/search?q=`.

## Pages in this section

- [Monitoring and logs](./monitoring/) covers the dashboard, the activity feed,
  the command log and the audit trail, with every column and action.
- [Users and masters](./people/) covers the user list and its actions, the user
  detail page, and the masters page.
- [Boards, cards and content](./content/) covers boards, the board content
  editor, cards, and the columns, labels, checklists, comments, attachments,
  sessions, tokens and public shares browsers.
- [Email, security and operations](./settings/) covers the email service, OAuth
  login, security, traffic, the demo swarm, operations, communications,
  observability, and the user-facing announcements banner.

For the user-facing side of the product, see the
[user guide](../user-guide/). The master API surface is described in the
[API reference](../api/).
