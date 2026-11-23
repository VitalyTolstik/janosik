import type { IncomingMessage } from "node:http";

import { describe, expect, it } from "vitest";

import { clientAddress } from "./http-server.js";

function request(
  xff: string | undefined,
  remote = "10.0.0.7",
): IncomingMessage {
  return {
    headers: xff === undefined ? {} : { "x-forwarded-for": xff },
    socket: { remoteAddress: remote },
  } as unknown as IncomingMessage;
}

describe("trusted proxy address selection", () => {
  it("falls back to the socket when the chain is shorter than the hop count", () => {
    expect(clientAddress(request("1.2.3.4"), 2)).toBe("10.0.0.7");
  });

  it("ignores a non-IP right-edge candidate", () => {
    expect(clientAddress(request("1.2.3.4, not-an-ip"), 1)).toBe("10.0.0.7");
  });

  it("accepts an IPv6 client from the trusted hop", () => {
    expect(clientAddress(request("2001:db8::1"), 1)).toBe("2001:db8::1");
  });

  it("rejects an IPv4:port candidate and falls back", () => {
    expect(clientAddress(request("1.2.3.4:5678"), 1)).toBe("10.0.0.7");
  });

  it("selects the right edge, not a spoofed leftmost entry", () => {
    expect(clientAddress(request("9.9.9.9, 1.2.3.4"), 1)).toBe("1.2.3.4");
  });
});
