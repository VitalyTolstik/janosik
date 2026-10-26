import { interpolate, useCurrentFrame } from "remotion";

import { BoardBase, Card, CardBody, Chrome, Cursor } from "../components/board";
import { Stage } from "../components/Stage";
import { CARD_H, colWidth, colX, cardY } from "../lib/layout";
import { easeInOut } from "../lib/motion";
import type { ClipProps } from "../lib/types";

const COLUMNS = 3;

/** Drag & drop: a card lifts out of one column and lands in the next, then
 * returns — so the clip reads as a clean loop. */
export const Board = ({ theme }: ClipProps) => {
  const frame = useCurrentFrame();

  const startX = colX(COLUMNS, 0);
  const endX = colX(COLUMNS, 1);
  const rowY = cardY(1);

  const forward = interpolate(frame, [25, 95], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeInOut,
  });
  const back = interpolate(frame, [150, 215], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeInOut,
  });
  const p = Math.min(forward, back);

  const lift = Math.sin(p * Math.PI);
  const x = startX + (endX - startX) * p;
  const y = rowY - lift * 44;
  const width = colWidth(COLUMNS);

  return (
    <Stage theme={theme}>
      <Chrome />
      <BoardBase columns={COLUMNS} accentIndex={1} />

      <Card x={colX(COLUMNS, 0)} y={cardY(0)} w={width}>
        <CardBody spec={{ lines: [72, 50] }} />
      </Card>
      <Card x={colX(COLUMNS, 1)} y={cardY(0)} w={width}>
        <CardBody spec={{ lines: [80, 55], check: true }} />
      </Card>
      <Card x={colX(COLUMNS, 2)} y={cardY(0)} w={width}>
        <CardBody spec={{ lines: [60], agent: "c" }} />
      </Card>

      {/* The card being dragged. */}
      <Card
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
        <CardBody spec={{ lines: [68, 46], pill: true }} />
      </Card>

      {/* The pointer follows the card while it is in the air. */}
      <Cursor
        x={x + width * 0.6}
        y={y + CARD_H * 0.62}
        label="You"
        color="var(--primary)"
        opacity={lift}
      />
    </Stage>
  );
};
