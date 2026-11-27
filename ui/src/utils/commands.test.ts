import { describe, expect, it, vi } from "vitest";

import en from "@/locales/en/translation.json";
import ru from "@/locales/ru/translation.json";
import { boardCommands, filterCommands, readCommandQuery } from "./commands";

const englishCatalog: Record<string, string> = en;
const russianCatalog: Record<string, string> = ru;

describe("command queries", () => {
  it("recognizes a leading > and trims the command text", () => {
    expect(readCommandQuery(">")).toBe("");
    expect(readCommandQuery(">  Team   Roster ")).toBe("Team   Roster");
    for (const query of ["", " >", "card > checklist", "＜"]) {
      expect(readCommandQuery(query)).toBeNull();
    }
  });

  it("filters by localized labels and keywords, case independently", () => {
    const openMembers = vi.fn();
    const english = boardCommands((key) => englishCatalog[key], [], vi.fn(), {
      openMembers,
    });
    const russian = boardCommands((key) => russianCatalog[key], [], vi.fn(), {
      openMembers,
    });

    expect(filterCommands(english, "MEMB")).toEqual(english);
    expect(filterCommands(english, "TEAM   ROSTER")).toEqual(english);
    expect(filterCommands(russian, "ПРИГЛАСИТЬ")).toEqual(russian);
    expect(filterCommands(russian, "missing")).toEqual([]);
  });
});

describe("command capabilities", () => {
  it("lists active boards and all four views with their handlers", () => {
    const openBoard = vi.fn();
    const setView = vi.fn();
    const [boards, views] = boardCommands(
      (key) => englishCatalog[key],
      [
        { id: "active", title: "Active board" },
        { id: "archived", title: "Archived board", archivedAt: 100 },
      ],
      openBoard,
      { setView },
    );

    expect(boards).toHaveProperty("choices", [
      { id: "active", label: "Active board", run: expect.any(Function) },
    ]);
    if ("choices" in boards) boards.choices[0].run();
    expect(openBoard).toHaveBeenCalledWith("active");

    expect(views).toHaveProperty("choices");
    if ("choices" in views) {
      for (const choice of views.choices) choice.run();
    }
    expect(setView.mock.calls.flat()).toEqual([
      "board",
      "calendar",
      "table",
      "watch",
    ]);
  });

  it("only lists actions that have a capability", () => {
    const openFilters = vi.fn();
    const available = boardCommands((key) => englishCatalog[key], [], vi.fn(), {
      openFilters,
    });
    expect(available.map(({ id }) => id)).toEqual(["openFilters"]);
    if ("run" in available[0]) available[0].run();
    expect(openFilters).toHaveBeenCalledOnce();
  });

  it("keeps the command catalog in sync across EN and RU", () => {
    const keys = Object.keys(en).filter((key) => key.startsWith("commands."));
    expect(keys.length).toBeGreaterThan(0);
    expect(
      Object.keys(ru).filter((key) => key.startsWith("commands.")),
    ).toEqual(keys);
    for (const key of keys) {
      expect(englishCatalog[key]).toBeTruthy();
      expect(russianCatalog[key]).toBeTruthy();
    }
  });
});
