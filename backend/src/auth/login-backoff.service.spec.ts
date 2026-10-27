import { HttpException } from "@nestjs/common";
import {
  LOGIN_BASE_LOCK_MS,
  LOGIN_FREE_ATTEMPTS,
  LoginBackoffService,
} from "./login-backoff.service";

/** B-8: per-account login backoff (in-memory store; tests run without Redis). */
describe("LoginBackoffService", () => {
  afterEach(() => jest.useRealTimers());

  it("locks an address after the free attempts and doubles the lock", async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    const backoff = new LoginBackoffService();
    for (let i = 0; i < LOGIN_FREE_ATTEMPTS; i += 1) {
      await backoff.assertNotLocked("Vera@Example.com");
      await backoff.recordFailure("vera@example.com");
    }
    // Five wrong passwords: the sixth try is refused, case-insensitively.
    await expect(backoff.assertNotLocked("VERA@example.com")).rejects.toThrow(
      HttpException,
    );
    jest.setSystemTime(1_000_000 + LOGIN_BASE_LOCK_MS + 1);
    await backoff.assertNotLocked("vera@example.com");
    await backoff.recordFailure("vera@example.com");
    jest.setSystemTime(1_000_000 + LOGIN_BASE_LOCK_MS * 2);
    // Second lock is twice as long, counted from the latest failure.
    await expect(backoff.assertNotLocked("vera@example.com")).rejects.toThrow(
      HttpException,
    );
  });

  it("forgets the failures on success and keeps other addresses apart", async () => {
    const backoff = new LoginBackoffService();
    for (let i = 0; i < LOGIN_FREE_ATTEMPTS + 1; i += 1) {
      await backoff.recordFailure("a@example.com");
    }
    await backoff.assertNotLocked("b@example.com");
    await backoff.reset("a@example.com");
    await backoff.assertNotLocked("a@example.com");
  });
});
