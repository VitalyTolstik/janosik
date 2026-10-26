import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";

import {
  AGENT_COLORS,
  Avatar,
  BoardBase,
  Card,
  CardBody,
  Chrome,
  Line,
} from "../components/board";
import { Stage } from "../components/Stage";
import { CHROME_H, PAD, colWidth, colX, cardY } from "../lib/layout";
import { easeInOut, easeOut } from "../lib/motion";
import type { ClipProps } from "../lib/types";

const COLUMNS = 5;
const ROWS = 4;

type Slot = { col: number; row: number };

// Three cards are, at any moment, in the air — carried between columns by an
// agent. Each returns to its slot before the clip ends, so the loop is clean.
const MOVERS: {
  from: Slot;
  to: Slot;
  agent: number;
  forward: [number, number];
  back: [number, number];
}[] = [
  {
    from: { col: 0, row: 2 },
    to: { col: 2, row: 2 },
    agent: 0,
    forward: [20, 100],
    back: [150, 230],
  },
  {
    from: { col: 3, row: 1 },
    to: { col: 1, row: 3 },
    agent: 4,
    forward: [50, 130],
    back: [180, 260],
  },
  {
    from: { col: 1, row: 0 },
    to: { col: 4, row: 1 },
    agent: 7,
    forward: [80, 160],
    back: [210, 290],
  },
];

// Slots occupied by a mover (source or destination) are not drawn as static
// cards — the moving card covers them.
const OCCUPIED = new Set(
  MOVERS.flatMap((m) => [
    `${m.from.col}-${m.from.row}`,
    `${m.to.col}-${m.to.row}`,
  ]),
);

const BASE: Slot[] = [];
for (let col = 0; col < COLUMNS; col++) {
  for (let row = 0; row < ROWS; row++) {
    if (!OCCUPIED.has(`${col}-${row}`)) BASE.push({ col, row });
  }
}

// Four of the static cards are being worked right now (a breathing ring).
const ACTIVE = new Set(["0-0", "2-1", "4-0", "3-2"]);

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The hero: a swarm of agents working the board — many cards in flight. */
export const Hero = ({ theme }: ClipProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const roster = interpolate(frame, [6, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });
  const bubbleA = interpolate(frame, [60, 100, 230, 275], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });
  const bubbleB = interpolate(frame, [130, 170, 245, 290], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });

  const width = colWidth(COLUMNS);

  return (
    <Stage theme={theme}>
      <Chrome />
      <BoardBase columns={COLUMNS} />

      {BASE.map(({ col, row }, index) => {
        const active = ACTIVE.has(`${col}-${row}`);
        const pulse =
          (Math.sin((frame / fps) * Math.PI * 1.2 + index * 1.7) + 1) / 2;
        const ring = 3 + pulse * 5;
        const ringAlpha = Math.round((0.1 + pulse * 0.18) * 100);
        return (
          <Card
            key={`${col}-${row}`}
            x={colX(COLUMNS, col)}
            y={cardY(row)}
            w={width}
            accent={active}
            style={
              active
                ? {
                    boxShadow: `0 0 0 ${ring}px color-mix(in oklab, var(--primary) ${ringAlpha}%, transparent)`,
                  }
                : undefined
            }
          >
            <CardBody
              spec={{
                lines: [78, 52],
                agent: AGENT_COLORS[(col * ROWS + row) % AGENT_COLORS.length],
              }}
            />
          </Card>
        );
      })}

      {/* Cards in flight — carried between columns. */}
      {MOVERS.map((mover, i) => {
        const forward = interpolate(frame, mover.forward, [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: easeInOut,
        });
        const back = interpolate(frame, mover.back, [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: easeInOut,
        });
        const p = Math.min(forward, back);
        const lift = Math.sin(p * Math.PI);
        const x = lerp(
          colX(COLUMNS, mover.from.col),
          colX(COLUMNS, mover.to.col),
          p,
        );
        const y =
          lerp(cardY(mover.from.row), cardY(mover.to.row), p) - lift * 38;
        const color = AGENT_COLORS[mover.agent];
        return (
          <Card
            key={`mover-${i}`}
            x={x}
            y={y}
            w={width}
            accent
            style={{
              scale: 1 + lift * 0.05,
              rotate: `${lift * 3}deg`,
              boxShadow: `0 34px 54px -26px color-mix(in oklab, var(--foreground) ${
                26 + Math.round(lift * 44)
              }%, transparent)`,
            }}
          >
            <CardBody spec={{ lines: [68, 46], agent: color }} />
          </Card>
        );
      })}

      {/* The whole swarm, present. */}
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
        {AGENT_COLORS.map((color, i) => (
          <div key={i} style={{ marginLeft: i === 0 ? 0 : -11 }}>
            <Avatar color={color} size={30} ring="var(--surface)" />
          </div>
        ))}
      </div>

      <div
        style={{
          position: "absolute",
          left: 330,
          top: 0,
          height: CHROME_H,
          display: "flex",
          alignItems: "center",
          color: "var(--muted-foreground)",
          fontSize: 16,
          fontWeight: 600,
          letterSpacing: "0.01em",
        }}
      >
        10 agents · live
      </div>

      {/* Comments landing as agents finish work. */}
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
          opacity: bubbleA,
          transform: `translateY(${(1 - bubbleA) * 16}px)`,
        }}
      >
        <Avatar color={AGENT_COLORS[1]} size={30} />
        <div style={{ display: "grid", gap: 8, width: 150 }}>
          <Line w="82%" />
          <Line w="50%" />
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: colX(COLUMNS, 2) + 8,
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
          opacity: bubbleB,
          transform: `translateY(${(1 - bubbleB) * 16}px)`,
        }}
      >
        <Avatar color={AGENT_COLORS[5]} size={30} />
        <div style={{ display: "grid", gap: 8, width: 130 }}>
          <Line w="88%" />
          <Line w="46%" />
        </div>
      </div>
    </Stage>
  );
};
