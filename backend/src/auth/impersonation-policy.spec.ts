import { ForbiddenException } from "@nestjs/common";
import {
  assertImpersonationAllows,
  IMPERSONATION_FORBIDDEN_CODE,
  impersonationAllows,
} from "./impersonation-policy";

/**
 * TASK-147 (B3): a read-only "view as" session may read boards and the
 * presence heartbeat, but nothing that mutates the account or the board.
 */
describe("impersonation read-only policy", () => {
  it("allows every safe method on any path", () => {
    expect(impersonationAllows("GET", "/api/v1/boards/b1")).toBe(true);
    expect(impersonationAllows("HEAD", "/api/v1/auth/me")).toBe(true);
    expect(impersonationAllows("OPTIONS", "/api/v1/boards")).toBe(true);
  });

  it("refuses writes to the account and the board", () => {
    expect(impersonationAllows("POST", "/api/v1/auth/password")).toBe(false);
    expect(impersonationAllows("POST", "/api/v1/boards/b1/commands")).toBe(
      false,
    );
    expect(impersonationAllows("PATCH", "/api/v1/users/me")).toBe(false);
    expect(impersonationAllows("DELETE", "/api/v1/boards/b1")).toBe(false);
  });

  it("still allows the presence heartbeat the board needs", () => {
    expect(impersonationAllows("POST", "/api/v1/boards/b1/presence")).toBe(
      true,
    );
  });

  it("refuses a victim's personal-token surface even for reads", () => {
    expect(impersonationAllows("GET", "/api/v1/users/me/tokens")).toBe(false);
    expect(impersonationAllows("DELETE", "/api/v1/users/me/tokens/t1")).toBe(
      false,
    );
  });

  it("throws a stable 403 the UI and MCP can match", () => {
    try {
      assertImpersonationAllows("POST", "/api/v1/boards/b1/commands");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: IMPERSONATION_FORBIDDEN_CODE,
      });
    }
    expect(() =>
      assertImpersonationAllows("GET", "/api/v1/boards/b1"),
    ).not.toThrow();
  });
});
