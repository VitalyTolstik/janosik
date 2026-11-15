# TASK-179 — Attention live sessions · visual acceptance

Verified source commit: `d613d3f2` (commits after it change only this evidence
folder).
Reference: `design/agent-surfaces-prototype/index.html`.
Method: Playwright with a mocked API at **1440 / 1024 / 390**, **light + dark**,
ADMIN and MEMBER; computed styles and geometry read from the live app. Raw
measurements: [`measurements.json`](./measurements.json). Console errors: 0.
Document and page horizontal overflow: 0 in every captured state.

## Acceptance table

| Element | Mockup expected | App actual (final head) | Verdict |
|---|---|---|---|
| Attention rail count | 18 px, 11/650, warning 12% bg / 26% border, `#d97706` light / `#f59e0b` dark | same | pass |
| Board pending count | 18 px, 11/650, warning 12% bg, raw warning | same | pass |
| Attention intro | warning dot, 12.5/650 heading, 11 muted meta | same | pass |
| Approval card box | r8, 1 px border, 11/12/10/14 padding, 3 px warning bar | same | pass |
| Approval card background | explicit user decision: 4% warning tint; selected warning 36% border / 4% tint | `oklab(0.97546 0.0037085 0.0041632)` light; `oklab(0.265807 -0.001406 -0.030842)` dark | pass (approved) |
| Approval eyebrow | 11/650, .06em, uppercase, raw `--warning` | `rgb(217,119,6)` light / `rgb(245,158,11)` dark | pass |
| Approval risk chip | 21 px, r4, 36% border / 7% fill, 11/600 | same | pass |
| Approval card buttons | 28 px, r6, 0 9, 11/650, primary-strong / outline surface | same | pass |
| `Needs a nudge` heading | 12/650/1.45, no dot, 18/7 px margins | same; hidden at zero stale | pass |
| Stale card | r8, warning 26% border / 4% bg, 10/12 padding, 30 px clock tile, 11.5/650 title, 11 meta, 11/600 Inspect | same; relative `6m ago` per explicit user decision | pass |
| Stale selected | warning 54% border / 8% bg | same | pass |
| `Live sessions` heading | 12/650/1.45 | same | pass |
| Live count chips | 21 px, r4, 11/600, success/warning hue, 34/36% border mixes | same; `4 active`, `1 waiting`, `1 no heartbeat`, `1 paused` | pass |
| `View all` | 11 muted + 11 px chevron; 44 px target on mobile | same; 0 height on desktop, 44 px at ≤760 | pass |
| Live table head | 11/650/.04em, 76% muted, px8 py5, 5 cols ≥1181 / 4 at 761–1180 | same; 10 px gap ≥1181, 8 px below | pass |
| Session row box | 47 px min height, 6/8 px padding, 10 px gap ≥1181, 128/120/82/100 below | 47.0 px, 6/8 px padding, 10 px / 8 px gaps | pass |
| Agent name | muted (`--muted-foreground`), 11.5/650 | `rgb(92,92,112)` light / `rgb(147,164,189)` dark | pass |
| Session name | foreground, 11/550 | `rgb(26,26,36)` / `rgb(230,237,247)` | pass |
| Heartbeat | 11 px, icon 11, gap 5; relative time only | same; stale keeps clock + warning colour in rows | pass (approved) |
| Status column / pills | 22 px pill, r5, 11/650; longest lifecycle label must fit | column 104 px ≥1181 / 100 px below. Completed label `scrollWidth 67 = clientWidth 67`; Failed 37=37; Cancelled 60=60 at 1440/1024/390 | pass |
| Paused row | one 47 px row (app keeps lifecycle + separate pause control) | 47.0 px; 18×18 pause icon, scope/reason in title/aria-label | pass (approved) |
| Row hover / selected | hover 46%; selected primary/6 + inset 2 px primary, also while hovered | same; selected hover stays `primary/6` + 2 px bar | pass |
| Attention empty state | inbox icon + “No agent sessions yet” + mockup Attention copy + Create API key / Read docs | `lucide-inbox`; “Create an API key in Account → API keys, then start a session from your agent. Attention will show decisions and missing heartbeats here.”; both actions present; 0 overflow | pass |
| Sessions note | primary 30% border / 6% bg, r7, 11/1.45 | same | pass |
| Session group header | 6 px board dot, 11.5/650 title, 21 px approval chip, meta `N sessions · N no heartbeat` | same | pass |
| Session detail header | eyebrow 11/650/.04em, title 13/650 | same | pass |
| Detail hint banner | r7, 8/10 padding, 11/1.45; info on terminal, warning on stale/paused, 14 px icon | same | pass |
| Ended-session banner | info banner + activity icon | `primary/6` bg, `primary/30` border, `lucide-activity` with primary colour | pass |
| Detail chips | status, heartbeat, board chip with folder | same; board chip 21 px, folder icon 10 px | pass |
| Detail meta grid | 6 fields, label 11/400/.04em/78%, value 11/500/1.4; empty run `—` | same; empty run `—`, live run `#140` | pass |
| Current work | 22 px r4 muted chips, folder/history icons | same | pass |
| Pause semantics | exact copy with mono `403 agent_paused` | same | pass |
| Detail footer | helper 11/1.45 gap 5; Open board / quiet Pause·Resume / danger End, 32 px r6 11.5/650 | same; terminal/member variants match | pass |
| Session detail, MEMBER | read-only footer + Open board only | `agents-session-read-only` present; Pause/End absent | pass |
| Session detail, TERMINAL | ended hint + “no further actions” footer, no actions | exact copy, no Pause/Resume/End | pass |
| Approval detail | header, warning banner, request/plan/integrity/history/related, footer | same; Approve/Reject 32 px r6 p11 11.5/650 primary-strong | pass |
| Token dialog | no mockup counterpart | shared dialog; 420 px desktop, 366 px at 390, no overflow/clipping | pass (approved) |
| Live/stale card selection | right panel, Attention stays selected, URL `?section=attention&session=…` | same; no AgentDetailPage navigation; Back closes, Forward restores | pass |
| View all | Sessions tab | `?section=sessions`, Sessions tab selected | pass |
| Console / overflow / clipped text | none | 0 console errors; 0 document/page overflow; no clipped terminal labels | pass |

