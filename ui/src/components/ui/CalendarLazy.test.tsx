import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { Calendar } from "./calendar-lazy";

const localeImport = vi.hoisted(() => vi.fn());

vi.mock("react-day-picker/locale", () => {
  localeImport();
  throw new Error("Calendar locale chunk unavailable");
});

it("uses the default locale and still selects a date when the locale import rejects", async () => {
  const onSelect = vi.fn();
  render(
    <Calendar
      mode="single"
      localeTag="ru-RU"
      defaultMonth={new Date(2027, 3, 1)}
      onSelect={onSelect}
    />,
  );

  const grid = await screen.findByRole("grid", { name: "April 2027" });
  // Vitest also fails this run if the effect leaves an unhandled rejection.
  await vi.dynamicImportSettled();
  expect(localeImport).toHaveBeenCalledOnce();
  fireEvent.click(within(grid).getByRole("button", { name: /\b15th\b/ }));
  expect(onSelect).toHaveBeenCalledWith(
    new Date(2027, 3, 15),
    new Date(2027, 3, 15),
    expect.anything(),
    expect.anything(),
  );
});
