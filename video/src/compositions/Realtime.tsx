import { interpolate, useCurrentFrame } from "remotion";

import {
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

/** Realtime: a teammate's card lands in a column live, with their cursor and
 * avatar — then the moment resets for a seamless loop. */
export const Realtime = ({ theme }: ClipProps) => {
  const frame = useCurrentFrame();

  const targetX = colX(COLUMNS, 2);
  const targetY = cardY(0);

  const appear = pingPong(frame, 55, 85, 165, 195);
  const scale = interpolate(appear, [0, 1], [0.86, 1]);
  const ringAlpha = Math.round(
    interpolate(frame, [55, 95, 150], [0, 0.4, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }) * 100,
  );

  const cursorX = travel(
    frame,
    20,
    55,
    165,
    195,
    1090,
    targetX + colWidth(COLUMNS) * 0.42,
  );
  const cursorY = travel(frame, 20, 55, 165, 195, 640, targetY + 36);
  const cursorOpacity = interpolate(frame, [8, 22, 188, 205], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const avatarPop = pingPong(frame, 45, 72, 175, 200);

  return (
    <Stage theme={theme}>
      <Chrome />
      <BoardBase columns={COLUMNS} />

      <Card x={colX(COLUMNS, 0)} y={cardY(0)} w={colWidth(COLUMNS)}>
        <CardBody spec={{ lines: [70, 48] }} />
      </Card>
      <Card x={colX(COLUMNS, 0)} y={cardY(1)} w={colWidth(COLUMNS)}>
        <CardBody spec={{ lines: [58, 36] }} />
      </Card>
      <Card x={colX(COLUMNS, 1)} y={cardY(0)} w={colWidth(COLUMNS)}>
        <CardBody spec={{ lines: [76, 52], check: true }} />
      </Card>

      {/* The card arriving from a teammate. */}
      <Card
        x={targetX}
        y={targetY}
        w={colWidth(COLUMNS)}
        accent
        style={{
          opacity: appear,
          scale,
          transformOrigin: "center",
          boxShadow: `0 0 0 3px color-mix(in oklab, var(--primary) ${ringAlpha}%, transparent)`,
        }}
      >
        <CardBody spec={{ lines: [72, 50], agent: "b" }} />
      </Card>

      {/* Presence: a teammate joins. */}
      <div
        style={{
          position: "absolute",
          top: CHROME_H + 16,
          right: PAD - 14,
          transform: `scale(${avatarPop})`,
          transformOrigin: "top right",
        }}
      >
        <Avatar color="var(--secondary)" ring="var(--surface)" />
      </div>

      <Cursor
        x={cursorX}
        y={cursorY}
        label="Mira"
        color="var(--secondary)"
        opacity={cursorOpacity}
      />
    </Stage>
  );
};
