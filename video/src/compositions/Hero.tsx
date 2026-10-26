import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";

import {
  Avatar,
  Card,
  CardBody,
  Chrome,
  BoardBase,
  Line,
} from "../components/board";
import type { Agent } from "../components/board";
import { Stage } from "../components/Stage";
import { CHROME_H, PAD, colWidth, colX, cardY } from "../lib/layout";
import { easeOut } from "../lib/motion";
import type { ClipProps } from "../lib/types";

const COLUMNS = 4;
const LAYOUT = [2, 3, 2, 1];
const AGENTS: Agent[] = ["a", "b", "c", "d"];
const AVATAR_COLORS = [
  "var(--primary)",
  "var(--secondary)",
  "var(--success)",
  "var(--warning)",
];

/** The hero: a board several agents work at once, one card mid-flight. */
export const Hero = ({ theme }: ClipProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // A breathing ring on the card an agent is working right now.
  const pulse = (Math.sin((frame / fps) * Math.PI * 1.3) + 1) / 2;
  const ring = 3 + pulse * 5;
  const ringAlpha = Math.round((0.12 + pulse * 0.18) * 100);

  // Presence roster scales in, and a comment bubble rises and settles away.
  const roster = interpolate(frame, [6, 26], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });
  const bubble = interpolate(frame, [35, 75, 165, 205], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });

  return (
    <Stage theme={theme}>
      <Chrome />
      <BoardBase columns={COLUMNS} />

      {LAYOUT.map((count, i) =>
        Array.from({ length: count }).map((_, j) => {
          const active = i === 1 && j === 0;
          const agent = AGENTS[(i + j) % AGENTS.length];
          return (
            <Card
              key={`${i}-${j}`}
              x={colX(COLUMNS, i)}
              y={cardY(j)}
              w={colWidth(COLUMNS)}
              accent={active}
              style={
                active
                  ? {
                      boxShadow: `0 0 0 ${ring}px color-mix(in oklab, var(--primary) ${ringAlpha}%, transparent)`,
                    }
                  : undefined
              }
            >
              <CardBody spec={{ lines: [78, 52], agent }} />
            </Card>
          );
        }),
      )}

      {/* Presence roster, top-right of the canvas. */}
      <div
        style={{
          position: "absolute",
          top: CHROME_H + 16,
          right: PAD - 14,
          display: "flex",
          transform: `scale(${roster})`,
          transformOrigin: "top right",
        }}
      >
        {AVATAR_COLORS.map((color, i) => (
          <div key={i} style={{ marginLeft: i === 0 ? 0 : -10 }}>
            <Avatar color={color} ring="var(--surface)" />
          </div>
        ))}
      </div>

      {/* A comment an agent just left on the board. */}
      <div
        style={{
          position: "absolute",
          left: PAD + 14,
          bottom: 34,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
          border: "1px solid var(--border)",
          borderRadius: 14,
          background: "var(--card)",
          boxShadow:
            "0 24px 50px -34px color-mix(in oklab, var(--foreground) 60%, transparent)",
          opacity: bubble,
          transform: `translateY(${(1 - bubble) * 16}px)`,
        }}
      >
        <Avatar color="var(--secondary)" size={30} />
        <div style={{ display: "grid", gap: 8, width: 150 }}>
          <Line w="82%" />
          <Line w="50%" />
        </div>
      </div>

      {/* The active card sits in column 2, row 1 — annotate it. */}
      <div
        style={{
          position: "absolute",
          left: colX(COLUMNS, 1) + 4,
          top: cardY(0) - 22,
          color: "var(--primary)",
          fontSize: 15,
          fontWeight: 600,
          letterSpacing: "0.01em",
          opacity: pulse * 0.9 + 0.1,
        }}
      >
        agent · working
      </div>
    </Stage>
  );
};
