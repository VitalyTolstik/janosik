import type { CSSProperties, ReactNode } from "react";

import { CARD_H, CHROME_H, HEIGHT, PAD, colWidth, colX } from "../lib/layout";

/** Ten distinct agent colours (the app's label palette), so a swarm reads as
 * many separate workers rather than four. */
export const AGENT_COLORS = [
  "var(--primary)",
  "var(--secondary)",
  "var(--success)",
  "var(--warning)",
  "var(--indigo)",
  "var(--pink)",
  "var(--teal)",
  "var(--orange)",
  "var(--fuchsia)",
  "var(--blue)",
] as const;

const mutedLine =
  "color-mix(in oklab, var(--muted-foreground) 32%, transparent)";

export const Line = ({
  w = "70%",
  h = 10,
  style,
}: {
  w?: string | number;
  h?: number;
  style?: CSSProperties;
}) => (
  <div
    style={{
      width: w,
      height: h,
      borderRadius: 999,
      background: mutedLine,
      ...style,
    }}
  />
);

export const Pill = ({
  w = 24,
  color = "var(--primary)",
}: {
  w?: number;
  color?: string;
}) => (
  <div style={{ width: w, height: 10, borderRadius: 999, background: color }} />
);

export const Check = ({
  on = false,
  size = 18,
}: {
  on?: boolean;
  size?: number;
}) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: 5,
      flex: "none",
      border: `2px solid ${
        on
          ? "var(--primary)"
          : "color-mix(in oklab, var(--muted-foreground) 45%, transparent)"
      }`,
      background: on
        ? "color-mix(in oklab, var(--primary) 28%, transparent)"
        : "transparent",
      display: "grid",
      placeItems: "center",
    }}
  >
    {on ? (
      <svg
        viewBox="0 0 24 24"
        width={size * 0.62}
        height={size * 0.62}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={3.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    ) : null}
  </div>
);

export const Avatar = ({
  color = "var(--primary)",
  size = 30,
  ring = "var(--card)",
}: {
  color?: string;
  size?: number;
  ring?: string;
}) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: "50%",
      background: color,
      border: `2px solid ${ring}`,
      flex: "none",
    }}
  />
);

export const AgentDot = ({
  color,
  size = 16,
}: {
  color: string;
  size?: number;
}) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: "50%",
      background: color,
      flex: "none",
    }}
  />
);

export interface CardSpec {
  /** Line widths, as percentages of the card width. */
  lines: number[];
  pill?: boolean;
  check?: boolean;
  /** An agent colour (from `AGENT_COLORS`). */
  agent?: string;
}

export const CardBody = ({
  spec,
  checkOn = false,
}: {
  spec: CardSpec;
  checkOn?: boolean;
}) => (
  <div style={{ display: "grid", gap: 10 }}>
    {spec.lines.map((w, i) => (
      <Line key={i} w={`${w}%`} />
    ))}
    {spec.pill || spec.check || spec.agent ? (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          minHeight: 18,
        }}
      >
        {spec.pill ? (
          <div style={{ display: "flex", gap: 6 }}>
            <Pill />
            <Pill w={18} color="var(--secondary)" />
          </div>
        ) : (
          <span />
        )}
        {spec.check ? <Check on={checkOn} /> : null}
        {spec.agent ? <AgentDot color={spec.agent} /> : null}
      </div>
    ) : null}
  </div>
);

/** An absolutely-positioned card. Position/size come from `layout.ts`. */
export const Card = ({
  x,
  y,
  w,
  h = CARD_H,
  children,
  style,
  accent = false,
  className,
}: {
  x: number;
  y: number;
  w: number;
  h?: number;
  children?: ReactNode;
  style?: CSSProperties;
  accent?: boolean;
  className?: string;
}) => (
  <div
    className={className}
    style={{
      position: "absolute",
      left: x,
      top: y,
      width: w,
      height: h,
      padding: 16,
      borderRadius: 14,
      border: `1px solid ${
        accent
          ? "color-mix(in oklab, var(--primary) 50%, var(--border))"
          : "var(--border)"
      }`,
      background: "var(--card)",
      display: "grid",
      alignContent: "start",
      gap: 10,
      ...style,
    }}
  >
    {children}
  </div>
);

/** The static board: canvas + column boxes + header bars. */
export const BoardBase = ({
  columns,
  accentIndex,
}: {
  columns: number;
  accentIndex?: number;
}) => (
  <>
    {Array.from({ length: columns }).map((_, i) => (
      <div
        key={i}
        style={{
          position: "absolute",
          left: colX(columns, i),
          top: PAD,
          width: colWidth(columns),
          height: HEIGHT - CHROME_H - PAD * 2,
          borderRadius: 16,
          background: "var(--surface)",
          padding: 14,
          border: `1px solid ${
            accentIndex === i
              ? "color-mix(in oklab, var(--primary) 40%, var(--border))"
              : "transparent"
          }`,
        }}
      >
        <div
          style={{
            width: "55%",
            height: 10,
            borderRadius: 999,
            background: "var(--border)",
          }}
        />
      </div>
    ))}
  </>
);

const dot: CSSProperties = {
  width: 12,
  height: 12,
  borderRadius: "50%",
  background: "var(--border)",
};

/** The window chrome bar every clip shares. */
export const Chrome = () => (
  <div
    style={{
      position: "absolute",
      left: 0,
      top: 0,
      right: 0,
      height: CHROME_H,
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "0 18px",
      borderBottom: "1px solid var(--border)",
      background: "var(--card)",
    }}
  >
    <span style={dot} />
    <span style={dot} />
    <span style={dot} />
    <div
      style={{
        width: 200,
        height: 10,
        borderRadius: 999,
        background: "var(--border)",
        marginLeft: 12,
      }}
    />
  </div>
);

export const Cursor = ({
  x,
  y,
  color = "var(--primary)",
  label,
  opacity = 1,
}: {
  x: number;
  y: number;
  color?: string;
  label?: string;
  opacity?: number;
}) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      display: "flex",
      alignItems: "flex-start",
      gap: 2,
      color,
      opacity,
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
    {label ? (
      <span
        style={{
          marginTop: 20,
          padding: "3px 9px",
          borderRadius: 999,
          background: color,
          color: "#fff",
          fontSize: 14,
          fontWeight: 600,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    ) : null}
  </div>
);

export type BoardView = "kanban" | "calendar" | "table";

const VIEW_LABELS: Record<BoardView, string> = {
  kanban: "Kanban",
  calendar: "Calendar",
  table: "Table",
};

/** The kanban / calendar / table segmented control, shown in the chrome bar. */
export const ViewSwitcher = ({ active }: { active: BoardView }) => (
  <div
    style={{
      display: "flex",
      gap: 4,
      padding: 4,
      borderRadius: 999,
      background: "var(--surface)",
      border: "1px solid var(--border)",
    }}
  >
    {(Object.keys(VIEW_LABELS) as BoardView[]).map((view) => (
      <span
        key={view}
        style={{
          padding: "6px 16px",
          borderRadius: 999,
          fontSize: 15,
          fontWeight: 600,
          background: active === view ? "var(--primary)" : "transparent",
          color:
            active === view
              ? "var(--primary-foreground)"
              : "var(--muted-foreground)",
        }}
      >
        {VIEW_LABELS[view]}
      </span>
    ))}
  </div>
);
