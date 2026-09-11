import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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

function renderCard(card: Card = baseCard, labels: Label[] = []) {
  return render(
    <I18nProvider>
      <TooltipProvider>
        <CardItem card={card} labels={labels} />
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
