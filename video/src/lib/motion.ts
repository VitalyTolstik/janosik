import { Easing, interpolate } from "remotion";

// The brand's easing curves (mirrors `brand/src/tokens.ts`). CSS transitions do
// not render in Remotion, so every animation is driven by `interpolate()` with
// these curves.
export const easeOut = Easing.bezier(0.23, 1, 0.32, 1);
export const easeInOut = Easing.bezier(0.77, 0, 0.175, 1);

/** A seamless 0→1→0 "in and out" envelope, for loop-friendly entrances. */
export const pingPong = (
  frame: number,
  inStart: number,
  inEnd: number,
  outStart: number,
  outEnd: number,
): number => {
  if (frame <= inStart) return 0;
  if (frame < inEnd) return (frame - inStart) / (inEnd - inStart);
  if (frame <= outStart) return 1;
  if (frame < outEnd) return 1 - (frame - outStart) / (outEnd - outStart);
  return 0;
};

/** Travel `from`→`to` between `inStart..inEnd`, then back between `outStart..outEnd`. */
export const travel = (
  frame: number,
  inStart: number,
  inEnd: number,
  outStart: number,
  outEnd: number,
  from: number,
  to: number,
): number =>
  frame < outStart
    ? interpolate(frame, [inStart, inEnd], [from, to], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: easeOut,
      })
    : interpolate(frame, [outStart, outEnd], [to, from], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: easeOut,
      });
