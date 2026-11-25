import axe from "axe-core";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { BoardStarterLocale, BoardTemplateId } from "@janosik/shared";

import {
  TemplatePickerDialog,
  type TemplateCreateOutcome,
} from "@/components/board/TemplatePickerDialog";
import { I18nProvider } from "@/i18n";
import { generateBoardName } from "@/utils/board-name";
import { BOARD_TEMPLATES } from "@janosik/shared";

function Harness({
  initialName = "",
  existingTitles = [],
  startOpen = true,
  createBoard = vi.fn(async () => "board-new"),
  createEmptyBoard = vi.fn(async () => "empty-board"),
  onOpenBoard = vi.fn(),
  onOpenChange = vi.fn(),
}: {
  initialName?: string;
  existingTitles?: string[];
  startOpen?: boolean;
  createBoard?: (
    name: string,
    template: BoardTemplateId,
    locale: BoardStarterLocale,
    templateDate: string,
    templateUtcOffsetMinutes: number,
  ) => Promise<TemplateCreateOutcome> | TemplateCreateOutcome;
  createEmptyBoard?: (name: string) => Promise<string | null> | string | null;
  onOpenBoard?: (boardId: string) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(startOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Trigger
      </button>
      <TemplatePickerDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          onOpenChange(next);
        }}
        existingTitles={existingTitles}
        initialName={initialName}
        createBoard={createBoard}
        createEmptyBoard={createEmptyBoard}
        onOpenBoard={onOpenBoard}
      />
    </>
  );
}

