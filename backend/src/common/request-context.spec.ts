import type { NextFunction, Request, Response } from "express";
import {
  currentRequestId,
  requestContext,
  REQUEST_ID_HEADER,
} from "./request-context";

/**
 * TASK-153: an incident is traced by the id echoed in `X-Request-Id`; a
 * caller-supplied id is only trusted behind a configured proxy (TASK-156).
 */
describe("requestContext", () => {
  function run(headers: Record<string, string> = {}) {
    const res = {
      setHeader: jest.fn(),
    } as unknown as Response;
    let inside: string | undefined;
    const next: NextFunction = () => {
      inside = currentRequestId();
    };
    requestContext({ headers } as unknown as Request, res, next);
    return { inside, setHeader: res.setHeader as jest.Mock };
  }

  it("mints an id when the caller sent none", () => {
    const { inside, setHeader } = run();
    expect(inside).toBeDefined();
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, inside);
  });

  it("ignores a caller-supplied id unless a trusted proxy is configured", () => {
    const { inside } = run({ [REQUEST_ID_HEADER]: "trace-123" });
    expect(inside).not.toBe("trace-123");
    expect(inside).toBeDefined();
  });

  it("has no id outside a request", () => {
    expect(currentRequestId()).toBeUndefined();
  });
});
