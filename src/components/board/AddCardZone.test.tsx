import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { AddCardZone } from "@/components/board/AddCardZone";
import { I18nProvider } from "@/i18n";

/**
 * A column carries one zone per card gap, so these were the single biggest
 * source of renders on the board: 42 per keystroke on a 40-card board,
 * before `memo` and the index-carrying callback (TASK-21.4.1).
 *
 * Render counting goes through the icon the zone renders: a mock inside the
 * memoized subtree runs exactly when the zone itself runs. (A DOM-identity
 * check would prove nothing — React keeps the node across re-renders — and
 * `<Profiler>` fires per commit of the surrounding tree, not per component.)
 */

const counter = vi.hoisted(() => ({ icons: 0 }));

vi.mock("lucide-react", async () => {
  const actual =
    await vi.importActual<typeof import("lucide-react")>("lucide-react");
  return {
    ...actual,
    Plus: (props: Record<string, unknown>) => {
      counter.icons += 1;
      return <actual.Plus {...props} />;
    },
  };
});

describe("AddCardZone", () => {
  it("reports the gap it sits in", () => {
    const onInsert = vi.fn();
    render(
      <I18nProvider>
        <ul>
          <AddCardZone index={3} onInsert={onInsert} />
        </ul>
      </I18nProvider>,
    );

    screen.getByTestId("card-insert-3").click();

    expect(onInsert).toHaveBeenCalledWith(3);
  });

  it("renders an inert spacer when insertion is not allowed", () => {
    render(
      <I18nProvider>
        <ul>
          <AddCardZone index={0} interactive={false} onInsert={vi.fn()} />
        </ul>
      </I18nProvider>,
    );

    expect(screen.queryByTestId("card-insert-0")).toBeNull();
  });

  it("skips the re-render when its props are unchanged", () => {
    let siblingRenders = 0;
    function Sibling() {
      siblingRenders += 1;
      return null;
    }
    const onInsert = vi.fn();
    let bump = () => {};

    function Parent() {
      const [, setTick] = useState(0);
      bump = () => setTick((tick) => tick + 1);
      return (
        <ul>
          <AddCardZone index={1} onInsert={onInsert} />
          <Sibling />
        </ul>
      );
    }

    render(
      <I18nProvider>
        <Parent />
      </I18nProvider>,
    );
    const iconsAfterMount = counter.icons;
    const siblingsAfterMount = siblingRenders;
    expect(iconsAfterMount).toBeGreaterThan(0);

    // The column around the zones re-renders whenever one of its own cards
    // changes; the zones must sit that out.
    act(() => bump());

    // The sibling proves the parent really did re-render...
    expect(siblingRenders).toBe(siblingsAfterMount + 1);
    // ...while the zone did not.
    expect(counter.icons).toBe(iconsAfterMount);
  });
});
