import { render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { KeyboardSensor, MouseSensor, TouchSensor } from "@dnd-kit/core";
import { DndBoard } from "@/components/board/DndBoard";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { ThemeProvider } from "@/hooks/use-theme";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";

/**
 * Sensor configuration for touch drag & drop (TASK-21.10).
 *
 * jsdom has no real touch pipeline, so the physics of a gesture cannot be
 * replayed here — what we can verify is the wiring: the board mounts the
 * Mouse/Touch/Keyboard trio with the intended activation constraints, and
 * the descriptors stay reference-stable across renders (project rule §1.2:
 * a fresh sensor array would re-render every sortable consumer).
 */

const dnd = vi.hoisted(() => ({
  sensors: [] as unknown[],
}));

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: (props: ComponentProps<typeof actual.DndContext>) => {
      dnd.sensors = props.sensors ?? [];
      return <actual.DndContext {...props} />;
    },
  };
});

type Descriptor = { sensor: unknown; options: unknown };

function descriptorFor(sensor: unknown): Descriptor | undefined {
  return (dnd.sensors as Descriptor[]).find((d) => d.sensor === sensor);
}

function seedBoard() {
  localStorage.setItem(
    "janosik-boards",
    JSON.stringify([
      {
        id: "b-1",
        title: "Touch",
        columns: [
          { id: "col-1", title: "To do", cardIds: ["card-1"], createdAt: 1 },
        ],
        cards: {
          "card-1": { id: "card-1", title: "Card", labelIds: [], createdAt: 1 },
        },
        labels: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]),
  );
}

function boardTree() {
  return (
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <MemoryRouter initialEntries={["/board/b-1"]}>
                <ToastProvider>
                  <BoardProvider>
                    <DndBoard onCardClick={() => {}} />
                  </BoardProvider>
                </ToastProvider>
              </MemoryRouter>
            </TooltipProvider>
          </I18nProvider>
        </BoardGlassProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>
  );
}

describe("DndBoard sensor configuration (TASK-21.10)", () => {
  beforeEach(() => {
    localStorage.clear();
    seedBoard();
    dnd.sensors = [];
  });

  it("mounts Mouse, Touch and Keyboard sensors together", () => {
    render(boardTree());

    expect(descriptorFor(MouseSensor)).toBeDefined();
    expect(descriptorFor(TouchSensor)).toBeDefined();
    expect(descriptorFor(KeyboardSensor)).toBeDefined();
  });

  it("starts a touch drag on a long press, not on a moving finger", () => {
    render(boardTree());

    const { activationConstraint } = descriptorFor(TouchSensor)?.options as {
      activationConstraint: { delay: number; tolerance: number };
    };
    // A short delay keeps drags responsive; a small tolerance lets the first
    // few pixels of an intended scroll cancel the pending drag.
    expect(activationConstraint.delay).toBeGreaterThanOrEqual(200);
    expect(activationConstraint.delay).toBeLessThanOrEqual(250);
    expect(activationConstraint.tolerance).toBeGreaterThanOrEqual(6);
    expect(activationConstraint.tolerance).toBeLessThanOrEqual(8);
  });

  it("keeps the mouse activation distance unchanged", () => {
    render(boardTree());

    const { activationConstraint } = descriptorFor(MouseSensor)?.options as {
      activationConstraint: { distance: number };
    };
    expect(activationConstraint.distance).toBe(5);
  });

  it("keeps the sensor descriptors stable across re-renders", () => {
    const { rerender } = render(boardTree());
    const first = dnd.sensors;

    rerender(boardTree());
    rerender(boardTree());

    expect(dnd.sensors).toBe(first);
  });
});
