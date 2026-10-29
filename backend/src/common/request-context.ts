import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import { env } from "@/config/env";

/**
 * Per-request trace context (TASK-153). An incident report carries the
 * `X-Request-Id` from the response; slow-query warnings and error logs add
 * the same id, so the whole request can be followed through the log.
 */
const storage = new AsyncLocalStorage<string>();

/** The id of the request currently being handled, if any. */
export function currentRequestId(): string | undefined {
  return storage.getStore();
}

/** Header used both to accept a caller's id (proxy/tracing) and to echo it. */
export const REQUEST_ID_HEADER = "x-request-id";

/** Assign (or accept) a request id and run the rest of the stack inside it. */
export function requestContext(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.headers[REQUEST_ID_HEADER];
  // A caller-supplied id is only trusted behind a configured proxy/tracing
  // hop (TASK-156); otherwise anyone could poison the correlation id.
  const id =
    env.TRUST_PROXY > 0 &&
    typeof incoming === "string" &&
    /^[A-Za-z0-9._-]{1,64}$/.test(incoming)
      ? incoming
      : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  storage.run(id, next);
}
