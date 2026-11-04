# Skill: `janosik`

A behaviour playbook for AI agents working a [Janosik](../../README.md) board
through the [`@janosik/mcp`](../../mcp) MCP server. The MCP tools are the agent's
_hands_ on the board; this skill is its _manners_ — how to claim a card before
working it, when to comment, how to fill a card so it stands on its own, how the
columns flow, and what to do when a bug turns up (return the card with the
evidence, keep the history).

It is plain markdown with a `SKILL.md` frontmatter, so any harness that speaks
Agent Skills can load it. It **references the MCP tools by name** and never
duplicates the API — install the MCP server first, then this skill.

## Install

The skill is a folder (`janosik/`) with a `SKILL.md` inside. Drop it into your
harness's skills directory — the name must stay `janosik`.

| Harness                          | Where to put `janosik/`                                                                                        |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Claude Code**                  | `~/.claude/skills/janosik/` (personal) or `.claude/skills/janosik/` (project)                                  |
| **opencode**                     | `~/.config/opencode/skills/janosik/` or `.opencode/skills/janosik/` (it also reads the `.claude/skills/` path) |
| **Any agent-compatible harness** | `~/.agents/skills/janosik/` or `.agents/skills/janosik/`                                                       |
| **Codex**                        | `~/.codex/skills/janosik/` (personal); keep the whole folder so relative references work                       |

For example, from a Janosik checkout:

```bash
# Claude Code (personal)
mkdir -p ~/.claude/skills && cp -r skills/janosik ~/.claude/skills/

# opencode (global)
mkdir -p ~/.config/opencode/skills && cp -r skills/janosik ~/.config/opencode/skills/
```

In this repository the skill is already linked for local use at
`.claude/skills/janosik` → `../../skills/janosik`, so an agent working on Janosik
picks it up without copying anything.

## Prerequisite: the MCP server

The skill only tells the agent _how_ to behave; the agent still needs the tools.
Configure `@janosik/mcp` in the same harness (see [the MCP README](../../mcp/README.md)):

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

Create the key in **Account → API keys** using a browser user session, then set
`JANOSIK_TOKEN` in the MCP host configuration. MCP reads it at startup and cannot
create or rotate keys. To rotate, create a replacement in the app, update the
host environment, restart MCP, verify access, then revoke the old key.

Give each agent **its own user account and API key**. When an API-key operation
emits activity, it is tagged `actorType: "agent"` and carries an **Agent** badge.
Reads do not create activity entries. Separate accounts identify each agent's
edits, and revoking its key stops its access. A key may also be **scoped**:
board-bound (it reaches only its board)
and/or **read-only** (it cannot write). A read-only agent can orient itself and
report. A read-only key refuses writes; MCP read-only mode omits write tools
entirely. Separate keys on one account still share a claim identity.

## Files

- `SKILL.md` — the behaviour (read this; it is what a harness loads).
- `references/templates.md` — copy-paste card, comment and label templates.
- `references/recipes.md` — step-by-step, tool-by-tool recipes for the common
  lifecycles (complete a feature, fix a bug, run a review, report a blocker).
- `references/operations.md` — token setup, capabilities, board operations,
  files, access and public sharing.
