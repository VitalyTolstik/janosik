import { interpolate, useCurrentFrame } from "remotion";

import { BoardBase, Check, Chrome, Line, Pill } from "../components/board";
import { Stage } from "../components/Stage";
import type { ClipProps } from "../lib/types";

const PANEL_W = 560;
const PANEL_H = 470;
const PANEL_X = (1280 - PANEL_W) / 2;
const PANEL_Y = (800 - PANEL_H) / 2;

const TICKS = [30, 60, 90];
const RESET = 210;

/** The card dialog: checklists tick themselves off and labels land on the card. */
export const Cards = ({ theme }: ClipProps) => {
  const frame = useCurrentFrame();

  const pills = interpolate(frame, [120, 150, 210, 235], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const attach = interpolate(frame, [135, 165, 210, 235], [0, 1, 1, 0], {
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
          background: "color-mix(in oklab, var(--background) 52%, transparent)",
        }}
      />

      <div
        style={{
          position: "absolute",
          left: PANEL_X,
          top: PANEL_Y,
          width: PANEL_W,
          height: PANEL_H,
          padding: 28,
          borderRadius: 20,
          border: "1px solid var(--border)",
          background: "var(--card)",
          display: "grid",
          alignContent: "start",
          gap: 20,
          boxShadow:
            "0 40px 80px -46px color-mix(in oklab, var(--foreground) 60%, transparent)",
        }}
      >
        <Line w="58%" h={16} />

        <div style={{ display: "grid", gap: 12 }}>
          <Line w="92%" />
          <Line w="70%" />
        </div>

        <div style={{ display: "grid", gap: 14, marginTop: 6 }}>
          {TICKS.map((at, i) => {
            const on = frame >= at && frame < RESET;
            return (
              <div
                key={i}
                style={{ display: "flex", alignItems: "center", gap: 14 }}
              >
                <Check on={on} size={22} />
                <Line w={["64%", "52%", "58%"][i]} />
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 8, opacity: pills }}>
          <Pill w={54} />
          <Pill w={44} color="var(--secondary)" />
          <Pill w={36} color="var(--success)" />
        </div>

        <div
          style={{
            height: 66,
            borderRadius: 12,
            background: "color-mix(in oklab, var(--primary) 12%, transparent)",
            opacity: attach,
          }}
        />
      </div>
    </Stage>
  );
};
