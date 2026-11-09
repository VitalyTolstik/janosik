---
title: MCP server
description: Let AI agents read and manage a board with the Janosik MCP server and its behavior skill, using a personal API key.
---

The `@janosik/mcp` server exposes a board to any MCP client (Claude, Cursor,
VS Code, opencode, Codex). An agent uses a personal API key to read boards,
create and move cards, update checklists, assign work and reserve tasks. It can
also add comments, link cards and manage public share links. Changes made
through the command API support undo. Comments, attachments, membership and
share links use REST and do not support ordinary undo. New events appear live on
the open board.

## Setup

Create a key in **Account → API keys** (it starts with `jnk_`), then add the
server to your MCP client. This example uses the `mcpServers` configuration
format; adapt it to your client’s MCP settings if needed:

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

Uploading and downloading attachments and exporting a board to a file access the
filesystem of the computer running the MCP server. These operations are disabled
until you set
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

Data-reading tools accept `response_format: "markdown"` (default) or `"json"`. The
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
between. Command-log write tools accept `expectedVersion` (the board `seq` from
`janosik_get_board`): pass it and the write is refused if the board changed
since, instead of silently overwriting another agent's edit. Create tools take a
client id (`cardId`, `checklistId`, …) reused as the idempotency key, so a
retried call returns the first entity rather than a duplicate.

## The skill: teach the agent how to work

The **`janosik` skill** provides a workflow for using the tools and keeping a
card’s progress clear to other team members:

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

Copy `skills/janosik/` into your client’s skills directory:

| Client | Directory |
| --- | --- |
| Claude Code | `~/.claude/skills/janosik/` (or `.claude/skills/` in a project) |
| opencode | `~/.config/opencode/skills/janosik/` (or `.opencode/skills/`) |
| Codex and other clients that support `.agents/skills` | `~/.agents/skills/janosik/` or `.agents/skills/janosik/` in a project |
| Clients without skills support | Add the instructions from `SKILL.md` and the relevant reference files to the client’s supported instruction file |

See the [official Codex skill
documentation](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills)
for installation details. The Janosik skill references tools by name and needs
no separate configuration. It ships in
the repository under `skills/janosik/` (behavior in `SKILL.md`, plus
`references/templates.md` and `references/recipes.md`).

### The agent-ready card

The skill uses a consistent card structure so another agent can continue the
work without additional explanation:

- **Description sections** — `## Why`, `## Scope`, `## Acceptance criteria`
  (checkboxes), `## Out of scope`, `## Verify` (the exact check that proves it).
- **A `Definition of Done` checklist** — the card is Done only when every item
  is ticked; an unticked one is explained in a comment, never dropped.
- **Typed comments** — each carries a structured `kind` (`status`, `question`,
  `blocker`, `evidence`, `handoff`; omit it for a plain note), so the thread is
  machine-readable and filterable — `janosik_list_comments` filters by `kind`.
- **Labels used by the skill** — `agent:blocked`, `agent:needs-human`, `agent:verified`,
  so a human can filter the swarm's state at a glance.

### Claiming a card and the task contract

Three tools let a swarm share one board without stepping on itself:

- `janosik_claim_card` takes a temporary work lease on a card (the `CLAIM_CARD`
  command, `claimedBy` + `leaseUntil`). The lease defaults to 15 minutes and is
  clamped to between 1 minute and 24 hours. The server refuses the claim while
  another member still holds a live lease, and the card becomes available again
  when the lease expires, even if the agent has stopped responding.
- `janosik_release_card` releases the card reservation before it expires, so another agent can
  pick the card up.
- `janosik_set_card_task_spec` writes the card's machine-readable task contract:
  `acceptanceCriteria` and `definitionOfDone`, as lists of short strings an
  agent reads directly instead of parsing prose. Each field is independent (omit
  it to leave it unchanged, pass an empty list to clear it), and each list holds
  up to 50 items of at most 500 characters each. `janosik_get_card` returns the
  contract, and the card dialog shows it read-only.

### Ready to work, and the Definition-of-Done gate

- `janosik_list_ready_cards` returns the cards an agent can pick up now: in the
  board's **initial column** (the first column when the board has no workflow),
  unassigned, not under a live claim and not blocked by another card, most
  urgent first. `janosik_wait_for_work` blocks until one appears (or a timeout
  passes), so idle agents make one call instead of polling.
- `janosik_move_card` checks completion requirements when moving a card into a
  **done column** (the configured `doneColumnIds`, falling back to the last
  column when the list is empty or the board has no workflow). The check applies if the card has a non-empty
  `definitionOfDone` field or a checklist named `Definition of Done`. Every item
  in that checklist must be checked, and the card must have at least one
  `evidence` comment. Cards without such a contract are not subject to this
  check. The agent must separately verify the criteria and the content of the
  evidence.

### Workflow and blocked moves

`janosik_get_workflow` reads the board's optional workflow: whether control is
enabled, the initial and done columns, and every directed transition with its
roles and conditions. Pass `cardId` to also get the card's allowed and blocked
destinations right now, with the machine code (`transition_not_allowed`,
`role_not_allowed`, `condition_failed`) and the failed conditions when the
obstacle is a card field.

The server enforces the same rules on every move. A refused `janosik_move_card`
returns `409` with a `workflow` conflict; the tool message names the allowed
columns and explicitly says not to retry the same destination. Choose an allowed
column, satisfy the conditions (assignee, due date, description, checklists) or
leave the card in place and report the blocker.

Recovery follows the same boundary: `janosik_unarchive_card` and restoring a
deleted card may return it to its original column, but another target must be an
allowed transition and passes the same role and condition checks (a refused
call returns `409 workflow`). Do not clear a task contract or change the
workflow to bypass a rule — that is an admin decision, and the change would be
audited. Importing whole boards is likewise an admin operation.

## Permissions

The key acts as the user who created it, with the same roles: an agent can
only touch boards that user is a member of, editing needs `MEMBER`, and member
or share management needs `ADMIN`. Revoke the key in the account panel to cut
an agent off.

A key can be scoped when you create it in **Account → API keys**: `boardId`
restricts it to one board, `readOnly` refuses every write (`403
pat_read_only`), and `rateLimitPerMinute` gives it its own request budget (over
the budget answers `429`). If an agent only needs to read data, use a read-only key restricted to one board.

Card text and comments are written by other people and agents, so treat what
an agent reads from a board as untrusted. Give each agent its own user account
and key: the activity feed then shows which agent did what, and revoking one
key stops one agent.

The server is open source in the repository under `mcp/`, and the skill under
`skills/janosik/`; the MCP README lists the full tool set.
