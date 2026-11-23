// TASK-200.1 — deterministic mock API for `npm run perf:smoke`.
//
// Implements only the routes the harness uses, but it validates the same wire
// fields the real command endpoint validates and mirrors its status codes:
// a claim-lease conflict is `400`, a stale `ifMatch` is `409`. This is what
// makes a mock run catch a missing `action.at`/`commandId` before a real one
// spends a dedicated host discovering it.

import { createHash } from "node:crypto";
import { createServer } from "node:http";

const MAX_ID_LENGTH = 128;
const MAX_COMMAND_ID = 64;
const CLAIM_LEASE_MAX_MS = 24 * 60 * 60 * 1000;
const COMMAND_SKEW_MS = 5 * 60 * 1000;

export async function startMockServer({
  port = 0,
  boardCount = 1,
  cardsPerBoard = 120,
  host = "127.0.0.1",
  commandStatus = null,
  commentStatus = null,
  sseStatus = null,
  sseCloseImmediately = false,
  sseHang = false,
} = {}) {
  const boards = new Map();
  const sseClients = new Set();
  const commands = new Map();
  const comments = new Map();
  const stats = {
    requests: 0,
    commands: 0,
    comments: 0,
    sseOpened: 0,
    statuses: {},
  };

  function resetBoards() {
    boards.clear();
    commands.clear();
    comments.clear();
    for (let index = 0; index < boardCount; index += 1) {
      const board = createBoard(index, cardsPerBoard);
      boards.set(board.id, board);
    }
  }
  resetBoards();

  const server = createServer((request, response) => {
    handle(request, response).catch((error) => {
      send(response, 500, { message: String(error) });
    });
  });

  function send(response, status, body) {
    stats.statuses[String(status)] = (stats.statuses[String(status)] ?? 0) + 1;
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  }

  async function handle(request, response) {
    stats.requests += 1;
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? host}`,
    );
    const path = url.pathname.replace(/^\/api\/v1/, "") || "/";
    if (path === "/health") {
      return send(response, 200, { status: "ok", mock: true });
    }
    if (path === "/__mock/stats") {
      return send(response, 200, { ...stats, statuses: { ...stats.statuses } });
    }
    const authorization = request.headers.authorization;
    if (
      typeof authorization !== "string" ||
      !authorization.startsWith("Bearer ")
    ) {
      return send(response, 401, { message: "missing token" });
    }
    const token = authorization.slice("Bearer ".length);
    const user = mockUser(token);

    if (path === "/auth/me") {
      return send(response, 200, user);
    }
    if (path === "/boards") {
      return send(
        response,
        200,
        [...boards.values()]
          .filter((board) => canAccessBoard(token, board.id))
          .map((board) => ({
            id: board.id,
            title: board.title,
            role: mockRole(token),
            counters: { cards: Object.keys(board.cards).length },
          })),
      );
    }

    const commentMatch = /^\/cards\/([^/]+)\/comments$/.exec(path);
    if (commentMatch !== null && request.method === "POST") {
      const body = await readJson(request);
      const cardId = decodeURIComponent(commentMatch[1]);
      let card;
      let cardBoard;
      for (const candidate of boards.values()) {
        if (candidate.cards[cardId] !== undefined) {
          card = candidate.cards[cardId];
          cardBoard = candidate;
          break;
        }
      }
      if (card === undefined) {
        return send(response, 400, {
          message: "unknown card",
          field: "cardId",
        });
      }
      if (!canAccessBoard(token, cardBoard.id)) {
        return send(response, 403, { message: "not a board member" });
      }
      if (commentStatus !== null) {
        return send(response, commentStatus, {
          message: `injected comment status ${commentStatus}`,
          injected: true,
        });
      }
      if (typeof body?.text !== "string" || body.text.trim() === "") {
        return send(response, 400, {
          message: "text is required",
          field: "text",
        });
      }
      const key =
        request.headers["idempotency-key"] ??
        (typeof body.commandId === "string" ? body.commandId : undefined);
      if (typeof key === "string" && key !== "") {
        const previous = comments.get(key);
        if (previous !== undefined) {
          if (previous.text !== body.text) {
            return send(response, 409, {
              message: "comment idempotency key is in use",
              field: "commandId",
              conflict: "id",
            });
          }
          return send(response, previous.status, previous.body);
        }
      }
      stats.comments += 1;
      const payload = {
        id: `comment-${stats.comments}`,
        cardId: card.id,
        text: body.text,
        kind: body.kind ?? "note",
      };
      if (typeof key === "string" && key !== "") {
        comments.set(key, { text: body.text, status: 201, body: payload });
      }
      return send(response, 201, payload);
    }

    const boardMatch = /^\/boards\/([^/]+)(?:\/(.*))?$/.exec(path);
    if (boardMatch === null) {
      return send(response, 404, { message: "not found" });
    }
    const board = boards.get(decodeURIComponent(boardMatch[1]));
    if (board === undefined) {
      return send(response, 404, { message: "unknown board" });
    }
    if (!canAccessBoard(token, board.id)) {
      return send(response, 403, { message: "not a board member" });
    }
    const rest = boardMatch[2] ?? "";
    if (rest === "") {
      response.setHeader("X-Board-Seq", String(board.seq));
      return send(response, 200, board.public);
    }
    if (rest === "activity") {
      return send(response, 200, { items: [], nextCursor: null });
    }
    if (rest === "ready") {
      return send(response, 200, {
        items: readyCards(board),
        nextCursor: null,
      });
    }
    if (rest === "events") {
      if (sseHang) {
        sseClients.add(response);
        request.on("close", () => sseClients.delete(response));
        return;
      }
      if (sseStatus !== null) {
        return send(response, sseStatus, {
          message: `injected SSE status ${sseStatus}`,
          injected: true,
        });
      }
      if (sseCloseImmediately) {
        stats.sseOpened += 1;
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        });
        response.end(": connected\n\n");
        return;
      }
      return openSse(request, response, board);
    }
    if (rest === "commands" && request.method === "POST") {
      const body = await readJson(request);
      stats.commands += 1;
      if (commandStatus !== null) {
        return send(response, commandStatus, {
          message: `injected command status ${commandStatus}`,
          injected: true,
        });
      }
      const result = applyCommand(board, body, user);
      return send(response, result.status, result.body);
    }
    return send(response, 404, { message: "not found" });
  }

  function applyCommand(board, body, user) {
    const problem = validateCommandEnvelope(body);
    if (problem !== null) {
      return { status: 400, body: problem };
    }
    const { at: _at, ...fingerprintAction } = body.action;
    const fingerprint = JSON.stringify({
      ...fingerprintAction,
      boardId: board.id,
    });
    const previous = commands.get(body.commandId);
    if (previous !== undefined) {
      if (previous.fingerprint !== fingerprint) {
        return {
          status: 409,
          body: {
            message: "commandId already used with a different payload",
            field: "commandId",
            conflict: "id",
            code: "idempotency_conflict",
          },
        };
      }
      return { status: previous.status, body: previous.body };
    }
    if (body.ifMatch !== undefined && Number(body.ifMatch) !== board.seq) {
      return {
        status: 409,
        body: { message: "board seq conflict", conflict: "version" },
      };
    }
    if (body.action.boardId !== board.id) {
      return {
        status: 400,
        body: {
          message: "action.boardId must name the routed board",
          field: "action.boardId",
        },
      };
    }
    const actionError = applyAction(board, body.action, user);
    if (actionError !== null) {
      return { status: actionError.status, body: actionError.body };
    }
    board.seq += 1;
    const result = {
      status: 200,
      body: {
        seq: board.seq,
        versions: {
          [`card:${body.action.cardId}`]: Date.now(),
          [`board:${board.id}`]: Date.now(),
        },
      },
    };
    commands.set(body.commandId, { fingerprint, ...result });
    return result;
  }

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const actual = actualPort(server, port);
  return {
    url: `http://${host}:${actual}`,
    baseUrl: `http://${host}:${actual}/api/v1`,
    port: actual,
    stats: () => ({ ...stats, statuses: { ...stats.statuses } }),
    resetBoards,
    close: async () => {
      for (const response of sseClients) response.end();
      sseClients.clear();
      await new Promise((resolve) => server.close(resolve));
    },
  };

  function applyAction(board, action, user) {
    const card = board.cards[action.cardId];
    if (card === undefined) {
      return {
        status: 400,
        body: { message: "unknown card", field: "action.cardId" },
      };
    }
    if (action.type === "CLAIM_CARD") {
      const live =
        typeof card.claimedBy === "string" &&
        typeof card.leaseUntil === "number" &&
        card.leaseUntil > Date.now();
      if (action.claimedBy === null) {
        if (live && card.claimedBy !== user.id && user.role !== "ADMIN") {
          return claimConflict(card);
        }
        delete card.claimedBy;
        delete card.leaseUntil;
      } else {
        if (live && card.claimedBy !== user.id) {
          return claimConflict(card);
        }
        card.claimedBy = action.claimedBy;
        card.leaseUntil = action.leaseUntil;
      }
      card.updatedAt = Date.now();
      return null;
    }
    if (action.type === "MOVE_CARD") {
      const from = board.public.columns.find(
        (column) => column.id === action.fromColumnId,
      );
      const to = board.public.columns.find(
        (column) => column.id === action.toColumnId,
      );
      if (from === undefined || to === undefined) {
        return {
          status: 400,
          body: { message: "unknown column", field: "action.toColumnId" },
        };
      }
      if (!from.cardIds.includes(card.id)) {
        return {
          status: 400,
          body: {
            message: "card is not in fromColumnId",
            field: "action.fromColumnId",
          },
        };
      }
      from.cardIds = from.cardIds.filter((id) => id !== card.id);
      const toIndex = Math.min(
        Math.max(0, Number(action.toIndex) || 0),
        to.cardIds.length,
      );
      to.cardIds.splice(toIndex, 0, card.id);
      card.updatedAt = Date.now();
      return null;
    }
    return {
      status: 400,
      body: { message: "unsupported action type", field: "action.type" },
    };
  }

  function claimConflict(card) {
    return {
      status: 400,
      body: {
        message: `Card is claimed by another member until ${new Date(card.leaseUntil).toISOString()}`,
        field: "action.claimedBy",
      },
    };
  }

  function openSse(request, response, board) {
    stats.sseOpened += 1;
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write(`: connected board=${board.id}\n\n`);
    sseClients.add(response);
    const keepAlive = setInterval(() => {
      response.write(": keep-alive\n\n");
    }, 10_000);
    keepAlive.unref?.();
    const close = () => {
      clearInterval(keepAlive);
      sseClients.delete(response);
      response.end();
    };
    request.on("close", close);
    response.on("close", close);
  }
}

