---
title: MCP server
description: Let AI agents read and drive a board with the Janosik MCP server and its behaviour skill, using a personal API key.
---

The `@janosik/mcp` server exposes a board to any MCP client (Claude, Cursor,
VS Code, opencode, Codex). An agent can list boards, read a board, and create,
move, comment, tick, assign, claim, link and share, using a personal API key.
Writes go through the same command log the app uses, so they are undoable and
stream live to anyone watching the board.

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
flag shows up in the local process list). The server needs the instance running
and reachable at `JANOSIK_URL` — for example `http://localhost:3000` when you run
from source. Add `JANOSIK_APP_BASE` (e.g. `/app`) when the app is not served at
the site root; it is used to build board links. The self-host image serves the
app under `/app/`, so set `JANOSIK_APP_BASE=/app` there.

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
2. `janosik_get_board` to read its columns, cards, labels and the board version
   (`seq`); pass `columnId` on a large board, or `detail: "summary"` to skip
   each card's description and checklists.
3. `janosik_list_ready_cards` to find work (unassigned, unclaimed and unblocked,
   most urgent first) — or `janosik_wait_for_work` to block until one appears
   instead of polling.
4. Focused tools to act, for example `janosik_create_card` then
   `janosik_move_card` and `janosik_add_comment`.

A write that changes nothing (for example an id that is not on the board)
comes back as an error, so an agent never mistakes it for success. Tools that
compute a write from a read retry when another agent changed the board in
between. Any write accepts `expectedVersion` (the board `seq` from
`janosik_get_board`): pass it and the write is refused if the board changed
since, instead of silently overwriting another agent's edit. Create tools take a
client id (`cardId`, `checklistId`, …) reused as the idempotency key, so a
retried call returns the first entity rather than a duplicate.

## The skill: teach the agent how to work

The server gives an agent the tools; it does not tell it *how* to use them well.
The **`janosik` skill** is the behaviour half — a playbook that makes the agent
work a card the way a good teammate would:

- **Read before writing** — list the boards, read the board, read the card's
  comments and activity before touching anything.
- **Claim and fill the card** — assign it to itself, move it to *In Progress*,
  and write a description and checklist that stand on their own.
- **Comment at every step** — a short note when it picks the card up, when a
  step is done, and when it hands the card over. The comment thread is the
  card's story.
- **Move it forward** — Backlog → In Progress → Review → Done, with a human gate
  at Review.
- **Return it on a bug** — if the card is wrong or breaks something, the agent
  moves it **back** (to Bugs, or In Progress) with a comment describing the
  defect and a checklist item for the fix, instead of marking it Done. That
  backward move plus the comment is the audit trail.

Install it by dropping `skills/janosik/` into your harness's skills directory:

| Harness | Where |
| --- | --- |
| Claude Code | `~/.claude/skills/janosik/` (or `.claude/skills/` in a project) |
| opencode | `~/.config/opencode/skills/janosik/` (or `.opencode/skills/`) |
| Agent-compatible harnesses | `~/.agents/skills/janosik/` (or `.agents/skills/`) |
| Codex / no skills support | Paste `SKILL.md` into your `AGENTS.md` |

The skill references the tools by name and needs no configuration. It ships in
the repository under `skills/janosik/` (behaviour in `SKILL.md`, plus
`references/templates.md` and `references/recipes.md`).

### The agent-ready card

The skill asks an agent to leave a card a swarm can pick up cold — one shape,
the same on every card:

- **Description sections** — `## Why`, `## Scope`, `## Acceptance criteria`
  (checkboxes), `## Out of scope`, `## Verify` (the exact check that proves it).
- **A `Definition of Done` checklist** — the card is Done only when every item
  is ticked; an unticked one is explained in a comment, never dropped.
- **Typed comments** — each carries a structured `kind` (`status`, `question`,
  `blocker`, `evidence`, `handoff`; omit it for a plain note), so the thread is
  machine-readable and filterable — `janosik_list_comments` filters by `kind`.
- **Reserved labels** — `agent:blocked`, `agent:needs-human`, `agent:verified`,
  so a human can filter the swarm's state at a glance.

### Claiming a card and the task contract

Three tools let a swarm share one board without stepping on itself:

- `janosik_claim_card` takes a temporary work lease on a card (the `CLAIM_CARD`
  command, `claimedBy` + `leaseUntil`). The lease defaults to 15 minutes and is
  clamped to between 1 minute and 24 hours. The server refuses the claim while
  another member still holds a live lease, and a lapsed lease is free again — so
  a dead agent never leaves a card stuck.
- `janosik_release_card` releases the caller's lease early, so another agent can
  pick the card up.
- `janosik_set_card_task_spec` writes the card's machine-readable task contract:
  `acceptanceCriteria` and `definitionOfDone`, as lists of short strings an
  agent reads directly instead of parsing prose. Each field is independent (omit
  it to leave it unchanged, pass an empty list to clear it), and items are
  capped at 500 characters and 50 items. `janosik_get_card` renders the contract
  back, and the card dialog shows it read-only.

### Ready to work, and the Definition-of-Done gate

- `janosik_list_ready_cards` returns the cards an agent can pick up now: in the
  board's first (Backlog) column, unassigned, not under a live claim and not
  blocked by another card, most urgent first. `janosik_wait_for_work` blocks
  until one appears (or a timeout passes), so idle agents make one call instead
  of polling.
- `janosik_move_card` refuses to move a card into the board's last (Done) column
  while its `Definition of Done` checklist has unticked items or it has no
  `evidence` comment — the anti-"green fence" rule. Tick the items and post the
  evidence; do not force the move.

## Permissions

The key acts as the user who created it, with the same roles: an agent can
only touch boards that user is a member of, editing needs `MEMBER`, and member
or share management needs `ADMIN`. Revoke the key in the account panel to cut
an agent off.

A key can be scoped when you create it in **Account → API keys**: `boardId`
restricts it to one board, `readOnly` refuses every write (`403
pat_read_only`), and `rateLimitPerMinute` gives it its own request budget (over
the budget answers `429`). A board-scoped, read-only key is the least-privilege
option for a swarm.

Card text and comments are written by other people and agents, so treat what
an agent reads from a board as untrusted. Give each agent its own user account
and key: the activity feed then shows which agent did what, and revoking one
key stops one agent.

The server is open source in the repository under `mcp/`, and the skill under
`skills/janosik/`; the MCP README lists the full tool set.
