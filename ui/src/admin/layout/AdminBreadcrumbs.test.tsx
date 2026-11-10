import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { I18nProvider } from "@/i18n";
import { AdminBreadcrumbs } from "./AdminBreadcrumbs";

function renderAt(path: string) {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[path]}>
        <AdminBreadcrumbs />
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe("AdminBreadcrumbs", () => {
  it("shows admin / hub / tab for a section URL", () => {
    renderAt("/admin/settings?tab=email");
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(nav).toHaveTextContent("Master panel");
    expect(nav).toHaveTextContent("Settings");
    expect(nav).toHaveTextContent("Email service");
  });

  it("marks the last crumb as the current page", () => {
    renderAt("/admin/users/42");
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(nav).toHaveTextContent("User detail");
    expect(
      screen.getByText("User detail", { selector: "[aria-current='page']" }),
    ).toBeTruthy();
  });
});
