# @janosik/mcp

An [MCP](https://modelcontextprotocol.io) server for [Janosik](https://github.com/VitalyTolstik/janosik),
the self-hosted Kanban board. It lets an AI agent — Claude, Cursor, VS Code,
opencode, Codex or any other MCP client — read and drive a board with a
personal API key: find the work that is ready to pick up, create and move cards,
claim one with a self-expiring lease so competing claims are rejected, set its
machine-readable task contract, comment with a typed kind, tick checklists,
assign people and link cards. Writes can be pinned to the board version they
read when they use the command API (compare-and-set), so a concurrent edit is
refused. Member, share-link and account tools are available too, but opt-in.

Board-content edits go through the command log the UI uses and stream live
to board viewers. MCP edits do not enter the UI's local undo stack; use
unarchive tools or explicit compensating edits to correct them. Comments, attachments, board
creation/import/deletion, membership, shares and account changes use separate
API routes. Activity records identify the user and whether a command came
from a human session or an API key. A key can be scoped to one board or made
read-only, with its own per-minute rate limit.

> **Companion skill.** The tools are the "hands"; the
> [`janosik` skill](../skills/janosik/SKILL.md) is the "behaviour" — when to
> comment, how to fill a card, and how to return a card with evidence when a bug
> turns up. Install it alongside this server.

## Quick start

1. In Janosik, open **Account → API keys** and create a key (it starts with
   `jnk_`). Choose its board scope, read-only setting, rate limit and expiry
   for this agent. Copy it now — it is shown once.
2. Point your MCP client at the server with these variables:

   | Variable           | Example                      | Meaning                                                                                                                                                |
   | ------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
   | `JANOSIK_URL`      | `https://boards.example.com` | Origin of your running instance (e.g. `http://localhost:3000` when you run from source).                                                               |
   | `JANOSIK_TOKEN`    | `jnk_…`                      | The personal API key.                                                                                                                                  |
   | `JANOSIK_APP_BASE` | `/app`                       | App sub-path, when the app is not at the site root (used to build board links). The self-host image serves the app under `/app/`, so set `/app` there. |

   All three can also be passed as `--url` / `--token` / `--app-base` flags.
   Prefer `env` for the token: a `--token` flag shows up in the local
   process list.

The MCP server does not create or install a key for you. It reads
`JANOSIK_TOKEN` when it starts and sends that key as a Bearer credential on
each API call. To rotate it, create a replacement in the app, update the MCP
client's environment, restart the MCP server, then revoke the old key in the
app. The token list, creation and revocation API routes require a browser user
session and return 403 to a personal API key.

### Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "janosik": {
      "command": "npx",
      "args": ["-y", "@janosik/mcp"],
      "env": {
        "JANOSIK_URL": "https://boards.example.com",
        "JANOSIK_TOKEN": "jnk_…"
      }
    }
  }
}
```

### Cursor / VS Code / opencode

The same `command` + `env` shape works everywhere MCP is configured. For a
local checkout, `command` can be `node` with `args: ["/path/to/mcp/dist/index.js"]`.

## Tools

Tools come in groups. The default set works the board; the groups that
change _who_ can see a board or act on the account are opt-in:

| Variable / flag                          | Effect                                                                                                                                                                                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JANOSIK_MCP_TOOLSETS` / `--toolsets`    | Comma-separated groups. Default: `boards,columns,cards,labels,checklists,links,comments,activity,attachments`. Opt-in: `members`, `invitations`, `shares`, `account`. `all` enables everything; `default,members` extends the default. |
| `JANOSIK_MCP_READONLY=1` / `--read-only` | Register only tools that never change anything — for an agent that watches and reports.                                                                                                                                                |

In read-only mode, `janosik_export_board` can return an export in the tool
response. Its `outputPath` option is refused because that writes a local file.

