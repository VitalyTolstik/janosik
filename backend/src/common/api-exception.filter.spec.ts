import {
  ServiceUnavailableException,
  type ArgumentsHost,
} from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import { ApiExceptionFilter } from "./api-exception.filter";
import { readBackpressure } from "./traffic.service";

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
  const request = { rateLimited: false };
  const host = {
    getType: () => "http",
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  const traffic = { recordThrottled: jest.fn() };
  const filter = new ApiExceptionFilter(traffic as never);
  return { filter, host, response, traffic, request };
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

  it("marks a board-read 503 as backpressure for the request log", () => {
    const { filter, host, response, traffic } = harness();
    filter.catch(
      new ServiceUnavailableException({
        message:
          "The board is under heavy read load; retry after a short pause",
        code: "board_read_busy",
        retryable: true,
        retryAfter: 2,
      }),
      host,
    );
    // The request log counts `rate_limit.read`; the 429 throttle ring must not
    // also receive this deliberate read backpressure.
    expect(traffic.recordThrottled).not.toHaveBeenCalled();
    expect(readBackpressure(response)).toBe("board_read");
    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.setHeader).toHaveBeenCalledWith("Retry-After", "2");

    const timeout = harness();
    timeout.filter.catch(
      new ServiceUnavailableException({
        message: "The board read timed out",
        code: "board_read_timeout",
        retryable: true,
        retryAfter: 2,
      }),
      timeout.host,
    );
    expect(timeout.traffic.recordThrottled).not.toHaveBeenCalled();
    expect(readBackpressure(timeout.response)).toBe("board_read");
  });

  it("treats long-poll capacity as backpressure and writes Retry-After", () => {
    const { filter, host, response, traffic, request } = harness();
    filter.catch(
      new ServiceUnavailableException({
        message: "Too many held ready polls; retry shortly",
        code: "ready_poll_capacity",
        retryable: true,
        retryAfter: 5,
      }),
      host,
    );
    expect(traffic.recordThrottled).toHaveBeenCalledTimes(1);
    expect(request.rateLimited).toBe(true);
    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.setHeader).toHaveBeenCalledWith("Retry-After", "5");
    expect(response.json.mock.calls[0]![0]).toMatchObject({
      code: "ready_poll_capacity",
      retryable: true,
      retryAfter: 5,
    });
  });

  it("treats the queued 503 rate_limited as backpressure, not a 5xx bug", () => {
    const { filter, host, response, traffic } = harness();
    filter.catch(
      new ServiceUnavailableException({
        message: "The board is busy with agent traffic",
        code: "rate_limited",
        retryable: true,
        retryAfter: 2,
        scope: "board",
      }),
      host,
    );
    expect(traffic.recordThrottled).toHaveBeenCalledTimes(1);
    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.setHeader).toHaveBeenCalledWith("Retry-After", "2");
    expect(response.json.mock.calls[0]![0]).toMatchObject({
      code: "rate_limited",
      retryable: true,
      retryAfter: 2,
      scope: "board",
    });
  });
});
