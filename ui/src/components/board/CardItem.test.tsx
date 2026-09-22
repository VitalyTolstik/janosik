import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n";
import { AuthContext } from "@/auth/AuthContext";
import { CardItem } from "@/components/board/CardItem";
import { UserProfileProvider } from "@/components/board/UserProfileDialog";
import {
  BoardLiveProvider,
  createBoardLive,
  type BoardLive,
} from "@/store/board-live";
import type { Card, Label } from "@janosik/shared";

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

  it("truncates to a single line (CSS is in place)", () => {
    renderCard({
      ...baseCard,
      title: Array.from({ length: 60 }, (_, i) => `word-${i}`).join(" "),
    });
    const title = screen.getByTestId("card-title");
    expect(title.className).toContain("truncate");
    expect(title.className).toContain("[overflow-wrap:anywhere]");
  });

  it("full title stays in the accessibility tree (CSS-only clip)", () => {
    const long = Array.from({ length: 60 }, (_, i) => `word-${i}`).join(" ");
    renderCard({ ...baseCard, title: long });
    expect(screen.getByTestId("card-title")).toHaveTextContent(long);
  });
});

describe("CardItem fixed tile layout", () => {
  it("renders every card at the same fixed size", () => {
    renderCard();
    const card = screen.getByTestId("card-title").closest("article");
    expect(card?.className).toContain("h-[88px]");
    expect(card?.className).toContain("flex-col");
  });

  it("shares the first line between the title (75%) and the labels (25%)", () => {
    renderCard(
      baseCard,
      Array.from({ length: 6 }, (_, i) => ({
        id: `l-${i}`,
        name: `label-${i}`,
        color: "slate" as const,
      })),
    );
    const title = screen.getByTestId("card-title");
    const labels = screen.getByTestId("card-labels");
    // Same row container: the labels sit beside the title, not below it.
    expect(title.parentElement).toBe(labels.parentElement);
    expect(title.className).toContain("w-3/4");
    expect(title.className).toContain("truncate");
    // The label quarter stays on one clipped line.
    expect(labels.className).toContain("whitespace-nowrap");
    expect(labels.className).toContain("overflow-hidden");
    expect(labels.children.length).toBe(6);
  });

  it("renders the medium priority badge (the default is no longer hidden)", () => {
    renderCard();
    expect(screen.getByTestId("card-priority-badge")).toHaveAttribute(
      "data-priority",
      "medium",
    );
  });

  it("orders the rows: title+labels, due, meta with priority+assignee", () => {
    const live = createBoardLive();
    live.members.set("b-1", [
      {
        userId: "u-boris",
        displayName: "Boris",
        email: "boris@example.com",
        role: "MEMBER",
        expiresAt: null,
        avatarColor: null,
        avatarPath: null,
      },
    ]);
    render(
      <I18nProvider>
        <TooltipProvider>
          <BoardLiveProvider live={live}>
            <UserProfileProvider boardId="b-1">
              <AuthContext.Provider
                value={{
                  status: "authenticated",
                  user: {
                    id: "u-me",
                    email: "me@example.com",
                    displayName: "Me",
                    avatarColor: null,
                    avatarPath: null,
                    createdAt: 0,
                  },
                  login: async () => {},
                  register: async () => {},
                  updateUser: () => {},
                  logout: async () => {},
                }}
              >
                <CardItem
                  card={{
                    ...baseCard,
                    assigneeId: "u-boris",
                    dueDate: 4102444800000,
                    description: "Body",
                  }}
                  boardId="b-1"
                  labels={[]}
                />
              </AuthContext.Provider>
            </UserProfileProvider>
          </BoardLiveProvider>
        </TooltipProvider>
      </I18nProvider>,
    );

    const card = screen.getByTestId("card-title").closest("article");
    const rowOf = (id: string) => {
      const el = card?.querySelector(`[data-testid='${id}']`);
      expect(el).not.toBeNull();
      return Array.from(card?.children ?? []).find((child) =>
        child.contains(el as Node),
      );
    };
    // First line: the labels share the title's row.
    expect(rowOf("card-labels")).toBe(rowOf("card-title"));
    // Second line: only the due badge.
    expect(rowOf("card-due-badge")).not.toBe(rowOf("card-title"));
    // Third line: meta badges and the priority + assignee pair together.
    const meta = rowOf("card-description-badge");
    expect(meta).toBe(rowOf("card-priority-badge"));
    expect(meta).toBe(rowOf("card-assignee"));
    // Attachments no longer own a badge on the face.
    expect(
      card?.querySelector("[data-testid='card-attachments-badge']"),
    ).toBeNull();
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

describe("CardItem hover duplicate (column limits)", () => {
  const base = {
    labels: [] as Label[],
    onDuplicate: vi.fn(),
    onArchive: vi.fn(),
  };

  it("enables the hover duplicate while the column has room", () => {
    render(
      <I18nProvider>
        <TooltipProvider>
          <CardItem card={baseCard} {...base} />
        </TooltipProvider>
      </I18nProvider>,
    );
    expect(
      screen.getByRole("button", { name: "Duplicate card" }),
    ).toBeEnabled();
  });

  it("disables the hover duplicate when the column is full", () => {
    render(
      <I18nProvider>
        <TooltipProvider>
          <CardItem
            card={baseCard}
            {...base}
            duplicateDisabled
            duplicateDisabledReason="Column is full (200 cards)"
          />
        </TooltipProvider>
      </I18nProvider>,
    );
    expect(
      screen.getByRole("button", { name: "Duplicate card" }),
    ).toBeDisabled();
  });
});

describe("CardItem touch (no-hover) quick actions", () => {
  it("drops the hover quick actions on touch — the dialog owns them", () => {
    render(
      <I18nProvider>
        <TooltipProvider>
          <CardItem
            card={baseCard}
            labels={[]}
            onDuplicate={vi.fn()}
            onArchive={vi.fn()}
          />
        </TooltipProvider>
      </I18nProvider>,
    );
    // `(hover: none)` devices: both quick actions are display:none — on
    // touch they used to be invisible yet still tappable.
    expect(screen.getByRole("button", { name: "Archive" }).className).toContain(
      "no-hover:hidden",
    );
    expect(
      screen.getByRole("button", { name: "Duplicate card" }).closest("span")
        ?.className,
    ).toContain("no-hover:hidden");
    // Desktop hover-reveal stays as is.
    expect(screen.getByRole("button", { name: "Archive" }).className).toContain(
      "group-hover:opacity-100",
    );
  });
});

describe("attribution (TASK-36)", () => {
  const ME = "u-me";

  function renderWithLive(live: BoardLive, card: Card = baseCard) {
    return render(
      <I18nProvider>
        <TooltipProvider>
          <BoardLiveProvider live={live}>
            <UserProfileProvider boardId="b-1">
              <AuthContext.Provider
                value={{
                  status: "authenticated",
                  user: {
                    id: ME,
                    email: "me@example.com",
                    displayName: "Me",
                    avatarColor: null,
                    avatarPath: null,
                    createdAt: 0,
                  },
                  login: async () => {},
                  register: async () => {},
                  updateUser: () => {},
                  logout: async () => {},
                }}
              >
                <CardItem card={card} labels={[]} />
              </AuthContext.Provider>
            </UserProfileProvider>
          </BoardLiveProvider>
        </TooltipProvider>
      </I18nProvider>,
    );
  }

  it("stays anonymous on my own edits", () => {
    const live = createBoardLive();
    live.attribution.stamp("b-1", ME, ["c-1"]);
    renderWithLive(live);

    expect(screen.queryByTestId("card-last-actor")).toBeNull();
    expect(screen.queryByTestId("user-avatar")).toBeNull();
  });

  it("paints the foreign change ring while the highlight lasts", () => {
    const live = createBoardLive();
    live.attribution.stamp("b-1", "u-boris", ["c-1"], { highlight: true });
    renderWithLive(live);

    const mark = document.querySelector("[data-foreign='u-boris']");
    expect(mark).not.toBeNull();
    expect(mark?.querySelector(".janosik-foreign-ring")).not.toBeNull();
    expect(mark?.querySelector(".janosik-foreign-dot")).not.toBeNull();
  });
});

describe("assignee badge (TASK-49)", () => {
  const MEMBER = {
    userId: "u-boris",
    displayName: "Boris",
    email: "boris@example.com",
    role: "MEMBER" as const,
    expiresAt: null,
    avatarColor: null,
    avatarPath: null,
  };

  function renderWithLive(live: BoardLive, card: Card = baseCard) {
    return render(
      <I18nProvider>
        <TooltipProvider>
          <BoardLiveProvider live={live}>
            <UserProfileProvider boardId="b-1">
              <AuthContext.Provider
                value={{
                  status: "authenticated",
                  user: {
                    id: "u-me",
                    email: "me@example.com",
                    displayName: "Me",
                    avatarColor: null,
                    avatarPath: null,
                    createdAt: 0,
                  },
                  login: async () => {},
                  register: async () => {},
                  updateUser: () => {},
                  logout: async () => {},
                }}
              >
                <CardItem card={card} boardId="b-1" labels={[]} />
              </AuthContext.Provider>
            </UserProfileProvider>
          </BoardLiveProvider>
        </TooltipProvider>
      </I18nProvider>,
    );
  }

  it("shows the assignee's avatar in the corner", () => {
    const live = createBoardLive();
    live.members.set("b-1", [MEMBER]);
    renderWithLive(live, { ...baseCard, assigneeId: "u-boris" });

    expect(screen.getByTestId("card-assignee")).toBeInTheDocument();
    expect(screen.getByTestId("user-avatar")).toHaveAttribute(
      "aria-label",
      "Boris",
    );
  });

  it("opens the assignee's profile from the badge", () => {
    const live = createBoardLive();
    live.members.set("b-1", [MEMBER]);
    renderWithLive(live, { ...baseCard, assigneeId: "u-boris" });

    fireEvent.click(screen.getByTestId("card-assignee"));

    expect(screen.getByTestId("user-profile-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("user-profile-name")).toHaveTextContent("Boris");
  });

  it("renders nothing while the card is unassigned", () => {
    const live = createBoardLive();
    live.members.set("b-1", [MEMBER]);
    renderWithLive(live);

    expect(screen.queryByTestId("card-assignee")).toBeNull();
  });
});