function validateCommandEnvelope(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { message: "body must be an object", field: "body" };
  }
  if (
    typeof body.commandId !== "string" ||
    body.commandId.trim() === "" ||
    body.commandId.length > MAX_COMMAND_ID
  ) {
    return {
      message: "commandId is required (max 64 chars)",
      field: "commandId",
    };
  }
  if (
    body.ifMatch !== undefined &&
    (!Number.isInteger(body.ifMatch) || body.ifMatch < 0)
  ) {
    return {
      message: "ifMatch must be a non-negative integer",
      field: "ifMatch",
    };
  }
  const action = body.action;
  if (action === null || typeof action !== "object" || Array.isArray(action)) {
    return { message: "action is required", field: "action" };
  }
  if (typeof action.type !== "string" || action.type === "") {
    return { message: "type is required", field: "action.type" };
  }
  if (!["CLAIM_CARD", "MOVE_CARD"].includes(action.type)) {
    return {
      message: "unsupported action type",
      field: "action.type",
    };
  }
  if (!Number.isFinite(action.at)) {
    return { message: "at is required", field: "action.at" };
  }
  if (Math.abs(action.at - Date.now()) > COMMAND_SKEW_MS) {
    return {
      message: "at is too far from the server clock",
      field: "action.at",
    };
  }
  if (!idField(action.cardId)) {
    return { message: "cardId is required", field: "action.cardId" };
  }
  if (action.type === "CLAIM_CARD") {
    if (action.claimedBy === null) {
      if (action.leaseUntil !== null && action.leaseUntil !== undefined) {
        return {
          message: "leaseUntil must be null when releasing",
          field: "action.leaseUntil",
        };
      }
    } else if (!idField(action.claimedBy)) {
      return {
        message: "claimedBy must be null or a user id",
        field: "action.claimedBy",
      };
    } else if (!Number.isFinite(action.leaseUntil)) {
      return {
        message: "leaseUntil is required when claiming",
        field: "action.leaseUntil",
      };
    } else if (action.leaseUntil > action.at + CLAIM_LEASE_MAX_MS) {
      return { message: "lease is too long", field: "action.leaseUntil" };
    }
  }
  if (action.type === "MOVE_CARD") {
    for (const field of ["fromColumnId", "toColumnId"]) {
      if (!idField(action[field])) {
        return { message: `${field} is required`, field: `action.${field}` };
      }
    }
    for (const field of ["fromIndex", "toIndex"]) {
      if (!Number.isInteger(action[field]) || action[field] < 0) {
        return {
          message: `${field} must be a non-negative integer`,
          field: `action.${field}`,
        };
      }
    }
  }
  return null;
}

