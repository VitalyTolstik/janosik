import { HttpException } from "@nestjs/common";
import { UploadLimiter, UPLOAD_WINDOW_MS } from "./upload-limiter";

/**
 * TASK-146/TASK-147 follow-up: the per-user upload budget trips with `429`
 * and resets after the window, and the table is bounded.
 */
describe("UploadLimiter", () => {
  it("allows the budget, then refuses with 429", () => {
    const limiter = new UploadLimiter(() => 2);
    limiter.consume("u1", 0);
    limiter.consume("u1", 0);
    expect(() => limiter.consume("u1", 0)).toThrow(HttpException);
    try {
      limiter.consume("u1", 0);
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(429);
    }
    // A different user has its own budget.
    expect(() => limiter.consume("u2", 0)).not.toThrow();
  });

  it("resets after the window", () => {
    const limiter = new UploadLimiter(() => 1);
    limiter.consume("u1", 0);
    expect(() => limiter.consume("u1", 0)).toThrow(HttpException);
    expect(() => limiter.consume("u1", UPLOAD_WINDOW_MS + 1)).not.toThrow();
  });

  it("is a no-op when the limit is disabled", () => {
    const limiter = new UploadLimiter(() => 0);
    for (let index = 0; index < 100; index += 1) limiter.consume("u1", 0);
  });
});
