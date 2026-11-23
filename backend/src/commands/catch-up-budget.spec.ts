import {
  CATCH_UP_MAX_BYTES,
  CATCH_UP_MAX_IN_FLIGHT,
  CatchUpBudget,
} from "./catch-up-budget";

describe("CatchUpBudget (TASK-200.13)", () => {
  it("caps concurrent catch-ups and releases idempotently", () => {
    const budget = new CatchUpBudget(1_000, 2);
    const first = budget.tryBegin();
    const second = budget.tryBegin();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(budget.tryBegin()).toBeNull();
    expect(budget.activeCatchUps).toBe(2);

    first?.();
    first?.();
    expect(budget.activeCatchUps).toBe(1);
    expect(budget.tryBegin()).not.toBeNull();
  });

  it("caps reserved bytes and rejects a single oversized reservation", () => {
    const budget = new CatchUpBudget(100, 10);
    const first = budget.tryReserve(60);
    expect(first).not.toBeNull();
    expect(budget.tryReserve(50)).toBeNull();
    const second = budget.tryReserve(40);
    expect(second).not.toBeNull();
    expect(budget.activeBytes).toBe(100);

    second?.();
    first?.();
    expect(budget.activeBytes).toBe(0);
    expect(budget.tryReserve(101)).toBeNull();
  });

  it("fits six concurrent pages inside the 32 MiB default", () => {
    const budget = new CatchUpBudget();
    const attempts = Array.from({ length: 6 }, () => budget.tryBegin());
    expect(attempts.every((release) => release !== null)).toBe(true);
    expect(budget.tryBegin()).toBeNull();

    const reservations = Array.from({ length: 6 }, () =>
      budget.tryReserve(5 * 1024 * 1024),
    );
    expect(reservations.every((release) => release !== null)).toBe(true);
    expect(budget.activeBytes).toBe(30 * 1024 * 1024);
    expect(budget.tryReserve(3 * 1024 * 1024)).toBeNull();

    for (const release of reservations) release?.();
    for (const release of attempts) release?.();
    expect(budget.activeBytes).toBe(0);
    expect(budget.activeCatchUps).toBe(0);
  });

  it("uses a 32 MiB / 6 in-flight default", () => {
    const budget = new CatchUpBudget();
    expect(CATCH_UP_MAX_BYTES).toBe(32 * 1024 * 1024);
    expect(CATCH_UP_MAX_IN_FLIGHT).toBe(6);
    expect(budget.activeCatchUps).toBe(0);
    expect(budget.activeBytes).toBe(0);
  });
});
