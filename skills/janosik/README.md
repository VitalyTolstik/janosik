# Skill: `janosik`

A behaviour playbook for AI agents working a [Janosik](../../README.md) board
through the [`@janosik/mcp`](../../mcp) MCP server. The MCP tools are the agent's
*hands* on the board; this skill is its *manners* — how to claim a card before
working it, when to comment, how to fill a card so it stands on its own, how the
columns flow, and what to do when a bug turns up (return the card with the
evidence, keep the history).

It is plain markdown with a `SKILL.md` frontmatter, so any harness that speaks
Agent Skills can load it. It **references the MCP tools by name** and never
duplicates the API — install the MCP server first, then this skill.

## Install

The skill is a folder (`janosik/`) with a `SKILL.md` inside. Drop it into your
harness's skills directory — the name must stay `janosik`.

| Harness | Where to put `janosik/` |
| --- | --- |
| **Claude Code** | `~/.claude/skills/janosik/` (personal) or `.claude/skills/janosik/` (project) |
| **opencode** | `~/.config/opencode/skills/janosik/` or `.opencode/skills/janosik/` (it also reads the `.claude/skills/` path) |
| **Any agent-compatible harness** | `~/.agents/skills/janosik/` or `.agents/skills/janosik/` |
| **Codex / others without skills** | Paste `SKILL.md` into your `AGENTS.md`, or point the agent at this file to read |

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

The skill only tells the agent *how* to behave; the agent still needs the tools.
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

Give each agent **its own user account and API key**. Commands from an agent
account are tagged `actorType: "agent"` and carry an **Agent** badge on the board,
so a human can tell a swarm's edits from their own, and revoking one key stops one
agent. A key may also be **scoped**: board-bound (it reaches only its board)
and/or **read-only** (it cannot write). A read-only agent can still orient itself
and report, but every write tool will refuse — that refusal is the truth, not a
bug to route around.

## Files

- `SKILL.md` — the behaviour (read this; it is what a harness loads).
- `references/templates.md` — copy-paste card, comment and label templates.
- `references/recipes.md` — step-by-step, tool-by-tool recipes for the common
  lifecycles (complete a feature, fix a bug, run a review, report a blocker).
