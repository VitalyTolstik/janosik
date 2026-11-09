import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Notice } from "@/components/notifications/Notice";
import { NoticeStack } from "@/components/notifications/NoticeStack";

describe("NoticeStack", () => {
  it("stacks several notices in source order", () => {
    render(
      <NoticeStack>
        <Notice title="First" testId="first" />
        <Notice title="Second" testId="second" />
      </NoticeStack>,
    );

    const stack = screen.getByTestId("notice-stack");
    const notices = screen.getAllByRole("status");
    expect(stack).toContainElement(notices[0]!);
    expect(notices).toHaveLength(2);
    expect(notices[0]).toHaveTextContent("First");
    expect(notices[1]).toHaveTextContent("Second");
  });

  it("renders nothing inside when all notices are absent", () => {
    render(
      <NoticeStack>
        {null}
        {false}
      </NoticeStack>,
    );

    expect(screen.getByTestId("notice-stack")).toBeEmptyDOMElement();
  });
});
