import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { Calendar } from "./calendar-lazy";

it("resets a loaded Russian calendar locale when the language changes to English", async () => {
  const month = new Date(2027, 3, 1);
  const { rerender } = render(<Calendar defaultMonth={month} localeTag="ru" />);

  await screen.findByRole("grid", { name: /апрель 2027/i });
  rerender(<Calendar defaultMonth={month} localeTag="en" />);

  expect(screen.getByRole("grid", { name: "April 2027" })).toBeInTheDocument();
});
