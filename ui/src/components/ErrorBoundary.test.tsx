import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { downloadTextFile } from "@/utils/download";

/**
 * Crash fallback (TASK-21.2): it is rendered *after* something below has
 * already failed, so it must stand on its own (hardcoded English, no i18n
 * provider in this test on purpose), and "reset" must never erase data
 * without a confirmation and a downloaded copy first.
 */

vi.mock("@/utils/download", () => ({
  downloadTextFile: vi.fn(),
  timestampedFilename: (prefix: string) => `${prefix}.json`,
}));

const BOARDS_KEY = "janosik-boards";

const BOARDS = [
  {
    id: "b-1",
    title: "Alpha",
    columns: [],
    cards: {},
    labels: [],
    createdAt: 1,
    updatedAt: 1,
  },
];

function Boom(): never {
  throw new Error("boom");
}

function renderCrashed() {
  return render(
    <ErrorBoundary>
      <Boom />
    </ErrorBoundary>,
  );
}

beforeEach(() => {
  localStorage.clear();
  // The reload is scheduled on a timer; fake timers keep it from firing.
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(downloadTextFile).mockClear();
  localStorage.clear();
});

describe("ErrorBoundary", () => {
  it("renders a self-contained English fallback with no i18n provider", () => {
    renderCrashed();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByTestId("error-reset")).toBeInTheDocument();
  });

  it("asks for confirmation instead of erasing straight away", () => {
    localStorage.setItem(BOARDS_KEY, JSON.stringify(BOARDS));
    renderCrashed();

    fireEvent.click(screen.getByTestId("error-reset"));

    expect(screen.getByText("Erase local data?")).toBeInTheDocument();
    expect(localStorage.getItem(BOARDS_KEY)).not.toBeNull();
    expect(downloadTextFile).not.toHaveBeenCalled();
  });

  it("cancelling the confirmation leaves the data alone", () => {
    localStorage.setItem(BOARDS_KEY, JSON.stringify(BOARDS));
    renderCrashed();

    fireEvent.click(screen.getByTestId("error-reset"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(localStorage.getItem(BOARDS_KEY)).not.toBeNull();
    expect(downloadTextFile).not.toHaveBeenCalled();
  });

  it("downloads a re-importable export before erasing the data", () => {
    localStorage.setItem(BOARDS_KEY, JSON.stringify(BOARDS));
    localStorage.setItem("unrelated-app-key", "keep me");
    renderCrashed();

    fireEvent.click(screen.getByTestId("error-reset"));
    fireEvent.click(screen.getByTestId("error-reset-confirm"));

    expect(downloadTextFile).toHaveBeenCalledTimes(1);
    const [filename, payload] = vi.mocked(downloadTextFile).mock.calls[0]!;
    expect(filename).toContain("janosik-before-reset");
    // The regular export envelope — importable from the data menu.
    expect(JSON.parse(payload as string)).toMatchObject({
      app: "janosik",
      boards: [{ id: "b-1", title: "Alpha" }],
    });
    // Only the app's own keys are wiped.
    expect(localStorage.getItem(BOARDS_KEY)).toBeNull();
    expect(localStorage.getItem("unrelated-app-key")).toBe("keep me");
  });

  it("dumps unparsable data verbatim rather than losing it", () => {
    localStorage.setItem(BOARDS_KEY, "{not json");
    renderCrashed();

    fireEvent.click(screen.getByTestId("error-reset"));
    fireEvent.click(screen.getByTestId("error-reset-confirm"));

    expect(vi.mocked(downloadTextFile).mock.calls[0]?.[1]).toBe("{not json");
    expect(localStorage.getItem(BOARDS_KEY)).toBeNull();
  });
});

describe("compact fallback close (TASK-156 review)", () => {
  it("closes through onReset and remounts the children", () => {
    let broken = true;
    function Fickle() {
      if (broken) throw new Error("boom");
      return <div data-testid="recovered">fine</div>;
    }
    const onReset = vi.fn(() => {
      broken = false;
    });
    render(
      <ErrorBoundary compact onReset={onReset}>
        <Fickle />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId("error-compact")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("error-compact-close"));

    expect(onReset).toHaveBeenCalledTimes(1);
    // The boundary cleared its error and the children rendered again.
    expect(screen.getByTestId("recovered")).toBeInTheDocument();
    expect(screen.queryByTestId("error-compact")).toBeNull();
  });

  it("keeps the reload escape hatch when no onReset is given", () => {
    render(
      <ErrorBoundary compact>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId("error-compact")).toBeInTheDocument();
    // No close action without an owner-provided reset — only the reload.
    expect(screen.queryByTestId("error-compact-close")).toBeNull();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });
});
