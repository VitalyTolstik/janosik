// TASK-200.1 — minimal fetch client for the agent-scale harness.
//
// One client per PAT. Every request is measured and counted by
// `RunMetrics`; 4xx/5xx answers are returned as `HttpError` so scenario code
// can count 409/429 explicitly without hiding them.

import { performance } from "node:perf_hooks";

export class HttpError extends Error {
  constructor({ operation, path, status, body }) {
    super(`${operation} ${path} -> ${status}: ${truncate(body, 300)}`);
    this.name = "HttpError";
    this.operation = operation;
    this.path = path;
    this.status = status;
    this.body = body;
  }
}

function truncate(value, limit) {
  const text = String(value ?? "");
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

function maybeJson(text) {
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class HttpClient {
  constructor({
    baseUrl,
    token,
    metrics,
    timeoutMs = 30_000,
    fetchImpl = fetch,
    signal = undefined,
  }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
    this.metrics = metrics;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
    this.signal = signal;
  }

  headers(extra = {}) {
    return {
      Accept: "application/json",
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...extra,
    };
  }

  combinedSignal(extra) {
    const signals = [];
    if (this.signal !== undefined) signals.push(this.signal);
    if (extra !== undefined) signals.push(extra);
    if (signals.length === 0) return undefined;
    return signals.length === 1 ? signals[0] : AbortSignal.any(signals);
  }

  async request(
    operation,
    path,
    {
      method = "GET",
      body,
      headers = {},
      allowStatuses = [],
      timeoutMs = this.timeoutMs,
      signal = undefined,
    } = {},
  ) {
    const started = performance.now();
    const timeoutController = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      timeoutController.abort();
    }, timeoutMs);
    const combined = this.combinedSignal(
      signal === undefined
        ? timeoutController.signal
        : AbortSignal.any([signal, timeoutController.signal]),
    );
    let response;
    let text;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers: this.headers({
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...headers,
        }),
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: combined,
      });
      text = await response.text();
    } catch (error) {
      const elapsed = performance.now() - started;
      const aborted =
        !timedOut &&
        (signal?.aborted === true || this.signal?.aborted === true);
      this.metrics.recordRequest(operation, elapsed, aborted ? -1 : 0);
      throw error;
    } finally {
      clearTimeout(timer);
    }

    const elapsed = performance.now() - started;
    const bytes = byteLength(text);
    const expectedLeaseConflict =
      response.status === 400 &&
      operation === "command.claim" &&
      !/Invalid command|Unsupported/i.test(text) &&
      /claimed by another|live claim|lease/i.test(text);
    this.metrics.recordRequest(operation, elapsed, response.status, bytes, {
      expected: expectedLeaseConflict,
    });
    const result = {
      status: response.status,
      ok: response.ok,
      headers: response.headers,
      text,
      bytes,
      json: maybeJson(text),
    };
    if (!response.ok && !allowStatuses.includes(response.status)) {
      throw new HttpError({
        operation,
        path,
        status: response.status,
        body: text,
      });
    }
    return result;
  }

  get(operation, path, options) {
    return this.request(operation, path, options);
  }

  post(operation, path, body, options = {}) {
    return this.request(operation, path, { ...options, method: "POST", body });
  }

  async health() {
    return this.request("health", "/health", { timeoutMs: 5_000 });
  }

  async me() {
    const response = await this.request("auth.me", "/auth/me");
    return response.json;
  }

  async listBoards() {
    const response = await this.request("board.list", "/boards");
    return Array.isArray(response.json) ? response.json : [];
  }

  async readBoard(boardId) {
    const response = await this.request(
      "board.read",
      `/boards/${encodeURIComponent(boardId)}`,
      { timeoutMs: 120_000 },
    );
    const board = response.json;
    const headerText = response.headers.get("x-board-seq");
    const header = headerText === null ? Number.NaN : Number(headerText);
    const boardSeq = Number(board?.seq);
    const seq = Number.isFinite(header)
      ? header
      : Number.isFinite(boardSeq)
        ? boardSeq
        : 0;
    return {
      board,
      seq,
      bytes: response.bytes,
      status: response.status,
    };
  }

  async readReady(boardId, limit = 20) {
    return this.request(
      "ready.read",
      `/boards/${encodeURIComponent(boardId)}/ready?limit=${limit}`,
      { allowStatuses: [404] },
    );
  }

  async readActivity(boardId, limit = 20) {
    return this.request(
      "activity.read",
      `/boards/${encodeURIComponent(boardId)}/activity?limit=${limit}`,
    );
  }

  async command(boardId, command, { allowStatuses = [409] } = {}) {
    return this.post(
      "command",
      `/boards/${encodeURIComponent(boardId)}/commands`,
      command,
      { allowStatuses },
    );
  }

  async claim(boardId, command, options) {
    return this.post(
      "command.claim",
      `/boards/${encodeURIComponent(boardId)}/commands`,
      command,
      { allowStatuses: [409], ...options },
    );
  }

  async move(boardId, command, options) {
    return this.post(
      "command.move",
      `/boards/${encodeURIComponent(boardId)}/commands`,
      command,
      { allowStatuses: [409], ...options },
    );
  }

  async comment(cardId, body, { idempotencyKey } = {}) {
    return this.post(
      "comment.create",
      `/cards/${encodeURIComponent(cardId)}/comments`,
      body,
      idempotencyKey !== undefined
        ? { headers: { "Idempotency-Key": idempotencyKey } }
        : {},
    );
  }

  /**
   * Open one SSE stream and consume it in the background. Resolves after the
   * response headers, so a ramp can know the stream is established; the
   * returned handle closes it and a `done` promise reports EOF.
   */
  async openSse({
    boardId,
    since = 0,
    presence = false,
    signal,
    onError,
  } = {}) {
    const controller = new AbortController();
    const signals = [controller.signal];
    if (this.signal !== undefined) signals.push(this.signal);
    if (signal !== undefined) signals.push(signal);
    const combined =
      signals.length === 1 ? signals[0] : AbortSignal.any(signals);
    const started = performance.now();
    let response;
    try {
      response = await this.fetch(
        `${this.baseUrl}/boards/${encodeURIComponent(boardId)}/events?since=${since}&presence=${presence ? 1 : 0}&client=perf-${randomId()}`,
        {
          headers: this.headers({ Accept: "text/event-stream" }),
          signal: combined,
        },
      );
    } catch (error) {
      this.metrics.recordRequest("sse.open", performance.now() - started, 0);
      this.metrics.sse.failed += 1;
      throw error;
    }
    const accepted = this.metrics.recordSseOpen(
      performance.now() - started,
      response.status,
    );
    if (!accepted || response.body === null) {
      const text = await response.text().catch(() => "");
      throw new HttpError({
        operation: "sse.open",
        path: `/boards/${boardId}/events`,
        status: response.status,
        body: text,
      });
    }

    let frames = 0;
    let bytes = 0;
    let closed = false;
    let buffer = "";
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    const done = (async () => {
      try {
        while (true) {
          const { done: eof, value } = await reader.read();
          if (eof) break;
          bytes += value.byteLength;
          this.metrics.recordSseBytes(value.byteLength);
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split(/\r?\n\r?\n/);
          buffer = parts.pop() ?? "";
          for (const _part of parts) {
            frames += 1;
            this.metrics.recordSseFrame(0);
          }
        }
      } catch (error) {
        if (error?.name !== "AbortError") onError?.(error);
      } finally {
        if (!closed) {
          closed = true;
          this.metrics.recordSseClose();
        }
      }
    })();

    return {
      status: response.status,
      frames: () => frames,
      bytes: () => bytes,
      close: () => {
        controller.abort();
        reader.cancel().catch(() => {});
        return done;
      },
      done,
    };
  }
}

export function byteLength(text) {
  return new TextEncoder().encode(text ?? "").byteLength;
}

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

export function sleep(ms, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, Math.max(0, ms));
    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    }
    signal?.addEventListener("abort", finish, { once: true });
  });
}
