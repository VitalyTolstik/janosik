# `@janosik/video` — feature clips

Remotion compositions that render the landing page's feature clips. One clip
per media slot on the home page (the hero + four feature rows + the self-host
band). Everything is drawn on the shared brand tokens from `@janosik/brand`, so
the clips match the app and the site exactly — no hardcoded colours.

## Requirements

- Node 18+ (the repo's CI uses 22).
- Nothing else: the first render downloads Remotion's Chrome Headless Shell
  (~170 MB, cached in `~/.remotion`), and the encoder ships with Remotion.

## Commands

```bash
npm run studio -w video   # live preview (Remotion Studio) — the default way to iterate
npm run render -w video   # render every clip into site/public/media
npm run typecheck -w video
npm run lint -w video
```

`render` writes, per clip and per theme, an `mp4` (H.264), a `webm` (VP8) and a
`jpg` poster into `site/public/media/` — `<slug>.*` for light, `<slug>-dark.*`
for dark. Those files **are committed** — they are the landing page's assets —
so the site build never needs Remotion.

## Structure

```
src/
  index.ts            entry point (imports the brand CSS, registers the root)
  Root.tsx            one authored <Composition> per clip (Studio-editable)
  styles/theme.css    light site palette by default; `.dark` for the app theme
  lib/
    layout.ts         1280×800 geometry shared by every clip
    motion.ts         brand easing curves + loop-friendly helpers
    fonts.ts          loads Space Grotesk (no FOUT)
    types.ts          the `theme` prop every clip takes
  components/         the board mockup primitives (chrome, columns, cards, cursor)
  compositions/       the six clips
scripts/
  copy-assets.mjs     copies fonts + the brand mark into public/ (git-ignored)
  render.mjs          bundles once, renders every clip (mp4 + webm + poster)
```

## Clips → slots

| Composition | File (`site/public/media`) | Slot (`MediaSlot` variant) |
| --- | --- | --- |
| `Hero` | `hero-swarm` | `swarm` (hero) |
| `Board` | `feature-board` | `board` |
| `Realtime` | `feature-realtime` | `realtime` |
| `Cards` | `feature-cards` | `cards` |
| `Sharing` | `feature-sharing` | `sharing` |
| `Selfhost` | `feature-selfhost` | `selfhost` (open-source band) |

Each clip is 1280×800 (16:10 — the site slot's aspect ratio) at 30 fps, 7–8 s,
and loops seamlessly (its last frame returns to the first).

## Theme

Clips take a `theme` prop (`"light"` default, `"dark"` for the app palette).
Flip it in the Studio or per composition in `Root.tsx`. Because a clip is baked
video, it cannot follow CSS variables at runtime — so `render` writes both
variants and `MediaSlot` shows the one matching the page's `data-theme`.

## Adding or changing a clip

1. Edit or add a composition in `src/compositions/`, register it in `Root.tsx`.
2. `npm run studio -w video` to preview.
3. Add an entry to the `clips` list in `scripts/render.mjs` (slug + poster frame).
4. `npm run render -w video` and commit the new files in `site/public/media/`.

## CI

The `video` job in `.github/workflows/ci.yml` re-renders the clips on a version
tag or a manual `workflow_dispatch` and uploads them as an artifact — it is not
run on every PR, since the clips are committed.