## Approved deviations (user decisions / earlier approved work)

- 11 px font floor where the mockup uses 9.5–10.5 px.
- Lifecycle pill plus separate pause badge instead of the mockup’s composite “Paused” status (spec 179.4).
- Relative-only heartbeat text (the mockup data still contains `No heartbeat ·`).
- Raw `--warning` (`#d97706` / `#f59e0b`) and the 4% pending-card tint; the AA trade-off is explicit.
- Richer destructive-impact sentence, “What will change” instead of a raw Plan block, no fabricated per-board “Updated” meta.
- Token dialog has no mockup dialog counterpart (the mockup shows a toast), judged on the shared dialog language.

## Screenshots

44 captures in [`screenshots/`](./screenshots), covering every width/theme:
`attention-live-{light,dark}-{1440,1024,390}.png`,
`attention-empty-*`, `sessions-*`, `sessions-terminal-light-390.png`,
`sessions-terminal-dark-390.png`, `session-detail-completed-*`,
`session-detail-stale-*`, `member-attention-*`, `member-detail-*`.

Representative files:
- [Attention live, light 1440](./screenshots/attention-live-light-1440.png)
- [Attention empty, light 1440](./screenshots/attention-empty-light-1440.png)
- [Sessions with terminal statuses, light 1024](./screenshots/sessions-light-1024.png)
- [Completed session detail, light 1440](./screenshots/session-detail-completed-light-1440.png)
- [Member detail, dark 390](./screenshots/member-detail-dark-390.png)
