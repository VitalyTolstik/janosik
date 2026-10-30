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

## Acceptance criteria
- [ ] acceptance criterion 1
- [ ] acceptance criterion 2

## Out of scope
What this card deliberately does not do.

## Verify
The exact check that proves it: `npm test -w ui`, a curl, a link.
```

Then add a **`Definition of Done` checklist** — the acceptance criteria as
tickable items (a card is Done only when every one is ticked) — plus a second
checklist for the steps (discovery, build, test, docs), ticked as you go.

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

Link the bug to whatever it blocks with `janosik_add_card_link` (`blocks`).

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

## Acceptance criteria
- [ ] change applied
- [ ] nothing regressed (test, build, smoke)

## Verify
The command that proves it: `npm test`, a build, a smoke check.
```

## Comment: status

```
[status] Plan — <the approach in one or two lines>. Steps: <a, b, c>.
[status] <what is done>, <what is in flight>. Next: <what comes next>.
```

## Comment: evidence

```
[evidence] <what shipped>, verified by <test/commit/link>. <Any number that
proves it>. DoD complete.
```

## Comment: bug found (the "return it" note)

```
[blocker] <what is wrong>.
- Reproduce: <steps or command>
- Expected: <x>. Actual: <y>.
- Tried: <what you attempted>.
Returning the card to <column>; remaining work is on the Definition of Done.
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
| `agent` | a card worked by an agent, so humans can filter |
| `agent:blocked` | an agent is stuck and needs help |
| `agent:needs-human` | waiting on a human decision |
| `agent:verified` | an agent checked it and trusts the result |

Colour is cosmetic; keep the meaning in the name.
