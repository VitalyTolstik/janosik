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
The exact check that proves it: `npm run test -w ui`, a curl, a link.
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
`["Reproduction no longer fails", "Relevant regression check passes"]`) so the fix has a finish line.

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

A spike normally ends in findings and a recommendation, with `kind: "evidence"`
for supporting checks. Follow its scope if a prototype is also requested.

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
`["Change applied", "Relevant checks pass"]`).

Each comment carries a `kind` — pass it to `janosik_add_comment` (`status`,
`question`, `blocker`, `evidence`, `handoff`); omit it for a plain note. The
text is written plainly; the kind is the field, not a prefix.

## Comment: status

```
Plan — <the approach in one or two lines>. Steps: <a, b, c>.
<what is done>, <what is in flight>. Next: <what comes next>.
```

## Comment: claim

```
Claimed until <lease expiry> — <how I read the task>.
```

(kind `status`)

## Comment: claim refused

```
@<holder> holds a live claim on this card (lease to <time>). Leaving it to them;
picking up <another card> instead.
```

(kind `question`)

## Comment: evidence

```
<what shipped>, verified by <test/commit/link>. <Any number that proves it>.
Definition of done: <verified criteria; state any remaining checks honestly>.
```

(kind `evidence`)

## Comment: bug found (the "return it" note)

```
<what is wrong>.
- Reproduce: <steps or command>
- Expected: <x>. Actual: <y>.
- Tried: <what you attempted>.
Returning the card to <column>; remaining work is in the task contract.
```

(kind `blocker`)

## Comment: blocked

```
<the blocker>. Needs <a decision / an access / another card>. Not moving this
forward until that lands; see <link>.
```

(kind `blocker`)

## Comment: question

```
<the decision you need>, from <a human / another agent>. Blocking until answered;
card left in <column>.
```

(kind `question`)

## Comment: handoff to review

```
Ready for review — <what to check>, on <board/column>. Evidence: <link or number>.
Revision: <commit/artifact/version>. Reviewer: <designated person or parent agent>.
Please look at <the risky part>. Remaining reviewer checks: <checks or none>.
Work lease released. Review request: <sent through channel / needs routing>.
```

(kind `handoff`)

## Comment: reviewer unavailable

```
Implementation is ready for review; acceptance is pending.
<No reviewer is assigned / the designated reviewer is unavailable>.
Please choose the responsible reviewer, or explicitly allow self-verification
for <scope>. Card stays in Review; evidence: <reference>. Work lease released.
```

(kind `question`; also raise the decision to the user instead of relying on a
comment being noticed. Reuse an existing answer rather than posting repeatedly.)

## Comment: review accepted

```
Accepted revision <commit/artifact/version>.
Checked: <criteria, independent checks and actual results>.
Limitations: <material checks not performed, or none>.
Completion criteria satisfied; moving to Done.
```

(kind `evidence`; only the designated reviewer, or an explicitly authorized
self-verifier who identifies that policy, should record acceptance.)

## Label conventions

Use the labels the board already defines (`janosik_list_labels`) before adding
new ones. A small, consistent set beats a big, improvised one:

| Label               | Means                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------- |
| `bug`               | a defect                                                                                 |
| `feature`           | new capability                                                                           |
| `chore`             | upkeep, no behaviour change                                                              |
| `docs`              | documentation only                                                                       |
| `blocked`           | cannot proceed (pair with the Blocked column)                                            |
| `agent`             | optional card categorization; activity badges identify agent actions, not card ownership |
| `agent:blocked`     | an agent is stuck and needs help                                                         |
| `agent:needs-human` | waiting on a human decision                                                              |
| `agent:verified`    | an agent checked it and trusts the result                                                |

These are optional conventions, not reserved application states. Reuse the
board's vocabulary; do not automatically create this whole set. Clear stale
state labels when their meaning no longer holds. Colour is cosmetic; keep the
meaning in the name.
