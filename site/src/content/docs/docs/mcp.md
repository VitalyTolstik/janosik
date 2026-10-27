---
title: MCP server
description: Let AI agents read and drive a board with the Janosik MCP server and a personal API key.
---

The `@janosik/mcp` server exposes a board to any MCP client (Claude, Cursor,
VS Code, opencode, Codex). An agent can list boards, read a board, and create,
move, comment, tick, assign, link and share, using a personal API key. Writes
go through the same command log the app uses, so they are undoable and stream
live to anyone watching the board.

## Setup

Create a key in **Account → API keys** (it starts with `jnk_`), then add the
server to your MCP client:

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

`JANOSIK_URL` is your instance origin and `JANOSIK_TOKEN` is the key. Both can
also be passed as `--url` and `--token` flags (prefer `env` for the token: a
flag shows up in the local process list). Add `JANOSIK_APP_BASE` (e.g.
`/app`) only when the app is not served at the site root; it is used to build
share links.

Upload and download of attachments, and exporting a board to a file, touch
the machine running the server, so they stay off until you set
`JANOSIK_MCP_ALLOW_FS=1`. Add `JANOSIK_MCP_FS_ROOT=/path` to confine them to
one directory: symlinks out of it are refused and existing files are never
overwritten.

## Tools

Tools come in groups. By default the server registers the groups that work
the board: boards, columns, cards, labels, checklists, card links, comments,
activity and attachments. The groups that change who can see a board or act
on your account (`members`, `invitations`, `shares`, `account`) are opt-in:

| Setting | Effect |
| --- | --- |
| `JANOSIK_MCP_TOOLSETS` | Comma-separated groups, e.g. `default,members`, or `all`. |
| `JANOSIK_MCP_READONLY=1` | Only tools that never change anything. |

Every data tool takes `response_format: "markdown"` (default) or `"json"`. The
tool names all start with `janosik_` so they sit alongside other servers
without clashing.

A typical run:

1. `janosik_list_boards` to find a board.
2. `janosik_get_board` to read its columns, cards and labels (pass `columnId`
   on a large board).
3. Focused tools to act, for example `janosik_create_card` then
   `janosik_move_card` and `janosik_add_comment`.

A write that changes nothing (for example an id that is not on the board)
comes back as an error, so an agent never mistakes it for success. Tools that
compute a write from a read retry when another agent changed the board in
between, and `janosik_update_card` accepts `expectedDescription` to edit
shared text only if nobody changed it since.

## Permissions

The key acts as the user who created it, with the same roles: an agent can
only touch boards that user is a member of, editing needs `MEMBER`, and member
or share management needs `ADMIN`. Revoke the key in the account panel to cut
an agent off.

Card text and comments are written by other people and agents, so treat what
an agent reads from a board as untrusted. Give each agent its own user account
and key: the activity feed then shows which agent did what, and revoking one
key stops one agent.

The server is open source in the repository under `mcp/`; its README lists the
full tool set.
