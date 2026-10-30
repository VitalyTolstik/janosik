# `@janosik/video` — feature clips

The landing page's feature clips: one clip per media slot on the home page
(the hero, five feature rows and the self-host band). Two pipelines can produce
them.

**Recording pipeline (current source of truth).** Real screen recordings of the
running app, driven by Playwright against a seeded board. This is what the
committed files in `site/public/media/` come from.

**Remotion pipeline (alternative).** Authored compositions drawn on the shared
brand tokens from `@janosik/brand`. Useful for clips that cannot be recorded
(an abstract explainer), and kept as an authoring tool.

Both write the same slugs, so only run one at a time.

## Requirements

- Node 22 and `ffmpeg` on the PATH (the recording pipeline shells out to it).
- A running Janosik stack reachable over HTTP (the dev/test server, default
  `http://localhost:3210`), with `backend/.env` present so the seed can mint
  tokens.
- Playwright browsers: `npx playwright install chromium ffmpeg` (once).

## Recording pipeline

```bash
npm run seed -w video      # create the demo users + a realistic board
npm run record -w video    # record every clip, light and dark, into record/out
npm run terminal -w video  # the self-host clip (real command output)
npm run encode -w video    # trim + encode into site/public/media
npm run clips -w video     # seed, record, terminal, encode in one go
```

`seed` creates seven demo users (`@janosik.demo`, all verified) and a
`Product roadmap` board with four columns, twelve cards, labels, due dates,
assignees, a checklist and comments. It is idempotent: matching users are
deleted and recreated first. It also logs each user in once to capture the
refresh cookie the recorder injects, so no login screen appears in the footage.

`record` captures each clip at 1280×800 (16:10, the site slot's aspect ratio),
rendered at 2x device scale for crisp text. It records both themes by seeding
`janosik-theme` before the app boots. The hero and realtime clips open extra
browser contexts (teammates) so presence and live updates are real. Refresh
tokens rotate on every use, so the recorder carries the rotated cookie from one
context to the next; run `seed` immediately before `record`.

`terminal` runs the documented start-up commands for real, captures their
stdout, and plays that output in a terminal recorded by Playwright. Every line
is real command output.

`encode` reads the offsets in `record/out/manifest.json` and writes, per clip
and theme, an `mp4` (H.264), a `webm` (VP9) and a `jpg` poster into
`site/public/media/`: `<slug>.*` for light, `<slug>-dark.*` for dark. Those
files are committed, so the site build never needs the pipelines.

Raw takes and the seed manifest live in `video/record/out/` and
`video/record/.state.json` (both git-ignored).

## Remotion pipeline

```bash
npm run studio -w video   # live preview (Remotion Studio)
npm run render -w video   # render every composition into site/public/media
```

The first render downloads Remotion's Chrome Headless Shell into `~/.remotion`.
`render` writes the same slugs as the recording pipeline.

```
src/
  index.ts            entry point (imports the brand CSS, registers the root)
  Root.tsx            one authored <Composition> per clip (Studio-editable)
  styles/theme.css    light site palette by default; `.dark` for the app theme
  lib/                layout, motion, fonts, shared types
  components/         the board mockup primitives
  compositions/       the six clips
scripts/
  copy-assets.mjs     copies fonts + the brand mark into public/ (git-ignored)
  render.mjs          bundles once, renders every clip (mp4 + webm + poster)
record/
  seed.mjs            demo users + board via the API
  record.mjs          Playwright recordings of the real UI
  terminal.mjs        the self-host clip from real command output
  encode.mjs          trim + encode into site/public/media
```

## Clips to slots

| Slug | Slot (`MediaSlot` variant) |
| --- | --- |
| `hero-swarm` | `swarm` (hero) |
| `feature-board` | `board` |
| `feature-realtime` | `realtime` |
| `feature-cards` | `cards` |
| `feature-sharing` | `sharing` |
| `feature-watch` | `watch` |
| `feature-selfhost` | `selfhost` (open-source band) |

Each clip is 1280×800 (16:10) and loops: its last frame returns to the first.

`feature-watch` is recorded only (there is no Remotion composition for it), so
the recording pipeline is the only source for that slot.

## Theme

A clip is baked video, so it cannot follow CSS variables at runtime. Every
pipeline writes both variants, and `MediaSlot` shows the one matching the
page's `data-theme`.

## CI

The `video` job in `.github/workflows/ci.yml` re-renders the clips on a version
tag or a manual `workflow_dispatch` and uploads them as an artifact. It is not
run on every PR, since the clips are committed.