Data tools take `response_format: "markdown"` (default) or `"json"`. A JSON
response that would exceed the size budget is refused with a hint (read one
column with `janosik_get_board`'s `columnId`, export to a file) rather than
truncated into JSON that does not parse.

**Boards** — `janosik_list_boards`, `janosik_get_board`,
`janosik_create_board`, `janosik_rename_board`, `janosik_archive_board`,
`janosik_unarchive_board`, `janosik_delete_board`, `janosik_export_board`,
`janosik_import_board`, `janosik_get_workflow`

**Columns** — `janosik_create_column`, `janosik_rename_column`,
`janosik_move_column`, `janosik_duplicate_column`, `janosik_sort_column`,
`janosik_set_column_wip_limit`, `janosik_set_column_accent`, `janosik_clear_column`,
`janosik_delete_column`

**Cards** — `janosik_create_card`, `janosik_get_card`, `janosik_update_card`,
`janosik_move_card`, `janosik_duplicate_card`, `janosik_set_card_priority`,
`janosik_set_card_assignee`, `janosik_set_card_due_date`,
`janosik_set_card_cover`, `janosik_claim_card`, `janosik_release_card`,
`janosik_set_card_task_spec`,
`janosik_archive_card`, `janosik_unarchive_card`,
`janosik_delete_card`, `janosik_search_cards`, `janosik_list_ready_cards`,
`janosik_wait_for_work`

**Labels** — `janosik_list_labels`, `janosik_create_label`,
`janosik_rename_label`, `janosik_set_label_color`, `janosik_delete_label`,
`janosik_set_card_label`

**Checklists** — `janosik_add_checklist`, `janosik_rename_checklist`,
`janosik_add_checklist_item`, `janosik_set_checklist_item_done`,
`janosik_rename_checklist_item`, `janosik_delete_checklist_item`,
`janosik_delete_checklist`

**Links** — `janosik_add_card_link`, `janosik_remove_card_link`

**Comments** — `janosik_list_comments`, `janosik_add_comment`,
`janosik_delete_comment`

**Members & invitations** (opt-in: `members`, `invitations`) — `janosik_list_members`, `janosik_invite_member`,
`janosik_update_member`, `janosik_remove_member`,
`janosik_list_invitations`, `janosik_accept_invitation`,
`janosik_decline_invitation`

**Shares** (opt-in: `shares`) — `janosik_list_shares`, `janosik_create_share`,
`janosik_update_share`, `janosik_refresh_share`, `janosik_revoke_share`

**Activity** — `janosik_board_activity`, `janosik_card_activity`

**Attachments** — `janosik_list_attachments`, `janosik_upload_attachment`,
`janosik_download_attachment`, `janosik_delete_attachment`

**Account** (opt-in: `account`) — `janosik_whoami`, `janosik_update_profile`.
API keys are managed in the app only: the server refuses key management to
an API key, so an agent can never mint itself a new one.

## Behaviour agents can rely on

- **No silent no-ops.** A write that changed nothing — an id that is not on
  the board, or a value that was already set — comes back as an error, so an
  agent never reads "done" for a write that did nothing.
- **Compare-and-set.** Tools that compute a command from a read (`move_card`,
  `move_column`, `duplicate_column`, `remove_card_link`) send it with `ifMatch`
  on the board version they read; if another writer got there first, they
  re-read and retry. Command-log mutation tools also take an optional
  `expectedVersion` (the board `seq` from `janosik_get_board`): pass it and the
  write is refused with a version conflict if the board changed since, instead
  of overwriting another agent's edit. `janosik_update_card` keeps
  `expectedDescription` for compare-and-set edits of shared text.
- **Retries are safe.** A command that fails on the network is retried with
  the same idempotency key, so a write that did commit is never applied twice.
  Command-log create tools take a client id (`cardId`, `checklistId`, …) that
  determines the key, so an identical retried create returns the first entity,
  not a duplicate. Every request has a timeout.
- **Work discovery.** `janosik_list_ready_cards` lists candidates in each
  active board's initial column (`workflow.initialColumnId`, or the first column
  when no workflow exists) that are unassigned, free of a live claim and not
  blocked, ordered by priority. The initial column is a convention, not a
  column named Backlog. `janosik_wait_for_work` checks the board at the
  requested interval until one appears or the timeout expires; it does not
  reserve or claim the card.
- **A Definition-of-Done check in MCP.** When `janosik_move_card` enters a done
  column (`workflow.doneColumnIds`, or the board's last column when no workflow
  exists), it checks cards with a task contract for unticked
  `Definition of Done` checklist items and an `evidence` comment. This is a
  convention of this MCP tool; the app's command API does not enforce it for
  other clients. After a version conflict the tool re-reads the board and
  repeats the check before retrying the move. The evidence-comment read is
  separate from the move; this is not an atomic backend completion rule.
- **Workflow rules are enforced.** `janosik_get_workflow` reads the board's
  transitions, roles, conditions and initial/done columns; pass `cardId` for a
  per-card allowed/blocked check. A server-side `409` with
  `conflict: "workflow"` means the move is forbidden: the error names the
  allowed destinations and never suggests retrying the same one. Do not bypass
  it by clearing a contract, changing rules, importing or restoring.
