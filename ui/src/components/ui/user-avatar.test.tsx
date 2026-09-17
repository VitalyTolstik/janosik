import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { UserAvatar } from "@/components/ui/user-avatar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { userAvatarColor, userInitials } from "@/utils/avatar";

/**
 * UserAvatar (TASK-35): initials from the display name with the email
 * fallback, a stable palette color per user id and the full name in the
 * accessible label/tooltip.
 */

function renderAvatar(props: {
  userId: string;
  displayName: string | null;
  email: string;
  size?: "sm" | "md" | "lg";
}) {
  return render(
    <TooltipProvider>
      <UserAvatar {...props} />
    </TooltipProvider>,
  );
}

describe("UserAvatar", () => {
  it("builds up to two initials from the display name", () => {
    expect(userInitials("Boris Johnson", "b@example.com")).toBe("BJ");
    expect(userInitials("  anna  ", "a@example.com")).toBe("A");
    expect(userInitials("Mary Jane Watson", "m@example.com")).toBe("MJ");
  });

  it("falls back to the first email letter when there is no name", () => {
    expect(userInitials(null, "runner@example.com")).toBe("R");
    expect(userInitials("   ", "x@example.com")).toBe("X");
  });

  it("derives a stable color from the user id", () => {
    expect(userAvatarColor("user-1")).toBe(userAvatarColor("user-1"));
    // Different ids are expected to spread across the palette.
    const colors = new Set(
      Array.from({ length: 32 }, (_, i) => userAvatarColor(`user-${i}`)),
    );
    expect(colors.size).toBeGreaterThan(1);
  });

  it("renders the initials with the full name as the accessible label", () => {
    renderAvatar({
      userId: "user-1",
      displayName: "Boris",
      email: "boris@example.com",
    });

    const avatar = screen.getByTestId("user-avatar");
    expect(avatar).toHaveTextContent("B");
    expect(avatar).toHaveAttribute("aria-label", "Boris");
    expect(avatar.className).toContain(userAvatarColor("user-1"));
  });

  it("falls back to the email for the label when the name is missing", () => {
    renderAvatar({
      userId: "user-2",
      displayName: null,
      email: "quiet@example.com",
    });

    expect(screen.getByTestId("user-avatar")).toHaveAttribute(
      "aria-label",
      "quiet@example.com",
    );
  });
});
