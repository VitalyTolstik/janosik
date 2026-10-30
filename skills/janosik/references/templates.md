# Templates

Copy-ready shapes for the things you write on a board. They are starting points,
not forms — drop the sections that do not apply, and keep them short enough that
a busy person reads them.

## Card: feature

**Title** — verb + object: `Add CSV export to the board menu`.

**Description**

```
## Why
The problem this solves, and for whom. Link the request if there is one.

## Scope
What changes and where — files, areas, endpoints.

## Out of scope
What this card deliberately does not do.

## Verify
The exact check that proves it: `npm test -w ui`, a curl, a link.
```

Then set the **task contract** with `janosik_set_card_task_spec`:
`acceptanceCriteria` and `definitionOfDone`, each a list of short strings (the
machine-readable "done when"). A `Definition of Done` checklist may mirror
`definitionOfDone` for a visible progress bar, plus a second checklist for the
steps (discovery, build, test, docs), ticked as you go.

## Card: bug

**Title** — symptom + condition: `Export fails when a card has no due date`.

**Description**

```
## Steps to reproduce
1. …
2. …

## Expected
What should have happened.

## Actual
What happened instead — paste the error, not a paraphrase.

## Environment
Board, card, version/commit, browser or agent, anything that narrows it.

## Suspected cause
Your best guess, or "unknown".
```

Link the bug to whatever it blocks with `janosik_add_card_link` (`blocks`), and
set a **task contract** with `janosik_set_card_task_spec` (`definitionOfDone`:
"repro no longer fails", "regression test added") so the fix has a finish line.

## Card: spike / research

**Title** — the question: `Spike: can we index card search by label?`.

**Description**

```
## Question
The decision this spike unblocks.

## Time box
How much effort before we stop and report.

## Findings
Filled in as you go. End with a recommendation and the evidence for it.
```

A spike ends in a **comment with a recommendation**, not in code.

## Card: chore

**Title** — the task: `Bump the Postgres client to 16`.

**Description**

```
## Why
Security, cost, or hygiene — one line.

## Scope
The mechanical change, and where.

## Verify
The command that proves it: `npm test`, a build, a smoke check.
```

Set the **task contract** with `janosik_set_card_task_spec` (`acceptanceCriteria`:
"change applied", "nothing regressed").

## Comment: status

```
[status] Plan — <the approach in one or two lines>. Steps: <a, b, c>.
[status] <what is done>, <what is in flight>. Next: <what comes next>.
```

## Comment: claim

```
[status] Claimed until <lease expiry> — <how I read the task>.
```

## Comment: claim refused

```
[question] @<holder> holds a live claim on this card (lease to <time>). Leaving it
to them; picking up <another card> instead.
```

## Comment: evidence

```
[evidence] <what shipped>, verified by <test/commit/link>. <Any number that
proves it>. Definition of done met.
```

## Comment: bug found (the "return it" note)

```
[blocker] <what is wrong>.
- Reproduce: <steps or command>
- Expected: <x>. Actual: <y>.
- Tried: <what you attempted>.
Returning the card to <column>; remaining work is in the task contract.
```

## Comment: blocked

```
[blocker] <the blocker>. Needs <a decision / an access / another card>.
Not moving this forward until that lands; see <link>.
```

## Comment: question

```
[question] <the decision you need>, from <a human / another agent>. Blocking
until answered; card left in <column>.
```

## Comment: handoff to review

```
[handoff] Ready for review — <what to check>, on <board/column>. Evidence:
<link or number>. Please look at <the risky part>.
```

## Label conventions

Use the labels the board already defines (`janosik_list_labels`) before adding
new ones. A small, consistent set beats a big, improvised one:

| Label | Means |
| --- | --- |
| `bug` | a defect |
| `feature` | new capability |
| `chore` | upkeep, no behaviour change |
| `docs` | documentation only |
| `blocked` | cannot proceed (pair with the Blocked column) |
| `agent` | a card worked by an agent (the **Agent** badge already marks this from `actorType`; the label is optional) |
| `agent:blocked` | an agent is stuck and needs help |
| `agent:needs-human` | waiting on a human decision |
| `agent:verified` | an agent checked it and trusts the result |

Colour is cosmetic; keep the meaning in the name.
