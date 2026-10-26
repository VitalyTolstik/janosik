import { interpolate, useCurrentFrame } from "remotion";

import { Chrome } from "../components/board";
import { Stage } from "../components/Stage";
import { pingPong } from "../lib/motion";
import type { ClipProps } from "../lib/types";

const COMMAND = "docker compose up -d";
const STATUS = [
  "pulling postgres:16",
  "postgres ready",
  "janosik ready on :3000",
];

const PANEL_W = 800;
const PANEL_H = 384;
const PANEL_X = (1280 - PANEL_W) / 2;
const PANEL_Y = (800 - PANEL_H) / 2;

const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";

/** Self-host: one command and the stack is up. Types in, then reads out. */
export const Selfhost = ({ theme }: ClipProps) => {
  const frame = useCurrentFrame();

  const typed = pingPong(frame, 20, 92, 212, 240);
  const command = COMMAND.slice(0, Math.round(typed * COMMAND.length));
  const caretOn = Math.floor(frame / 15) % 2 === 0;

  return (
    <Stage theme={theme}>
      <Chrome />

      <div
        style={{
          position: "absolute",
          left: PANEL_X,
          top: PANEL_Y,
          width: PANEL_W,
          height: PANEL_H,
          borderRadius: 20,
          border: "1px solid var(--border)",
          background: "var(--card)",
          overflow: "hidden",
          boxShadow:
            "0 40px 80px -48px color-mix(in oklab, var(--foreground) 60%, transparent)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 22px",
            height: 56,
            borderBottom: "1px solid var(--border)",
            background: "var(--surface)",
          }}
        >
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: "var(--border)",
              }}
            />
          ))}
        </div>

        <div
          style={{
            padding: "28px 30px",
            fontFamily: mono,
            fontSize: 22,
            lineHeight: 1.9,
            display: "grid",
            alignContent: "start",
          }}
        >
          <div style={{ color: "var(--foreground)" }}>
            <span style={{ color: "var(--primary)", fontWeight: 700 }}>$ </span>
            {command}
            {typed > 0 && typed < 1 ? (
              <span style={{ opacity: caretOn ? 1 : 0 }}>▍</span>
            ) : null}
          </div>

          {STATUS.map((line, i) => {
            const opacity = interpolate(
              frame,
              [104 + i * 30, 134 + i * 30, 210, 235],
              [0, 1, 1, 0],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            );
            return (
              <div
                key={line}
                style={{
                  opacity,
                  color:
                    i === 0
                      ? "var(--muted-foreground)"
                      : "color-mix(in oklab, var(--success) 75%, var(--foreground))",
                }}
              >
                {i === 0 ? "⠿ " : "✓ "}
                {line}
              </div>
            );
          })}

          <div style={{ color: "var(--primary)", opacity: typed >= 1 ? 1 : 0 }}>
            <span style={{ fontWeight: 700 }}>$ </span>
            <span style={{ opacity: caretOn ? 1 : 0 }}>▍</span>
          </div>
        </div>
      </div>
    </Stage>
  );
};
