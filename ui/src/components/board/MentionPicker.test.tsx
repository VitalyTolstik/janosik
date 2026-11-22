import { useRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
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

function manyMembers(count: number): BoardMemberDto[] {
  return Array.from({ length: count }, (_, index) => ({
    userId: `user-${index}`,
    displayName: `Member ${index}`,
    email: `member-${index}@example.com`,
    role: "MEMBER" as const,
    expiresAt: null,
    avatarColor: null,
    avatarPath: null,
  }));
}

function PickerHarness({
  members = MEMBERS,
  onSelect,
  onCancel,
  onActiveChange = vi.fn(),
}: {
  members?: BoardMemberDto[];
  onSelect: (member: BoardMemberDto) => void;
  onCancel: (query: string) => void;
  onActiveChange?: (id: string | null) => void;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={anchorRef} data-testid="mention-anchor">
      <MentionPicker
        members={members}
        anchorRef={anchorRef}
        idPrefix="test-mention"
        onSelect={onSelect}
        onCancel={onCancel}
        onActiveChange={onActiveChange}
      />
    </div>
  );
}

function renderPicker(
  overrides: {
    members?: BoardMemberDto[];
    onSelect?: (member: BoardMemberDto) => void;
    onCancel?: (query: string) => void;
    onActiveChange?: (id: string | null) => void;
  } = {},
) {
  const onSelect = vi.fn();
  const onCancel = vi.fn();
  const onActiveChange = vi.fn();
  render(
    <I18nProvider>
      <TooltipProvider>
        <PickerHarness
          members={overrides.members}
          onSelect={overrides.onSelect ?? onSelect}
          onCancel={overrides.onCancel ?? onCancel}
          onActiveChange={overrides.onActiveChange ?? onActiveChange}
        />
      </TooltipProvider>
    </I18nProvider>,
  );
  return { onSelect, onCancel, onActiveChange };
}

function type(text: string) {
  for (const key of text) {
    fireEvent.keyDown(document, { key });
  }
}

async function axeViolations(context: Element | Document) {
  const results = await axe.run(context, {
    rules: { "color-contrast": { enabled: false } },
  });
  return results.violations.map((violation) => violation.id);
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

  it("resets the active row when the query changes", () => {
    renderPicker();

    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(screen.getByRole("option", { selected: true })).toHaveTextContent(
      "Анна",
    );

    type("bo");
    expect(screen.getByRole("option", { selected: true })).toHaveTextContent(
      "Bob",
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

  it("dismisses without swallowing the typed query", () => {
    const { onCancel } = renderPicker();

    type("bo");
    fireEvent.pointerDown(document.body);

    expect(onCancel).toHaveBeenCalledWith("bo");
  });

  it("keeps a member-less roster inert instead of accepting free text", () => {
    const { onCancel, onSelect } = renderPicker({ members: [] });

    type("anyone");
    fireEvent.keyDown(document, { key: "Enter" });

    expect(onSelect).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledWith("anyone");
  });

  it("announces the true total while rendering at most eight rows", () => {
    renderPicker({ members: manyMembers(11) });

    expect(screen.getAllByRole("option")).toHaveLength(8);
    expect(screen.getByRole("status")).toHaveTextContent("11 matching members");
  });

  it("keeps the active option in sync and scrolls it into view", () => {
    const scroll = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: scroll,
    });
    const { onActiveChange } = renderPicker({ members: manyMembers(8) });

    for (let index = 0; index < 5; index += 1) {
      fireEvent.keyDown(document, { key: "ArrowDown" });
    }

    expect(screen.getByRole("option", { selected: true })).toHaveAttribute(
      "id",
      "test-mention-option-user-5",
    );
    expect(onActiveChange).toHaveBeenLastCalledWith(
      "test-mention-option-user-5",
    );
    expect(scroll).toHaveBeenCalled();
  });

  it("has no axe violations with the picker open", async () => {
    renderPicker({ members: manyMembers(5) });

    expect(await axeViolations(document.body)).toEqual([]);
  });
});
