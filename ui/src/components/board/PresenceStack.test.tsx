import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Board, PresenceUser } from "@janosik/shared";

import { api } from "@/api/client";
import { AuthProvider } from "@/auth/AuthContext";
import { PresenceStack } from "@/components/board/PresenceStack";
import { UserProfileProvider } from "@/components/board/UserProfileDialog";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";
import { FakeServer } from "@/test/fake-server";

/**
 * The header presence stack (TASK-36) end to end over the fake API: the
 * roster arrives on the events stream, the stack appears only when someone
 * else is there, collapses past five faces into an actionable "+N", and
 * follows join/leave updates without a reload.
 */

function seedBoard(): Board {
  return {
    id: "b-1",
    title: "Board",
    columns: [],
    cards: {},
    labels: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

const ADMIN: PresenceUser = {
  id: "user-1",
  displayName: "Admin",
  avatarColor: null,
  avatarPath: null,
};
const BORIS: PresenceUser = {
  id: "user-2",
  displayName: "Boris",
  avatarColor: null,
  avatarPath: null,
};

function renderStack(server: FakeServer) {
  vi.stubGlobal("fetch", server.handle);
  return render(
    <I18nProvider>
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={["/board/b-1"]}>
            <TooltipProvider>
              <BoardProvider>
                <UserProfileProvider boardId="b-1">
                  <PresenceStack />
                </UserProfileProvider>
              </BoardProvider>
            </TooltipProvider>
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>
    </I18nProvider>,
  );
}

/** Wait until the realtime stream is connected (the request is in flight). */
async function waitStream(server: FakeServer) {
  await waitFor(() =>
    expect(server.requests.some((r) => r.path.endsWith("/events"))).toBe(true),
  );
  // The roster lands in a microtask after the stream's first frame.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
  api.clearAccessToken();
  api.onAuthLost = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("PresenceStack", () => {
  it("stays hidden for a solo user", async () => {
    const server = new FakeServer([seedBoard()]);
    server.initialPresence = [ADMIN];
    renderStack(server);
    await waitStream(server);

    expect(screen.queryByTestId("presence-stack")).toBeNull();
  });

  it("shows everyone connected and opens the full list", async () => {
    const server = new FakeServer([seedBoard()]);
    server.initialPresence = [ADMIN, BORIS];
    renderStack(server);

    const stack = await screen.findByTestId("presence-stack");
    expect(stack).toHaveAttribute("aria-label", "2 people on this board");
    expect(screen.getAllByTestId("presence-avatar")).toHaveLength(2);
    expect(screen.getByTestId("presence-live-dot")).toBeInTheDocument();

    fireEvent.click(stack);
    const rows = await screen.findAllByTestId("presence-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Admin");
    expect(rows[0]).toHaveTextContent("you");
    expect(rows[1]).toHaveTextContent("Boris");
  });

  it("collapses a crowd into five faces and an actionable +N", async () => {
    const server = new FakeServer([seedBoard()]);
    server.initialPresence = [
      ADMIN,
      BORIS,
      {
        id: "user-3",
        displayName: "Cara",
        avatarColor: null,
        avatarPath: null,
      },
      {
        id: "user-3",
        displayName: "Cara",
        avatarColor: null,
        avatarPath: null,
      },
      {
        id: "user-3",
        displayName: "Cara",
        avatarColor: null,
        avatarPath: null,
      },
      {
        id: "user-3",
        displayName: "Cara",
        avatarColor: null,
        avatarPath: null,
      },
      {
        id: "user-3",
        displayName: "Cara",
        avatarColor: null,
        avatarPath: null,
      },
    ];
    renderStack(server);

    const stack = await screen.findByTestId("presence-stack");
    expect(screen.getAllByTestId("presence-avatar")).toHaveLength(5);
    expect(screen.getByTestId("presence-overflow")).toHaveTextContent("+2");

    fireEvent.click(stack);
    expect(await screen.findAllByTestId("presence-row")).toHaveLength(7);
  });

  it("opens a member profile from a roster row", async () => {
    const server = new FakeServer([seedBoard()]);
    server.initialPresence = [ADMIN, BORIS];
    renderStack(server);

    fireEvent.click(await screen.findByTestId("presence-stack"));
    const rows = await screen.findAllByTestId("presence-row");
    fireEvent.click(rows[1]);

    expect(
      await screen.findByTestId("user-profile-dialog"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("user-profile-name")).toHaveTextContent("Boris");
  });

  it("follows roster updates without a reload", async () => {
    const server = new FakeServer([seedBoard()]);
    server.initialPresence = [ADMIN, BORIS];
    renderStack(server);
    await screen.findByTestId("presence-stack");

    act(() => {
      server.publishPresence("b-1", [ADMIN]);
    });
    await waitFor(() =>
      expect(screen.queryByTestId("presence-stack")).toBeNull(),
    );

    act(() => {
      server.publishPresence("b-1", [ADMIN, BORIS]);
    });
    expect(await screen.findByTestId("presence-stack")).toBeInTheDocument();
  });
});
