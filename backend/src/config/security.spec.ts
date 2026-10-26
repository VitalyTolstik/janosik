const mockEnv = {
  NODE_ENV: "production",
  COOKIE_SECURE: "",
  PUBLIC_ORIGIN: "https://kanban.example.com",
};

jest.mock("./env", () => ({ env: mockEnv }));

import { assertBootSecurity, cookieSecure } from "./security";

/**
 * Self-host hardening guard (TASK-38a). `env` is frozen by envalid, so the
 * module is stubbed and the mutable `mockEnv` drives the branches.
 */
describe("config/security", () => {
  beforeEach(() => {
    mockEnv.NODE_ENV = "production";
    mockEnv.COOKIE_SECURE = "";
    mockEnv.PUBLIC_ORIGIN = "https://kanban.example.com";
  });

  describe("cookieSecure", () => {
    it("is on by default in production", () => {
      expect(cookieSecure()).toBe(true);
    });

    it("is off outside production by default", () => {
      mockEnv.NODE_ENV = "development";
      expect(cookieSecure()).toBe(false);
    });

    it("honours an explicit override in both directions", () => {
      mockEnv.COOKIE_SECURE = "false";
      expect(cookieSecure()).toBe(false);
      mockEnv.NODE_ENV = "development";
      mockEnv.COOKIE_SECURE = "true";
      expect(cookieSecure()).toBe(true);
    });
  });

  describe("assertBootSecurity", () => {
    it("does nothing outside production", () => {
      mockEnv.NODE_ENV = "development";
      mockEnv.PUBLIC_ORIGIN = "http://localhost:5173";
      const log = jest.fn();
      expect(() => assertBootSecurity(log)).not.toThrow();
      expect(log).not.toHaveBeenCalled();
    });

    it("refuses to boot a production install on plain HTTP", () => {
      mockEnv.PUBLIC_ORIGIN = "http://192.168.1.50:3000";
      expect(() => assertBootSecurity(jest.fn())).toThrow(/not HTTPS/);
    });

    it("boots HTTPS in production without a warning", () => {
      const log = jest.fn();
      expect(() => assertBootSecurity(log)).not.toThrow();
      expect(log).not.toHaveBeenCalled();
    });

    it("boots HTTP only when the operator opted out, with a loud warning", () => {
      mockEnv.PUBLIC_ORIGIN = "http://192.168.1.50:3000";
      mockEnv.COOKIE_SECURE = "false";
      const log = jest.fn();
      expect(() => assertBootSecurity(log)).not.toThrow();
      expect(log).toHaveBeenCalledWith(expect.stringContaining("WARNING"));
    });
  });
});
