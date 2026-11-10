import {
  ServiceUnavailableException,
  type ArgumentsHost,
} from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import { ApiExceptionFilter } from "./api-exception.filter";

/**
 * TASK-166.4: the filter must keep the real `Retry-After` a guard or
 * throttler already wrote, and mirror it into the body. Only when no header
 * exists may the envelope's fallback be written.
 */
function harness(initial: Record<string, string | number> = {}) {
  const headers = new Map<string, string | number>(
    Object.entries(initial).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const response = {
    headersSent: false,
    getHeader: jest.fn((name: string) => headers.get(name.toLowerCase())),
    setHeader: jest.fn((name: string, value: string) => {
      headers.set(name.toLowerCase(), value);
    }),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const host = {
    getType: () => "http",
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  const traffic = { recordThrottled: jest.fn() };
  const filter = new ApiExceptionFilter(traffic as never);
  return { filter, host, response, traffic };
}

describe("ApiExceptionFilter Retry-After", () => {
  it("preserves the throttler header and mirrors its real value", () => {
    const { filter, host, response, traffic } = harness({
      "Retry-After": "37",
    });
    filter.catch(new ThrottlerException(), host);
    expect(traffic.recordThrottled).toHaveBeenCalledTimes(1);
    expect(response.setHeader).not.toHaveBeenCalledWith(
      "Retry-After",
      expect.anything(),
    );
    expect(response.status).toHaveBeenCalledWith(429);
    expect(
      (response.json.mock.calls[0]![0] as { message: string }).message,
    ).toBe("Too many requests");
    expect(
      (response.json.mock.calls[0]![0] as { retryAfter: number }).retryAfter,
    ).toBe(37);
  });

  it("writes the envelope fallback when no guard set a header", () => {
    const { filter, host, response } = harness();
    filter.catch(
      new ServiceUnavailableException({
        message: "busy",
        code: "board_write_timeout",
        retryAfter: 4,
      }),
      host,
    );
    expect(response.setHeader).toHaveBeenCalledWith("Retry-After", "4");
    expect(
      (response.json.mock.calls[0]![0] as { retryAfter: number }).retryAfter,
    ).toBe(4);
  });

  it("accepts a numeric header", () => {
    const { filter, host, response } = harness({ "Retry-After": 9 });
    filter.catch(new ThrottlerException(), host);
    expect(
      (response.json.mock.calls[0]![0] as { retryAfter: number }).retryAfter,
    ).toBe(9);
  });
});