- **Typed comments.** `janosik_add_comment` takes a `kind` (`status`,
  `question`, `blocker`, `evidence`, `handoff`; omit for a plain note) and
  `janosik_list_comments` filters by it.
- **Atomic `create_card`.** The due date and assignee are checked before the
  command. Creation and optional fields run in one transaction; a failure
  rolls the whole batch back.
- **Archive for routine cleanup.** Use `janosik_archive_card` for a finished
  card and `janosik_archive_board` for a board you want out of the active
  workflow. Both have matching unarchive tools. Use `janosik_clear_column`
  to archive a column's cards in one step. Delete tools remove content from
  normal board access and should be used when removal is specifically wanted;
  `janosik_delete_column` also removes the cards it contains. Comments have
  no archive action, so avoid deleting them as a cleanup step.

## Filesystem tools

`janosik_upload_attachment`, `janosik_download_attachment` and
`janosik_export_board` with `outputPath` read and write files on the machine
running this server, and board content is untrusted (it can reach the model as
tool output). They are therefore **off by default**. Enable them with
`JANOSIK_MCP_ALLOW_FS=1`, and confine them to a directory with
`JANOSIK_MCP_FS_ROOT=/path/to/sandbox` (relative paths then resolve against
it). Setting only `JANOSIK_MCP_FS_ROOT` does not enable filesystem access.
Symlinks that lead out of the root are refused, only regular files up to
the attachment size limit are read, and existing files are never overwritten.

## Out of scope

The server covers the board operations available through the app: board,
column, card, label, checklist, link, comment, attachment, member, invitation,
share and activity actions. A single `janosik_move_card` covers the UI's
drag-and-drop card order; internal `RESTORE_*` actions belong to undo/redo.
The server does not expose API-key management, the master admin panel,
account security (password and email changes), profile avatar upload,
browser-local backup scheduling, undo/redo or realtime presence. Those stay
in the app.

## Permissions and safety

The key acts as the user who created it, with the same roles they hold: an
agent can only touch boards the user is a member of, content editing needs
`MEMBER`, and board archive, member and share management need `ADMIN`.
Revoke the key in the account panel
to cut an agent off.

Card text and comments are written by other people and agents, so treat
everything an agent reads from a board as untrusted input. Keep the opt-in
groups off unless an agent needs them, and give each agent **its own user
account and key**: the activity feed then shows which agent did what, and
revoking one key stops one agent. A key can also be scoped to a single board
or made read-only, with its own per-minute rate limit; choose these when you
create it in the account panel.

## Development

```bash
npm run build -w mcp       # bundle to dist/ (tsup)
npm run typecheck -w mcp   # tsc --noEmit
npm run test -w mcp        # vitest
npm run lint -w mcp
```

A live smoke test drives a running instance through the MCP client:

```bash
npm run build -w mcp
JANOSIK_URL=http://localhost:3210 JANOSIK_TOKEN=jnk_… node mcp/scripts/smoke.mjs
```

## Releasing

The package is published to npm and listed in the
[MCP Registry](https://registry.modelcontextprotocol.io) as
`io.github.VitalyTolstik/janosik`. A release is one tag; CI does the rest.

1. Bump the version in **both** `package.json` and `server.json` (a test
   keeps them in lockstep), update the workspace entry in the root
   `package-lock.json`, and merge to `main`.
2. Tag and push: `git tag mcp-v<version> && git push origin mcp-v<version>` (the
   tag must equal the version you just bumped).

The `mcp-publish` job in `.github/workflows/ci.yml` runs only on an `mcp-v*` tag,
waits for the test suite, then publishes to npm and pushes the metadata to the
registry. It refuses to publish when the tag does not match the `package.json`
version. Auth is OIDC (npm Trusted Publishing + the registry's GitHub OIDC), so
there is no long-lived publishing token to rotate. The public repository lets
npm publish with `--provenance`, tying the package to its workflow build.
`mcpName` in `package.json` must equal the registry name in
`server.json`.

One-time bootstrap (before the first automated release): create the npm
package and the registry entry by hand — `npm publish -w mcp --access public`
from a logged-in shell, then `mcp-publisher login github && mcp-publisher
publish` from `mcp/`.

## License

AGPL-3.0-or-later.
