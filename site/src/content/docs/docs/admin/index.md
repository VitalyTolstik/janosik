---
title: Admin panel
description: The master panel at /admin, who may use it, how to create a master and sign in, and a map of its pages.
---

The admin panel is the interface for managing the platform. It is served at
`/admin` (`/app/admin` in the Docker installation) and loads separately from the
board interface. It uses a separate API client and authentication token. It is
structurally separate from the user app: the admin route tree
never mounts the user `AuthProvider` or `BoardProvider`, keeping the
administrative and user sessions isolated.

## Who can use the panel

The panel is for master accounts, not for regular users. Master accounts are
stored in the `AdminUser` table, separately from regular users in `User`. They
sign in through
`/api/v1/admin/auth/*`, which uses a separate JWT audience (`janosik-admin`) and refresh cookie.

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
changes to communication settings, the security IP allowlist and the retention purge
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
- `passwd` resets an existing master’s password, revokes all of its refresh sessions and
  clears any lockout.
- `list` prints every master (email, role, display name, last login, disabled
  or locked flags). No secrets are shown.
- The CLI writes an audit row, so account creation or a password reset appears in the panel's
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

Open `/admin`. An unauthenticated visit shows the branded split-screen master
sign-in, deliberately different from the user login: a brand rail with the
build version, a 372 px form, progressive two-factor, show/hide password and
no registration, password recovery or social sign-in. There is no SSO button
because the backend has no master OIDC provider; the screen says so instead.

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
  this reduces the risk of identifying an existing account from response time.
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

A successful sign-in takes you to the dashboard. The login screen also shows the
hint `Master accounts are created on the server via the admin CLI.`

## The shell

The shell is a 232 px sidebar with eight hubs, a 44 px top bar with
breadcrumbs, and a dense content area. Every capability that used to be a
top-level link is a tab inside a hub; old URLs redirect there. The full map is
in [Admin redesign](./redesign/).

### Sidebar hubs

| Group | Hubs |
| --- | --- |
| Operate | Overview, Users, Boards, Moderation |
| Govern | Audit & activity, Communications |
| Configure | Access & security, Settings |

The top bar shows breadcrumbs, the signed-in identity (with a `Master` badge
for owners), the command-palette trigger, the density and theme toggles, the
shortcut sheet and `Sign out`. The sidebar footer holds the language switcher
and `Back to boards`.

### Responsive layout

The sidebar is 232 px on desktop, a 64 px icon rail between 640 and 959 px, and
a 280 px sheet behind a scrim at 639 px and below. At 639 px and below tables
become labelled cards, so the content keeps the full phone width.

### Keyboard and preferences

- `Ctrl` or `Cmd` + `K` opens the command palette from anywhere in the panel.
- `Ctrl` or `Cmd` + `B` toggles the sidebar. The collapsed state is a narrow
  icon rail, and the choice is remembered in `localStorage` under
  `janosik.admin.sidebar`.
- `g` followed by `d/u/b/m/a/c/s/,` jumps to a hub; `?` opens the shortcut
  sheet.
- The density toggle switches 36 px and 30 px table rows and is remembered
  under `janosik.admin.density`.
- The theme toggle switches between light and dark.
- The language switcher switches the panel between English and Russian.

### The command palette

The palette combines navigation, actions, recent pages and cross-entity
search. It searches users, boards, cards, comments, attachments and labels
against `GET /admin/search?q=`; results are grouped and keyboard-navigable
with `↑`/`↓` and Enter. If the request fails it offers a retry instead of an
empty result.

## Agent control is not part of the admin panel

The panel is a support, moderation and investigation console, not a second
board client and not an agent control plane. **`/admin` does not list or manage
agent runs, approvals or board policy, and it has no cross-board agent
section.** There are no approve/reject, pause/resume, run-revert,
destructive-mode or TTL controls in the panel. This is a deliberate boundary,
not a missing page.

Agent control lives in the user app, where board roles are enforced:

- **`/agents`** is the global cross-board inbox with three sections:
  **Attention** (pending approvals on boards where you are an ADMIN, plus
  stale sessions), **Sessions** (board-first session list and detail) and
  **Runs** (filters, run detail and a conditional revert that only a board
  ADMIN can apply; read-only for a MEMBER or VIEWER). The selected board,
  search and deep-linked session/run/approval are kept in the URL.
- **Agent Control** on a board (the bot button in the board header) is the
  board-scoped operational surface: **Inbox** for approvals, **Live** for
  board and session pause/resume/end, and **Runs** for run inspection and
  revert. Approve/reject and live control are board-ADMIN only; a MEMBER or
  VIEWER sees Live and Runs read-only and has no Inbox.
- **Board Settings → Agents & automation** owns the policy: destructive mode,
  approval triggers, per-run command and card limits, and approval TTL. Only a
  board ADMIN can read or change it.
- Token-level pause and **Stop all** are token-owner actions in **Account → API
  keys**, not in the board dialog. A master can still revoke any token in
  **Access & security → API tokens**; that is account administration, not an
  approval, run or policy decision.

A master account is not a board account: signing in to `/admin` neither grants
board membership nor these controls. If the same person needs them, they sign
in to the user app with their normal account and board role. An owner can also
open a short, audited impersonation session as that user; it opens the user app
under that account and is not a master control surface. Agent-authored cards,
comments, commands and activity appear in the panel as ordinary rows attributed
to the token's owner account; token, session and run attribution is in the
board's Watch/History and card comments. That is evidence for support work, not
control over the agent. The Demo runner on Settings can start a disposable
swarm on a throwaway board; that is a platform demo fixture, not a view or
control of real agent runs, approvals or policy.

Cross-board oversight from the master panel is **not part of TASK-176**. If it
is needed later, it requires a separate task with a master API, an explicit
permission model and audit of master access. A UI-only section built on the
existing board-scoped endpoints would bypass board roles and is not acceptable.

See the [agent launch guide](/docs/agent-launch/) and [Account → API
keys](/docs/user-guide/account/#pausing-and-stopping-agents).

## Pages in this section

- [Admin redesign](./redesign/) maps the eight hubs, legacy redirects,
  responsive behaviour, density, the command palette and the compatibility
  contract.
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
[user guide](../user-guide/). The [API reference](../api/) describes user-facing
endpoints. The administrative API uses separate authentication.
