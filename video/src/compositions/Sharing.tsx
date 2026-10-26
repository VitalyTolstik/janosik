import { interpolate, useCurrentFrame } from "remotion";

import { Avatar, BoardBase, Chrome, Line } from "../components/board";
import { Stage } from "../components/Stage";
import { easeOut, travel } from "../lib/motion";
import type { ClipProps } from "../lib/types";

const URL_TEXT = "janosik.app/s/8fk2";

const POP_W = 430;
const POP_H = 214;
const POP_X = 1280 - 40 - POP_W;
const POP_Y = 800 - 44 - POP_H;

/** Sharing: a read-only link is copied to the clipboard, with the audience
 * shown up front. */
export const Sharing = ({ theme }: ClipProps) => {
  const frame = useCurrentFrame();

  const typed = URL_TEXT.slice(
    0,
    Math.round(
      interpolate(frame, [25, 80], [0, URL_TEXT.length], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: easeOut,
      }),
    ),
  );
  const copied = frame >= 125 && frame < 205;
  const caret = Math.floor(frame / 15) % 2 === 0;

  const copyX = POP_X + POP_W - 46;
  const copyY = POP_Y + 128;
  const cursorX = travel(frame, 20, 58, 165, 195, 990, copyX);
  const cursorY = travel(frame, 20, 58, 165, 195, 690, copyY);
  const cursorOpacity = interpolate(frame, [8, 22, 188, 205], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <Stage theme={theme}>
      <Chrome />
      <div style={{ opacity: 0.35 }}>
        <BoardBase columns={3} />
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "color-mix(in oklab, var(--background) 46%, transparent)",
        }}
      />

      <div
        style={{
          position: "absolute",
          left: POP_X,
          top: POP_Y,
          width: POP_W,
          height: POP_H,
          padding: 20,
          borderRadius: 18,
          border: "1px solid var(--border)",
          background: "var(--card)",
          display: "grid",
          alignContent: "start",
          gap: 14,
          boxShadow:
            "0 36px 70px -44px color-mix(in oklab, var(--foreground) 60%, transparent)",
        }}
      >
        <Line w="42%" h={12} />

        <div style={{ display: "flex" }}>
          {["var(--primary)", "var(--secondary)", "var(--success)"].map(
            (color, i) => (
              <div key={i} style={{ marginLeft: i === 0 ? 0 : -10 }}>
                <Avatar color={color} size={30} ring="var(--card)" />
              </div>
            ),
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              height: 44,
              padding: "0 14px",
              borderRadius: 11,
              border: "1px solid var(--input)",
              background: "var(--surface)",
              fontSize: 16,
              color: "var(--muted-foreground)",
              letterSpacing: "0.01em",
            }}
          >
            {typed}
            <span
              style={{
                display: "inline-block",
                width: 2,
                height: 18,
                marginLeft: 2,
                background: "var(--primary)",
                opacity: caret ? 1 : 0,
              }}
            />
          </div>
          <div
            style={{
              width: 44,
              height: 44,
              flex: "none",
              borderRadius: 11,
              display: "grid",
              placeItems: "center",
              background: copied ? "var(--success)" : "var(--primary)",
              color: "#fff",
            }}
          >
            {copied ? (
              <svg
                viewBox="0 0 24 24"
                width={20}
                height={20}
                fill="none"
                stroke="currentColor"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 24 24"
                width={19}
                height={19}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="9" y="9" width="12" height="12" rx="2" />
                <path d="M5 15V5a2 2 0 0 1 2-2h10" />
              </svg>
            )}
          </div>
        </div>

        <div
          style={{
            justifySelf: "start",
            padding: "3px 12px",
            borderRadius: 999,
            background: "color-mix(in oklab, var(--primary) 14%, transparent)",
            color: "color-mix(in oklab, var(--primary) 80%, var(--foreground))",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Read-only
        </div>
      </div>

      <CursorOverlay x={cursorX} y={cursorY} opacity={cursorOpacity} />
    </Stage>
  );
};

// Kept local so `Sharing` does not pull the whole cursor label styling in.
const CursorOverlay = ({
  x,
  y,
  opacity,
}: {
  x: number;
  y: number;
  opacity: number;
}) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      opacity,
      color: "var(--primary)",
    }}
  >
    <svg viewBox="0 0 24 24" width={26} height={26} aria-hidden>
      <path
        d="M4 2l7 18 2.4-6.6L20 11z"
        fill="currentColor"
        stroke="var(--card)"
        strokeWidth={1.5}
      />
    </svg>
  </div>
);