describe("TemplatePickerDialog", () => {
  it("opens on Product launch with a generated name and live preview", async () => {
    render(
      <I18nProvider>
        <Harness />
      </I18nProvider>,
    );

    const picker = await screen.findByTestId("template-picker");
    const product = within(picker).getByRole("button", {
      name: /Product launch/,
    });
    expect(product).toHaveAttribute("aria-pressed", "true");
    const name = within(picker).getByLabelText("Board name");
    expect((name as HTMLInputElement).value).toMatch(/^Product launch — /);
    expect(
      within(picker).getByRole("region", { name: /Preview: Product launch/ }),
    ).toBeVisible();
    expect(
      within(picker).getAllByText("Write the launch brief").length,
    ).toBeGreaterThan(0);
    expect(
      within(picker).getAllByText("Brief checklist").length,
    ).toBeGreaterThan(0);
    await waitFor(() => expect(product).toHaveFocus());
  });

  it("exposes modal semantics and a live character counter", async () => {
    render(
      <I18nProvider>
        <Harness />
      </I18nProvider>,
    );
    const picker = await screen.findByTestId("template-picker");
    expect(picker).toHaveAttribute("aria-modal", "true");
    const count = picker.querySelector("#template-name-count");
    expect(count).toHaveAttribute("aria-live", "polite");
    expect(count).not.toHaveAttribute("aria-hidden");
  });

  it("makes the scrollable preview mini-board keyboard focusable", async () => {
    render(
      <I18nProvider>
        <Harness />
      </I18nProvider>,
    );
    const picker = await screen.findByTestId("template-picker");
    const miniBoard = picker.querySelector(".template-mini-board");
    expect(miniBoard).toHaveAttribute("tabindex", "0");
    expect(miniBoard).toHaveAttribute("aria-label", "Preview: Product launch");
  });

  it("shows the fallback create error without hiding the fallback", async () => {
    const createBoard = vi.fn(
      async () => ({ code: "template_unavailable" }) as const,
    );
    const createEmptyBoard = vi.fn(async () => null);
    render(
      <I18nProvider>
        <Harness
          createBoard={createBoard}
          createEmptyBoard={createEmptyBoard}
        />
      </I18nProvider>,
    );
    const picker = await screen.findByTestId("template-picker");
    fireEvent.click(within(picker).getByTestId("template-create-board"));
    expect(
      await screen.findByText(/isn’t available in this version/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Create empty board" }));
    expect(
      await screen.findByText("The board could not be created. Try again."),
    ).toBeVisible();
    // The fallback remains available for a retry.
    expect(
      screen.getByRole("button", { name: "Create empty board" }),
    ).toBeVisible();
  });

  it("offers the empty-board fallback when a template is unavailable", async () => {
    const createBoard = vi.fn(
      async () => ({ code: "template_unavailable" }) as const,
    );
    const createEmptyBoard = vi.fn(async (name: string) => {
      expect(name).toBe("My launch");
      return "empty-new";
    });
    const onOpenBoard = vi.fn();
    render(
      <I18nProvider>
        <Harness
          createBoard={createBoard}
          createEmptyBoard={createEmptyBoard}
          onOpenBoard={onOpenBoard}
        />
      </I18nProvider>,
    );
    const picker = await screen.findByTestId("template-picker");
    const name = within(picker).getByLabelText("Board name");
    await userEvent.clear(name);
    await userEvent.type(name, "My launch");

    fireEvent.click(within(picker).getByTestId("template-create-board"));
    expect(
      await screen.findByText(/isn’t available in this version/),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "Create empty board" }),
    );
    expect(createEmptyBoard).toHaveBeenCalledWith("My launch");
    expect(onOpenBoard).toHaveBeenCalledWith("empty-new");
  });

  it("changes the auto name with the template, then preserves a manual name", async () => {
    render(
      <I18nProvider>
        <Harness />
      </I18nProvider>,
    );
    const picker = await screen.findByTestId("template-picker");
    const name = within(picker).getByLabelText("Board name");

    await userEvent.click(
      within(picker).getByRole("button", { name: /Sprint board/ }),
    );
    expect((name as HTMLInputElement).value).toMatch(
      /^Sprint board \d{4}-W\d{2}$/,
    );
    await waitFor(() =>
      expect(
        within(picker).getByText(/selected\. Preview updated\./),
      ).toBeInTheDocument(),
    );

    await userEvent.clear(name);
    await userEvent.type(name, "Q1 website redesign");
    expect(within(picker).getByText("Edited by you")).toBeVisible();

    await userEvent.click(
      within(picker).getByRole("button", { name: /Bug tracker/ }),
    );
    expect((name as HTMLInputElement).value).toBe("Q1 website redesign");

    await userEvent.click(
      within(picker).getByRole("button", { name: "Regenerate" }),
    );
    expect((name as HTMLInputElement).value).toBe("Bug tracker");
    expect(within(picker).getByText("Auto-generated")).toBeVisible();
  });

  it("navigates the gallery with the arrow keys", async () => {
    render(
      <I18nProvider>
        <Harness />
      </I18nProvider>,
    );
    const picker = await screen.findByTestId("template-picker");
    const product = within(picker).getByRole("button", {
      name: /Product launch/,
    });
    const sprint = within(picker).getByRole("button", {
      name: /Sprint board/,
    });
    await waitFor(() => expect(product).toHaveFocus());

    await userEvent.keyboard("{ArrowDown}");
    expect(sprint).toHaveAttribute("aria-pressed", "true");
    expect(sprint).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(product).toHaveAttribute("aria-pressed", "true");
    expect(product).toHaveFocus();
  });

  it("creates with Cmd/Ctrl+Enter and opens the success state", async () => {
    const createBoard = vi.fn(
      async (
        name: string,
        _template: BoardTemplateId,
        _locale: BoardStarterLocale,
        _templateDate: string,
        _templateUtcOffsetMinutes: number,
      ): Promise<TemplateCreateOutcome> => {
        expect(name).toBe("My launch");
        return "board-new";
      },
    );
    const onOpenBoard = vi.fn();
    render(
      <I18nProvider>
        <Harness createBoard={createBoard} onOpenBoard={onOpenBoard} />
      </I18nProvider>,
    );
    const picker = await screen.findByTestId("template-picker");
    const name = within(picker).getByLabelText("Board name");
    await userEvent.clear(name);
    await userEvent.type(name, "My launch");

    fireEvent.keyDown(picker, { ctrlKey: true, key: "Enter" });

    expect(await screen.findByText("Board created")).toBeVisible();
    expect(createBoard).toHaveBeenCalledWith(
      "My launch",
      "product-launch",
      "en",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      expect.any(Number),
    );
    const createdName = (await screen.findByText("My launch")) as HTMLElement;
    expect(createdName).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Open board" }));
    expect(onOpenBoard).toHaveBeenCalledWith("board-new");
  });

  it("creates only once when the CTA is clicked twice in flight", async () => {
    let finish: (outcome: TemplateCreateOutcome) => void = () => {};
    const createBoard = vi.fn(
      () =>
        new Promise<TemplateCreateOutcome>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <I18nProvider>
        <Harness createBoard={createBoard} />
      </I18nProvider>,
    );
    const picker = await screen.findByTestId("template-picker");
    const create = within(picker).getByTestId("template-create-board");

    fireEvent.click(create);
    fireEvent.click(create);
    expect(createBoard).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish("board-new");
    });
    expect(await screen.findByText("Board created")).toBeVisible();
    expect(createBoard).toHaveBeenCalledTimes(1);
  });

  it("dedupes the auto name against archived titles", async () => {
    const existing = generateBoardName(
      BOARD_TEMPLATES[0]!,
      "en",
      new Date(),
      [],
    ).name;
    render(
      <I18nProvider>
        <Harness existingTitles={[existing]} />
      </I18nProvider>,
    );
    const picker = await screen.findByTestId("template-picker");
    const name = within(picker).getByLabelText("Board name");
    expect((name as HTMLInputElement).value).toMatch(/\(2\)$/);
    expect(within(picker).getByText(/added \(2\)/)).toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the opener", async () => {
    render(
      <I18nProvider>
        <Harness startOpen={false} />
      </I18nProvider>,
    );
    const trigger = screen.getByRole("button", { name: "Trigger" });
    trigger.focus();
    await userEvent.click(trigger);
    const picker = await screen.findByTestId("template-picker");
    await waitFor(() =>
      expect(
        within(picker).getByRole("button", { name: /Product launch/ }),
      ).toHaveFocus(),
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByTestId("template-picker")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("has no axe violations in the picker", async () => {
    render(
      <I18nProvider>
        <Harness />
      </I18nProvider>,
    );
    await screen.findByTestId("template-picker");
    const results = await axe.run(document.body, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});