function idField(value) {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    value.length <= MAX_ID_LENGTH &&
    value !== "__proto__"
  );
}

function actualPort(server, fallback) {
  const address = server.address();
  return typeof address === "object" && address ? address.port : fallback;
}

function readyCards(board) {
  const done = board.public.columns[board.public.columns.length - 1];
  const cards = [];
  for (const column of board.public.columns) {
    if (column.id === done?.id) continue;
    for (const cardId of column.cardIds) {
      const card = board.cards[cardId];
      if (card === undefined) continue;
      if (
        typeof card.claimedBy === "string" &&
        typeof card.leaseUntil === "number" &&
        card.leaseUntil > Date.now()
      ) {
        continue;
      }
      cards.push({
        id: card.id,
        title: card.title,
        boardId: board.id,
        column: column.title,
      });
    }
  }
  return cards;
}

function createBoard(index, cardCount) {
  const id = `board-${index + 1}`;
  const now = Date.now();
  const columns = [
    { id: `${id}-backlog`, title: "Backlog", cardIds: [], createdAt: now },
    { id: `${id}-doing`, title: "In progress", cardIds: [], createdAt: now },
    { id: `${id}-done`, title: "Done", cardIds: [], createdAt: now },
  ];
  const cards = {};
  for (let number = 0; number < cardCount; number += 1) {
    const cardId = `${id}-card-${number + 1}`;
    cards[cardId] = {
      id: cardId,
      title: `Mock card ${number + 1}`,
      labelIds: [],
      createdAt: now,
      updatedAt: now,
    };
    columns[number % 2].cardIds.push(cardId);
  }
  const publicBoard = {
    id,
    title: `Mock board ${index + 1}`,
    columns,
    cards,
    labels: [],
    createdAt: now,
    updatedAt: now,
  };
  return { id, title: publicBoard.title, seq: 1, public: publicBoard, cards };
}

