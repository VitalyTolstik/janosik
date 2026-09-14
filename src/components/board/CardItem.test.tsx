import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n";
import { CardItem } from "@/components/board/CardItem";
import type { Card, Label } from "@/types/kanban";

const baseCard: Card = {
  id: "c-1",
  title: "Short title",
  labelIds: [],
  createdAt: 1,
  updatedAt: 1,
};

function renderCard(
  card: Card = baseCard,
  labels: Label[] = [],
  highlight?: string,
) {
  return render(
    <I18nProvider>
      <TooltipProvider>
        <CardItem card={card} labels={labels} highlight={highlight} />
      </TooltipProvider>
    </I18nProvider>,
  );
}

describe("CardItem title clamping", () => {
  it("renders the title with a test hook", () => {
    renderCard();
    expect(screen.getByTestId("card-title")).toHaveTextContent("Short title");
  });

  it("does not set the native tooltip when the title fits", () => {
    renderCard();
    // jsdom never lays out text, so scrollHeight === clientHeight — the
    // tooltip must stay off for short titles.
    expect(screen.getByTestId("card-title")).not.toHaveAttribute("title");
  });

  it("clamps via line-clamp-3 (CSS is in place)", () => {
    renderCard({
      ...baseCard,
      title: Array.from({ length: 60 }, (_, i) => `word-${i}`).join(" "),
    });
    const title = screen.getByTestId("card-title");
    expect(title.className).toContain("line-clamp-3");
    expect(title.className).toContain("[overflow-wrap:anywhere]");
    expect(title.className).toContain("[text-wrap:pretty]");
  });

  it("full title stays in the accessibility tree (CSS-only clip)", () => {
    const long = Array.from({ length: 60 }, (_, i) => `word-${i}`).join(" ");
    renderCard({ ...baseCard, title: long });
    expect(screen.getByTestId("card-title")).toHaveTextContent(long);
  });
});

describe("CardItem search highlight", () => {
  it("wraps the matched substring in the title in a <mark>", () => {
    renderCard({ ...baseCard, title: "Buy Milk tomorrow" }, [], "milk");
    const mark = screen.getByTestId("card-title").querySelector("mark");
    expect(mark).not.toBeNull();
    expect(mark).toHaveTextContent("Milk");
  });

  it("does not highlight without a query", () => {
    renderCard();
    expect(screen.getByTestId("card-title").querySelector("mark")).toBeNull();
  });
});

describe("CardItem render isolation (TASK-21.4)", () => {
  it("skips the re-render when its props are unchanged", () => {
    // Property reads on the card stand in for a render count: the memo
    // comparison itself never touches them, only the render body does.
    let reads = 0;
    const card = new Proxy(baseCard, {
      get(target, prop) {
        reads += 1;
        return target[prop as keyof Card];
      },
    });
    const labels: Label[] = [];
    const onClick = vi.fn();
    let bump = () => {};

    function Parent() {
      const [, setTick] = useState(0);
      bump = () => setTick((tick) => tick + 1);
      return <CardItem card={card} labels={labels} onClick={onClick} />;
    }

    render(
      <I18nProvider>
        <TooltipProvider>
          <Parent />
        </TooltipProvider>
      </I18nProvider>,
    );
    const afterMount = reads;
    expect(afterMount).toBeGreaterThan(0);

    // The column around a card re-renders on every board change; the card
    // must sit it out as long as nothing of its own changed.
    act(() => bump());
    expect(reads).toBe(afterMount);
  });
});
