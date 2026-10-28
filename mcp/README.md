# @janosik/mcp

An [MCP](https://modelcontextprotocol.io) server for [Janosik](https://github.com/VitalyTolstik/janosik),
the self-hosted Kanban board. It lets an AI agent — Claude, Cursor, VS Code,
opencode, Codex or any other MCP client — read and drive a board with a
personal API key: create and move cards, comment, tick checklists, assign
people and link cards. Member, share-link and account tools are available too,
but opt-in.

Writes go through the same command log the UI uses, so changes are undoable
and stream live to anyone watching the board.

> **Companion skill.** The tools are the "hands"; the
> [`janosik` skill](../skills/janosik/SKILL.md) is the "behaviour" — when to
> comment, how to fill a card, and how to return a card with evidence when a bug
> turns up. Install it alongside this server.

## Quick start

1. In Janosik, open **Account → API keys** and create a key (it starts with
   `jnk_`). Copy it now — it is shown once.
2. Point your MCP client at the server with two variables:

   | Variable | Example | Meaning |
   | --- | --- | --- |
   | `JANOSIK_URL` | `https://boards.example.com` | Origin of your running instance (e.g. `http://localhost:3000` when you run from source). |
   | `JANOSIK_TOKEN` | `jnk_…` | The personal API key. |
   | `JANOSIK_APP_BASE` | `/app` | App sub-path, when the app is not at the site root (used to build board links). The self-host image serves the app under `/app/`, so set `/app` there. |

   All three can also be passed as `--url` / `--token` / `--app-base` flags.
   Prefer `env` for the token: a `--token` flag shows up in the local
   process list.

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
change *who* can see a board or act on the account are opt-in:

| Variable / flag | Effect |
| --- | --- |
| `JANOSIK_MCP_TOOLSETS` / `--toolsets` | Comma-separated groups. Default: `boards,columns,cards,labels,checklists,links,comments,activity,attachments`. Opt-in: `members`, `invitations`, `shares`, `account`. `all` enables everything; `default,members` extends the default. |
| `JANOSIK_MCP_READONLY=1` / `--read-only` | Register only tools that never change anything — for an agent that watches and reports. |

Data tools take `response_format: "markdown"` (default) or `"json"`. A JSON
response that would exceed the size budget is refused with a hint (read one
column with `janosik_get_board`'s `columnId`, export to a file) rather than
truncated into JSON that does not parse.

**Boards** — `janosik_list_boards`, `janosik_get_board`,
`janosik_create_board`, `janosik_rename_board`, `janosik_archive_board`,
`janosik_unarchive_board`, `janosik_delete_board`, `janosik_export_board`,
`janosik_import_board`

**Columns** — `janosik_create_column`, `janosik_rename_column`,
`janosik_move_column`, `janosik_duplicate_column`, `janosik_sort_column`,
`janosik_set_column_wip_limit`, `janosik_clear_column`,
`janosik_delete_column`

**Cards** — `janosik_create_card`, `janosik_get_card`, `janosik_update_card`,
`janosik_move_card`, `janosik_duplicate_card`, `janosik_set_card_priority`,
`janosik_set_card_assignee`, `janosik_set_card_due_date`,
`janosik_set_card_cover`, `janosik_archive_card`, `janosik_unarchive_card`,
`janosik_delete_card`, `janosik_search_cards`

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
- **Concurrency.** Tools that compute a command from a read (`move_card`,
  `move_column`, `duplicate_column`, `remove_card_link`) send it with
  `ifMatch` on the board version they read; if another writer got there
  first, they re-read and retry. `janosik_update_card` takes an optional
  `expectedDescription` for compare-and-set edits of shared text.
- **Retries are safe.** A command that fails on the network is retried with
  the same idempotency key, so a write that did commit is never applied twice.
  Every request has a timeout.
- **`create_card` validates first.** The due date and assignee are checked
  before the card exists; if a later field still fails, the error names the
  card that was created so the agent fixes it instead of creating a duplicate.

## Filesystem tools

`janosik_upload_attachment`, `janosik_download_attachment` and
`janosik_export_board` with `outputPath` read and write files on the machine
running this server, and board content is untrusted (it can reach the model as
tool output). They are therefore **off by default**. Enable them with
`JANOSIK_MCP_ALLOW_FS=1`, and confine them to a directory with
`JANOSIK_MCP_FS_ROOT=/path/to/sandbox` (relative paths then resolve against
it). Symlinks that lead out of the root are refused, only regular files up to
the attachment size limit are read, and existing files are never overwritten.

## Out of scope

The server covers everything you do to a board. It intentionally does not
expose the master admin panel, account security (password, email change, 2FA),
undo/redo, or realtime presence — those stay in the app.

## Permissions and safety

The key acts as the user who created it, with the same roles they hold: an
agent can only touch boards the user is a member of, editing needs `MEMBER`,
and member/share management needs `ADMIN`. Revoke the key in the account panel
to cut an agent off.

Card text and comments are written by other people and agents, so treat
everything an agent reads from a board as untrusted input. Keep the opt-in
groups off unless an agent needs them, and give each agent **its own user
account and key**: the activity feed then shows which agent did what, and
revoking one key stops one agent.

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
   keeps them in lockstep) and merge to `main`.
2. Tag and push: `git tag mcp-v<version> && git push origin mcp-v<version>` (the
   tag must equal the version you just bumped).

The `mcp-publish` job in `.github/workflows/ci.yml` runs only on an `mcp-v*` tag,
waits for the test suite, then publishes to npm and pushes the metadata to the
registry. It refuses to publish when the tag does not match the `package.json`
version. Auth is OIDC (npm Trusted Publishing + the registry's GitHub OIDC), so
there is no token to rotate; `--provenance` is omitted because it needs a public
source repository. `mcpName` in `package.json` must equal the registry name in
`server.json`.

One-time bootstrap (before the first automated release): create the npm
package and the registry entry by hand — `npm publish -w mcp --access public`
from a logged-in shell, then `mcp-publisher login github && mcp-publisher
publish` from `mcp/`.

## License

AGPL-3.0-or-later.
