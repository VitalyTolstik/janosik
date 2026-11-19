import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { AdminGlobalSearchDto } from "@janosik/shared";
import { I18nProvider } from "@/i18n";
import { adminApi } from "./admin-client";
import {
  buildSearchLines,
  GlobalSearchDialog,
  rememberRecentPath,
} from "./GlobalSearch";

/**
 * TASK-176.5 — global search must land on the exact object, not just its card:
 * a comment/attachment carries its own id (the card detail centres and
 * highlights it), and a label opens the cards that carry that label.
 */

const groups = {
  users: "Users",
  boards: "Boards",
  cards: "Cards",
  comments: "Comments",
  attachments: "Files",
  labels: "Labels",
};

function results(): AdminGlobalSearchDto {
  return {
    users: [],
    boards: [],
    cards: [],
    comments: [
      {
        id: "cm-1",
        cardId: "c-1",
        cardTitle: "Ship it",
        authorId: "u-1",
        authorEmail: "author@example.com",
        text: "a found comment",
        createdAt: 1,
        updatedAt: 1,
        editedAt: null,
        deletedAt: null,
      },
    ],
    attachments: [
      {
        id: "att-1",
        cardId: "c-1",
        cardTitle: "Ship it",
        boardId: "b-1",
        boardTitle: "—",
        fileName: "spec.pdf",
        storedName: "stored",
        mimeType: "application/pdf",
        sizeBytes: 10,
        uploadedById: "u-1",
        uploadedByEmail: "author@example.com",
        transcodeStatus: "none",
        deletedAt: null,
        createdAt: 1,
      },
    ],
    labels: [
      {
        id: "l-1",
        boardId: "b-1",
        boardTitle: "Roadmap",
        name: "urgent",
        color: "red",
        position: 0,
        cardCount: 3,
        deletedAt: null,
        version: 0,
      },
    ],
  };
}

describe("global search result targets", () => {
  it("passes the exact comment id and names the found object", () => {
    const line = buildSearchLines(results(), groups).find(
      (entry) => entry.key === "comment-cm-1",
    );
    expect(line?.group).toBe("Comments");
    expect(line?.href).toBe("/admin/cards/c-1?comment=cm-1");
    expect(line?.secondary).toContain("Ship it");
  });

  it("passes the exact attachment id", () => {
    const line = buildSearchLines(results(), groups).find(
      (entry) => entry.key === "attachment-att-1",
    );
    expect(line?.group).toBe("Files");
    expect(line?.href).toBe("/admin/cards/c-1?attachment=att-1");
  });

  it("opens the cards filtered by the label, not the board", () => {
    const line = buildSearchLines(results(), groups).find(
      (entry) => entry.key === "label-l-1",
    );
    expect(line?.group).toBe("Labels");
    expect(line?.href).toBe("/admin/boards?tab=cards&labelId=l-1");
  });
});

describe("admin command palette", () => {
  function renderPalette(open = true) {
    return (
      <I18nProvider>
        <MemoryRouter>
          <GlobalSearchDialog open={open} onOpenChange={() => undefined} />
        </MemoryRouter>
      </I18nProvider>
    );
  }

  it("ignores out-of-order responses and aborts the request when closed", async () => {
    const requests = new Map<
      string,
      {
        signal: AbortSignal | undefined;
        resolve: (value: AdminGlobalSearchDto) => void;
      }
    >();
    const search = vi
      .spyOn(adminApi, "globalSearch")
      .mockImplementation(
        (query, signal) =>
          new Promise((resolve) => requests.set(query, { signal, resolve })),
      );
    try {
      const { rerender } = render(renderPalette());
      const input = screen.getByRole("combobox", { name: "Search everything" });
      fireEvent.change(input, { target: { value: "first" } });
      await waitFor(() => expect(requests.has("first")).toBe(true));
      fireEvent.change(input, { target: { value: "second" } });
      await waitFor(() => expect(requests.has("second")).toBe(true));
      expect(requests.get("first")?.signal?.aborted).toBe(true);

      const matches = (text: string) => {
        const page = results();
        return { ...page, comments: [{ ...page.comments[0], text }] };
      };
      await act(() =>
        requests.get("second")?.resolve(matches("Current match")),
      );
      expect(screen.getByText("Current match")).toBeVisible();
      const active = document.getElementById(
        input.getAttribute("aria-activedescendant")!,
      );
      expect(active).toHaveTextContent("Current match");
      await act(() => requests.get("first")?.resolve(matches("Stale match")));
      expect(screen.queryByText("Stale match")).not.toBeInTheDocument();
      expect(screen.getByText("Current match")).toBeVisible();

      fireEvent.change(input, { target: { value: "first" } });
      fireEvent.change(input, { target: { value: "second" } });
      expect(screen.queryByText("Current match")).not.toBeInTheDocument();
      expect(screen.getByRole("listbox")).toHaveAttribute("aria-busy", "true");

      fireEvent.change(input, { target: { value: "closing" } });
      await waitFor(() => expect(requests.has("closing")).toBe(true));
      rerender(renderPalette(false));
      expect(requests.get("closing")?.signal?.aborted).toBe(true);
      await act(() =>
        requests.get("closing")?.resolve(matches("Closed match")),
      );
      rerender(renderPalette());
      expect(screen.getByRole("combobox")).toHaveValue("");
      expect(screen.queryByText("Closed match")).not.toBeInTheDocument();
    } finally {
      search.mockRestore();
    }
  });

  it("labels recent tabs and detail pages with their actual destinations", () => {
    localStorage.removeItem("janosik.admin.recent");
    rememberRecentPath("/admin");
    rememberRecentPath("/admin/boards", "?tab=cards");
    rememberRecentPath("/admin/boards/b-1/workflow");
    render(renderPalette());

    const recent = screen.getByRole("group", { name: "Recent" });
    expect(
      within(recent)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      expect.stringContaining("Workflow"),
      expect.stringContaining("Cards"),
      expect.stringContaining("Overview"),
    ]);
    const icons = within(recent)
      .getAllByRole("option")
      .map((option) => option.querySelector("svg")?.getAttribute("class"));
    expect(new Set(icons).size).toBe(3);
    localStorage.removeItem("janosik.admin.recent");
  });
});