function mockUser(token) {
  const digest = createHash("sha256").update(token).digest("hex").slice(0, 10);
  const access = mockAccess(token);
  return {
    id: `mock-user-${digest}`,
    email: `${digest}@perf.invalid`,
    displayName: `Perf agent ${digest.slice(0, 4)}`,
    role: mockRole(token),
    token: {
      id: `mock-token-${digest}`,
      name: `Perf ${digest.slice(0, 4)}`,
      scopePreset: access.scope,
      trustedCi: false,
      effectiveTokenScope: access.scope,
      boardId: access.onlyBoard,
      readOnly: access.readOnly,
      rateLimitPerMinute: null,
      individualPausedAt: access.paused ? Date.now() : null,
      stopAllPausedAt: null,
      paused: access.paused,
    },
  };
}

function mockAccess(token) {
  const lower = String(token).toLowerCase();
  const readOnly = /readonly|read-only/.test(lower);
  const observer = /observer/.test(lower);
  const paused = /paused/.test(lower);
  const viewer = /viewer/.test(lower);
  const admin = /admin/.test(lower);
  const onlyBoard = /board1|board-1/.test(lower)
    ? "board-1"
    : /board2|board-2/.test(lower)
      ? "board-2"
      : null;
  return {
    readOnly,
    paused,
    viewer,
    admin,
    onlyBoard,
    noBoards: /noboards|no-boards/.test(lower),
    scope: readOnly || observer ? "observer" : admin ? "admin" : "worker",
  };
}

function mockRole(token) {
  const access = mockAccess(token);
  if (access.admin) return "ADMIN";
  return access.viewer ? "VIEWER" : "MEMBER";
}

function canAccessBoard(token, boardId) {
  const access = mockAccess(token);
  if (access.noBoards) return false;
  return access.onlyBoard === null || access.onlyBoard === boardId;
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) {
        reject(new Error("body too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body === "" ? {} : JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}
