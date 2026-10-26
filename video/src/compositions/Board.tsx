import type { CSSProperties, ReactNode } from "react";
import { interpolate, useCurrentFrame } from "remotion";

import {
  AGENT_COLORS,
  BoardBase,
  Card,
  CardBody,
  Chrome,
  Cursor,
  Line,
  Pill,
  ViewSwitcher,
  type BoardView,
} from "../components/board";
import { Stage } from "../components/Stage";
import {
  CARD_H,
  CHROME_H,
  HEIGHT,
  PAD,
  WIDTH,
  colWidth,
  colX,
  cardY,
} from "../lib/layout";
import { easeInOut } from "../lib/motion";
import type { ClipProps } from "../lib/types";

const COLUMNS = 3;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Drag & drop, then the same board as a calendar, then as a table. */
export const Board = ({ theme }: ClipProps) => {
  const frame = useCurrentFrame();

  // Kanban is visible at both ends (so the loop is seamless); the other two
  // views only appear in the middle, crossfading between each other.
  const kanban = interpolate(frame, [0, 90, 110, 290, 300], [1, 1, 0, 0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const calendar = interpolate(
    frame,
    [0, 90, 110, 190, 210, 300],
    [0, 0, 1, 1, 0, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const table = interpolate(frame, [0, 190, 210, 290, 300], [0, 0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const active: BoardView =
    frame < 100
      ? "kanban"
      : frame < 200
        ? "calendar"
        : frame < 290
          ? "table"
          : "kanban";

  return (
    <Stage theme={theme}>
      <Chrome />
      <div
        style={{ position: "absolute", top: (CHROME_H - 40) / 2, right: 18 }}
      >
        <ViewSwitcher active={active} />
      </div>

      <Layer opacity={kanban}>
        <KanbanLayer frame={frame} />
      </Layer>
      <Layer opacity={calendar}>
        <CalendarLayer frame={frame} />
      </Layer>
      <Layer opacity={table}>
        <TableLayer frame={frame} />
      </Layer>
    </Stage>
  );
};

const Layer = ({
  opacity,
  children,
}: {
  opacity: number;
  children: ReactNode;
}) => <div style={{ position: "absolute", inset: 0, opacity }}>{children}</div>;

/* -------------------------------------------------------------------------
 * Kanban — a card lifted out of one column and dropped into the next.
 * ----------------------------------------------------------------------- */

const KanbanLayer = ({ frame }: { frame: number }) => {
  const startX = colX(COLUMNS, 0);
  const endX = colX(COLUMNS, 1);
  const rowY = cardY(1);
  const width = colWidth(COLUMNS);

  // The drag runs while the layer is visible; the card snaps back while the
  // layer is invisible, so frame 0 and frame 300 match.
  const moved =
    frame >= 200
      ? 0
      : interpolate(frame, [20, 80], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: easeInOut,
        });
  const lift = Math.sin(moved * Math.PI);
  const x = lerp(startX, endX, moved);
  const y = rowY - lift * 44;

  return (
    <>
      <BoardBase columns={COLUMNS} accentIndex={1} />

      <Card x={colX(COLUMNS, 0)} y={cardY(0)} w={width}>
        <CardBody spec={{ lines: [72, 50] }} />
      </Card>
      <Card x={colX(COLUMNS, 1)} y={cardY(0)} w={width}>
        <CardBody spec={{ lines: [80, 55], check: true }} />
      </Card>
      <Card x={colX(COLUMNS, 2)} y={cardY(0)} w={width}>
        <CardBody spec={{ lines: [60], agent: AGENT_COLORS[2] }} />
      </Card>

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

      <Cursor
        x={x + width * 0.6}
        y={y + CARD_H * 0.62}
        label="You"
        color="var(--primary)"
        opacity={lift}
      />
    </>
  );
};

/* -------------------------------------------------------------------------
 * Calendar — a month grid with cards on days, one dragged to a new date.
 * ----------------------------------------------------------------------- */

const CAL_COLS = 7;
const CAL_ROWS = 4;
const CAL_GAP = 12;
const CAL_TOP = CHROME_H + 64;
const CAL_W = WIDTH - PAD * 2;
const CAL_CELL_W = (CAL_W - CAL_GAP * (CAL_COLS - 1)) / CAL_COLS;
const CAL_HEAD = 30;
const CAL_ROWS_H = HEIGHT - CAL_TOP - PAD;
const CAL_CELL_H =
  (CAL_ROWS_H - CAL_HEAD - CAL_GAP - CAL_GAP * (CAL_ROWS - 1)) / CAL_ROWS;

const calX = (col: number) => PAD + col * (CAL_CELL_W + CAL_GAP);
const calY = (row: number) =>
  CAL_TOP + CAL_HEAD + CAL_GAP + row * (CAL_CELL_H + CAL_GAP);

// A few days carry one or two cards; the dragged one starts at (1,1).
const CAL_CARDS: { row: number; col: number; agent: number }[] = [
  { row: 0, col: 1, agent: 0 },
  { row: 0, col: 4, agent: 3 },
  { row: 1, col: 2, agent: 5 },
  { row: 1, col: 5, agent: 1 },
  { row: 2, col: 0, agent: 6 },
  { row: 2, col: 3, agent: 2 },
  { row: 3, col: 1, agent: 8 },
  { row: 3, col: 6, agent: 4 },
];
const DRAG_FROM = { row: 1, col: 1 };
const DRAG_TO = { row: 2, col: 4 };

const CalendarLayer = ({ frame }: { frame: number }) => {
  const drag = interpolate(frame, [115, 155], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeInOut,
  });
  const lift = Math.sin(drag * Math.PI);
  const chipW = CAL_CELL_W - 16;
  const chipX = lerp(calX(DRAG_FROM.col) + 8, calX(DRAG_TO.col) + 8, drag);
  const chipY =
    lerp(calY(DRAG_FROM.row) + 34, calY(DRAG_TO.row) + 34, drag) - lift * 26;

  return (
    <>
      {/* Weekday header. */}
      {Array.from({ length: CAL_COLS }).map((_, col) => (
        <Line
          key={col}
          w={CAL_CELL_W * 0.42}
          h={10}
          style={{
            position: "absolute",
            left: calX(col) + 8,
            top: CAL_TOP + 6,
            background: "var(--border)",
          }}
        />
      ))}

      {Array.from({ length: CAL_ROWS }).map((_, row) =>
        Array.from({ length: CAL_COLS }).map((_, col) => (
          <div
            key={`${row}-${col}`}
            style={{
              position: "absolute",
              left: calX(col),
              top: calY(row),
              width: CAL_CELL_W,
              height: CAL_CELL_H,
              borderRadius: 12,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              padding: 8,
            }}
          >
            <Line w={22} h={9} style={{ background: "var(--border)" }} />
          </div>
        )),
      )}

      {CAL_CARDS.map((card, i) => {
        const hidden = card.row === DRAG_FROM.row && card.col === DRAG_FROM.col;
        return (
          <CalendarChip
            key={i}
            x={calX(card.col) + 8}
            y={calY(card.row) + 34}
            w={chipW}
            color={AGENT_COLORS[card.agent]}
            opacity={hidden ? 0 : 1}
          />
        );
      })}

      {/* The card being dragged to another date. */}
      <CalendarChip
        x={chipX}
        y={chipY}
        w={chipW}
        color={AGENT_COLORS[7]}
        accent
        style={{
          scale: 1 + lift * 0.06,
          boxShadow: `0 26px 40px -22px color-mix(in oklab, var(--foreground) ${
            24 + Math.round(lift * 44)
          }%, transparent)`,
        }}
      />
      <Cursor
        x={chipX + chipW * 0.7}
        y={chipY + 18}
        label="You"
        opacity={lift}
      />
    </>
  );
};

const CalendarChip = ({
  x,
  y,
  w,
  color,
  opacity = 1,
  accent = false,
  style,
}: {
  x: number;
  y: number;
  w: number;
  color: string;
  opacity?: number;
  accent?: boolean;
  style?: CSSProperties;
}) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      width: w,
      height: 26,
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "0 8px",
      borderRadius: 7,
      border: `1px solid ${
        accent
          ? "color-mix(in oklab, var(--primary) 50%, var(--border))"
          : "var(--border)"
      }`,
      background: "var(--card)",
      opacity,
      ...style,
    }}
  >
    <div
      style={{
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: color,
        flex: "none",
      }}
    />
    <Line w="60%" h={8} />
  </div>
);

/* -------------------------------------------------------------------------
 * Table — rows with sortable columns and an inline edit.
 * ----------------------------------------------------------------------- */

const TABLE_COLS = [0.42, 0.2, 0.2, 0.18];
const TABLE_TOP = CAL_TOP;
const TABLE_ROW_H = 58;
const TABLE_GAP = 8;

const tableColW = (i: number) => TABLE_COLS[i] * CAL_W;

const TableLayer = ({ frame }: { frame: number }) => {
  const rows = Array.from({ length: 6 });
  const sort = Math.floor(frame / 22) % 3 === 0;
  const editRow = 2;
  const caret = Math.floor(frame / 15) % 2 === 0;

  return (
    <>
      {/* Header */}
      <div
        style={{
          position: "absolute",
          left: PAD,
          top: TABLE_TOP,
          width: CAL_W,
          display: "flex",
          alignItems: "center",
          height: 40,
          borderBottom: "1px solid var(--border)",
        }}
      >
        {TABLE_COLS.map((_, i) => (
          <div
            key={i}
            style={{
              width: tableColW(i),
              paddingLeft: 12,
              display: "flex",
              gap: 8,
            }}
          >
            <Line
              w={i === 0 ? "30%" : "46%"}
              h={10}
              style={{ background: "var(--border)" }}
            />
            {i === 0 && sort ? <SortArrow /> : null}
          </div>
        ))}
      </div>

      {rows.map((_, row) => {
        const editing = row === editRow;
        return (
          <div
            key={row}
            style={{
              position: "absolute",
              left: PAD,
              top: TABLE_TOP + 40 + TABLE_GAP + row * (TABLE_ROW_H + TABLE_GAP),
              width: CAL_W,
              height: TABLE_ROW_H,
              display: "flex",
              alignItems: "center",
              borderRadius: 10,
              border: `1px solid ${editing ? "color-mix(in oklab, var(--primary) 50%, var(--border))" : "var(--border)"}`,
              background: editing
                ? "color-mix(in oklab, var(--primary) 8%, var(--card))"
                : "var(--card)",
            }}
          >
            <div
              style={{
                width: tableColW(0),
                paddingLeft: 12,
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: AGENT_COLORS[row % AGENT_COLORS.length],
                  flex: "none",
                }}
              />
              <Line w="70%" />
              {editing ? (
                <span
                  style={{ color: "var(--primary)", opacity: caret ? 1 : 0 }}
                >
                  ▍
                </span>
              ) : null}
            </div>
            <div style={{ width: tableColW(1), paddingLeft: 12 }}>
              <div style={{ display: "flex", gap: 6 }}>
                <Pill
                  w={30}
                  color={AGENT_COLORS[(row + 3) % AGENT_COLORS.length]}
                />
                {row % 2 === 0 ? (
                  <Pill w={22} color="var(--secondary)" />
                ) : null}
              </div>
            </div>
            <div style={{ width: tableColW(2), paddingLeft: 12 }}>
              <Line w="52%" />
            </div>
            <div style={{ width: tableColW(3), paddingLeft: 12 }}>
              <div
                style={{
                  width: 74,
                  height: 22,
                  borderRadius: 999,
                  background:
                    "color-mix(in oklab, var(--success) 16%, transparent)",
                }}
              />
            </div>
          </div>
        );
      })}
    </>
  );
};

const SortArrow = () => (
  <svg
    viewBox="0 0 24 24"
    width={14}
    height={14}
    fill="none"
    stroke="var(--primary)"
    strokeWidth={2.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ marginTop: 1 }}
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);
