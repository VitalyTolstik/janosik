import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { EntityLink } from "./cells";

/**
 * QA visual review: inside the phone-card table layout the `td` is a flex row,
 * so the label would otherwise leave the link + copy wrapper wider than the
 * card. The wrapper, link and copy control must all be able to shrink.
 */
describe("EntityLink phone cards", () => {
  it("lets the email truncate while the copy button stays inside", () => {
    render(
      <MemoryRouter>
        <EntityLink to="/admin/users/u-1" copyValue="long-address@example.com">
          long-address@example.com
        </EntityLink>
      </MemoryRouter>,
    );

    const link = screen.getByRole("link", {
      name: "long-address@example.com",
    });
    expect(link).toHaveClass("min-w-0", "truncate");
    expect(link.parentElement).toHaveClass("min-w-0", "max-w-full");
    expect(
      screen.getByTestId("admin-copy-long-address@example.com"),
    ).toHaveClass(
      "shrink-0",
      "h-3",
      "w-3",
      "max-lg:h-11",
      "max-lg:w-11",
      "max-lg:justify-center",
    );
  });
});
