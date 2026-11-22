import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoardMemberDto } from "@janosik/shared";

import { MentionPicker } from "@/components/board/MentionPicker";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n";

const MEMBERS: BoardMemberDto[] = [
  {
    userId: "user-alice",
    displayName: "Alice Smith",
    email: "alice@example.com",
    role: "MEMBER",
    expiresAt: null,
    avatarColor: null,
    avatarPath: null,
  },
  {
    userId: "user-bob",
    displayName: "Bob",
    email: "bob@example.com",
    role: "ADMIN",
    expiresAt: null,
    avatarColor: null,
    avatarPath: null,
  },
  {
    userId: "user-anna",
    displayName: "Анна",
    email: "anna@example.com",
    role: "VIEWER",
    expiresAt: null,
    avatarColor: null,
    avatarPath: null,
  },
];

function renderPicker(
  overrides: {
    members?: BoardMemberDto[];
    onSelect?: () => void;
    onCancel?: () => void;
  } = {},
) {
  const onSelect = vi.fn();
  const onCancel = vi.fn();
  render(
    <I18nProvider>
      <TooltipProvider>
        <MentionPicker
          members={overrides.members ?? MEMBERS}
          onSelect={overrides.onSelect ?? onSelect}
          onCancel={overrides.onCancel ?? onCancel}
        />
      </TooltipProvider>
    </I18nProvider>,
  );
  return { onSelect, onCancel };
}

function type(text: string) {
  for (const key of text) {
    fireEvent.keyDown(document, { key });
  }
}

describe("MentionPicker (TASK-177.12)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("filters by name or email and inserts the keyboard-selected member", () => {
    const { onSelect } = renderPicker();

    expect(
      screen.getByRole("listbox", { name: "Board members" }),
    ).toBeVisible();
    expect(screen.getAllByRole("option")).toHaveLength(3);

    type("ali");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(document, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-alice" }),
    );
  });

  it("moves with ArrowDown/ArrowUp and wraps", () => {
    const { onSelect } = renderPicker();

    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({ userId: "user-bob" }),
    );
  });

  it("closes with Escape and restores the literal @query", () => {
    const { onCancel, onSelect } = renderPicker();

    type("bo");
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onSelect).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledWith("bo");
  });

  it("restores typed text when Enter has no matching member", () => {
    const { onCancel, onSelect } = renderPicker();

    type("zzz");
    expect(screen.getAllByText("No board members match")).toHaveLength(2);
    fireEvent.keyDown(document, { key: "Enter" });

    expect(onSelect).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledWith("zzz");
  });

  it("selects with a click and exposes touch-sized options", () => {
    const { onSelect } = renderPicker();

    const option = screen.getByTestId("mention-option-user-anna");
    expect(option).toHaveClass("min-h-11");
    fireEvent.click(option);

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-anna" }),
    );
  });

  it("dismisses without restoring on an outside click", () => {
    const { onCancel } = renderPicker();

    fireEvent.pointerDown(document.body);

    expect(onCancel).toHaveBeenCalledWith(undefined);
  });

  it("keeps a member-less roster inert instead of accepting free text", () => {
    const { onCancel, onSelect } = renderPicker({ members: [] });

    type("anyone");
    fireEvent.keyDown(document, { key: "Enter" });

    expect(onSelect).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledWith("anyone");
  });
});
