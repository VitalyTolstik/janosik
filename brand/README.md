# @janosik/brand

The single source of truth for Janosik's visual identity: design tokens
(colour, shape, type, motion) and logo assets. Consumed by the app (`ui/`),
the marketing site and the video project.

The full brand guide — positioning, tone of voice, logo usage — lives in
[`../docs/BRAND.md`](../docs/BRAND.md).

## Layout

```
src/tokens.ts     tokens as a typed TS object (colour / shape / type / motion)
src/tokens.css    the same values as CSS custom properties (dark + light)
src/tokens.test.ts parity check: tokens.ts must match tokens.css
assets/logo/      mark, feather (dark/light), lockup, wordmark
assets/og/        Open Graph template (1200×630)
```

## Usage

CSS (Tailwind v4 entry, or any stylesheet):

```css
@import "@janosik/brand/tokens.css";
```

TypeScript:

```ts
import { themes, motion } from "@janosik/brand";

const accent = themes.dark.primary; // "#3b82f6"
```

## Rules

- **Never hardcode a colour.** Use the tokens (`var(--primary)`, `themes.*`).
- `tokens.ts` and `tokens.css` are one source: edit both, then `npm run test -w brand`.
- Dark is the default theme; light is activated with `.light` on `<html>`.
- Motion: custom easing curves, UI durations under 300 ms, respect
  `prefers-reduced-motion`.
