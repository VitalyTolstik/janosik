import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { boardTemplateById } from "@janosik/shared";

import { TemplatePreview } from "@/components/board/TemplatePreview";
import { I18nProvider } from "@/i18n";

const previousTz = process.env.TZ;

afterEach(() => {
  process.env.TZ = previousTz;
});

describe("TemplatePreview due dates", () => {
  it("renders the creator's local calendar date under UTC+14 and UTC−8", () => {
    const template = boardTemplateById("product-launch")!;
    for (const [timeZone, offset] of [
      ["Pacific/Kiritimati", 840],
      ["America/Los_Angeles", -480],
    ] as const) {
      process.env.TZ = timeZone;
      const { unmount } = render(
        <I18nProvider>
          <TemplatePreview
            template={template}
            locale="en"
            templateDate="2026-11-24"
            templateUtcOffsetMinutes={offset}
          />
        </I18nProvider>,
      );
      // The launch brief is due two days after the Nov 24 creation date.
      // Stored at local noon in the creator's offset, it must read Nov 26 in
      // both a UTC+14 and a UTC−8 process instead of drifting to Nov 27.
      expect(screen.getAllByText(/Nov\s*26/).length).toBeGreaterThan(0);
      unmount();
    }
  });
});
