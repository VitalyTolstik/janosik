import { interpolate, useCurrentFrame } from "remotion";

import {
  AGENT_COLORS,
  Avatar,
  BoardBase,
  Card,
  CardBody,
  Chrome,
  Cursor,
} from "../components/board";
import { Stage } from "../components/Stage";
import { CHROME_H, PAD, colWidth, colX, cardY } from "../lib/layout";
import { pingPong, travel } from "../lib/motion";
import type { ClipProps } from "../lib/types";

const COLUMNS = 3;
const width = colWidth(COLUMNS);

// Four teammates moving around the board at once. `from` is off to a corner,
// `to` is where they land; each leaves again so the clip loops.
const PEOPLE = [
  {
    label: "Mira",
    color: AGENT_COLORS[1],
    from: [1120, 640] as const,
    to: [colX(COLUMNS, 2) + width * 0.45, cardY(0) + 40] as const,
    in: [20, 60] as const,
    out: [240, 278] as const,
  },
  {
    label: "Alex",
    color: AGENT_COLORS[3],
    from: [880, 250] as const,
    to: [colX(COLUMNS, 1) + width * 0.5, cardY(1) + 46] as const,
    in: [45, 88] as const,
    out: [248, 288] as const,
  },
  {
    label: "Sam",
    color: AGENT_COLORS[5],
    from: [260, 680] as const,
    to: [colX(COLUMNS, 0) + width * 0.5, cardY(0) + 50] as const,
    in: [70, 112] as const,
    out: [252, 292] as const,
  },
  {
    label: "Noor",
    color: AGENT_COLORS[6],
    from: [1160, 180] as const,
    to: [colX(COLUMNS, 2) + width * 0.5, cardY(2) + 44] as const,
    in: [95, 138] as const,
    out: [256, 296] as const,
  },
];

/** Realtime: several people on the board at once — cursors, presence, and
 * cards landing live. */
export const Realtime = ({ theme }: ClipProps) => {
  const frame = useCurrentFrame();

  const cardA = pingPong(frame, 55, 85, 232, 272);
  const cardB = pingPong(frame, 88, 118, 240, 284);
  const roster = interpolate(frame, [40, 90, 258, 296], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <Stage theme={theme}>
      <Chrome />
      <BoardBase columns={COLUMNS} />

      <Card x={colX(COLUMNS, 0)} y={cardY(1)} w={width}>
        <CardBody spec={{ lines: [70, 48] }} />
      </Card>
      <Card x={colX(COLUMNS, 0)} y={cardY(2)} w={width}>
        <CardBody spec={{ lines: [58, 36] }} />
      </Card>
      <Card x={colX(COLUMNS, 1)} y={cardY(0)} w={width}>
        <CardBody spec={{ lines: [76, 52], check: true }} />
      </Card>
      <Card x={colX(COLUMNS, 2)} y={cardY(1)} w={width}>
        <CardBody spec={{ lines: [64, 42] }} />
      </Card>

      {/* Cards landing as teammates drop them in. */}
      <Card
        x={colX(COLUMNS, 2)}
        y={cardY(0)}
        w={width}
        accent
        style={{
          opacity: cardA,
          scale: interpolate(cardA, [0, 1], [0.88, 1]),
          transformOrigin: "center",
          boxShadow: `0 0 0 3px color-mix(in oklab, var(--primary) ${Math.round(
            interpolate(frame, [55, 95, 150], [0, 0.4, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }) * 100,
          )}%, transparent)`,
        }}
      >
        <CardBody spec={{ lines: [72, 50], agent: AGENT_COLORS[1] }} />
      </Card>

      <Card
        x={colX(COLUMNS, 1)}
        y={cardY(1)}
        w={width}
        accent
        style={{
          opacity: cardB,
          scale: interpolate(cardB, [0, 1], [0.88, 1]),
          transformOrigin: "center",
          boxShadow: `0 0 0 3px color-mix(in oklab, var(--primary) ${Math.round(
            interpolate(frame, [88, 128, 180], [0, 0.4, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }) * 100,
          )}%, transparent)`,
        }}
      >
        <CardBody spec={{ lines: [66, 44], agent: AGENT_COLORS[3] }} />
      </Card>

      {/* Presence: everyone who is here right now. */}
      <div
        style={{
          position: "absolute",
          top: CHROME_H + 16,
          right: PAD - 14,
          display: "flex",
          opacity: roster,
        }}
      >
        {PEOPLE.map((person, i) => {
          const pop = interpolate(frame, [40 + i * 16, 66 + i * 16], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          return (
            <div
              key={person.label}
              style={{
                marginLeft: i === 0 ? 0 : -10,
                scale: pop,
                transformOrigin: "center",
              }}
            >
              <Avatar color={person.color} ring="var(--surface)" />
            </div>
          );
        })}
      </div>

      {/* Several live cursors. */}
      {PEOPLE.map((person) => {
        const x = travel(
          frame,
          person.in[0],
          person.in[1],
          person.out[0],
          person.out[1],
          person.from[0],
          person.to[0],
        );
        const y = travel(
          frame,
          person.in[0],
          person.in[1],
          person.out[0],
          person.out[1],
          person.from[1],
          person.to[1],
        );
        const opacity = interpolate(
          frame,
          [person.in[0] - 8, person.in[0], person.out[1], person.out[1] + 8],
          [0, 1, 1, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        );
        return (
          <Cursor
            key={person.label}
            x={x}
            y={y}
            label={person.label}
            color={person.color}
            opacity={opacity}
          />
        );
      })}
    </Stage>
  );
};
