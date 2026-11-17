import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TokenInfoDialog } from "@/components/agents/TokenInfoDialog";
import { I18nProvider } from "@/i18n";

describe("token info dialog", () => {
  it("keeps the key tile muted, the impact readable and the action 176 px", () => {
    render(
      <I18nProvider>
        <TokenInfoDialog
          open
          onOpenChange={vi.fn()}
          tokenName="Claude Code — audit"
          onOpenAccount={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByTestId("token-info-icon").className).toContain(
      "text-muted-foreground",
    );
    expect(screen.getByTestId("token-info-impact").className).toContain(
      "text-foreground",
    );
    expect(screen.getByTestId("token-info-open-account").className).toContain(
      "min-w-[176px]",
    );
    expect(screen.getByTestId("token-info-open-account")).toHaveTextContent(
      "Open Account → API keys",
    );
  });
});
