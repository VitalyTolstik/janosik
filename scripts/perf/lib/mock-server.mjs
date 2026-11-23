// TASK-200.1 — deterministic mock API for `npm run perf:smoke`.
//
// Implements only the routes the harness uses, with real-ish CAS behaviour
// (409 on a stale ifMatch or a card lease held by another user) so the agent
// loop, retries and 409 counters are exercised without Docker or Postgres.

import { createHash } from "node:crypto";
import { createServer } from "node:http";

export async function startMockServer({
  port = 0,
  boardCount = 1,
  cardsPerBoard = 120,
  host = "127.0.0.1",
} = {}) {
  const boards = new Map();
  for (let index = 0; index < boardCount; index += 1) {
    const board = createBoard(index, cardsPerBoard);
    boards.set(board.id, board);
  }
  const sseClients = new Set();
  const stats = { requests: 0, commands: 0, comments: 0, sseOpened: 0 };

  const server = createServer((request, response) => {
    handle(request, response).catch((error) => {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ message: String(error) }));
    });
  });

  async function handle(request, response) {
    stats.requests += 1;
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? host}`,
    );
    const path = url.pathname.replace(/^\/api\/v1/, "") || "/";
    if (path === "/health") {
      return json(response, 200, { status: "ok", mock: true });
    }
    if (path === "/__mock/stats") {
      return json(response, 200, stats);
    }
    const authorization = request.headers.authorization;
    if (
      typeof authorization !== "string" ||
      !authorization.startsWith("Bearer ")
    ) {
      return json(response, 401, { message: "missing token" });
    }
    const token = authorization.slice("Bearer ".length);
    const user = mockUser(token);

    if (path === "/auth/me") {
      return json(response, 200, user);
    }
    if (path === "/boards") {
      return json(
        response,
        200,
        [...boards.values()].map((board) => ({
          id: board.id,
          title: board.title,
          role: "MEMBER",
          counters: { cards: Object.keys(board.cards).length },
        })),
      );
    }

    const commentMatch = /^\/cards\/([^/]+)\/comments$/.exec(path);
    if (commentMatch !== null && request.method === "POST") {
      const body = await readJson(request);
      const cardId = decodeURIComponent(commentMatch[1]);
      let card;
      for (const candidate of boards.values()) {
        if (candidate.cards[cardId] !== undefined) {
          card = candidate.cards[cardId];
          break;
        }
      }
      if (card === undefined) {
        return json(response, 404, { message: "unknown card" });
      }
      stats.comments += 1;
      return json(response, 201, {
        id: `comment-${stats.comments}`,
        cardId: card.id,
        text: body.text,
        kind: body.kind ?? "note",
      });
    }

    const boardMatch = /^\/boards\/([^/]+)(?:\/(.*))?$/.exec(path);
    if (boardMatch === null)
      return json(response, 404, { message: "not found" });
    const board = boards.get(decodeURIComponent(boardMatch[1]));
    if (board === undefined) {
      return json(response, 404, { message: "unknown board" });
    }
    const rest = boardMatch[2] ?? "";
    if (rest === "") {
      response.setHeader("X-Board-Seq", String(board.seq));
      return json(response, 200, board.public);
    }
    if (rest === "activity") {
      return json(response, 200, { items: [], nextCursor: null });
    }
    if (rest === "ready") {
      return json(response, 404, {
        message: "ready endpoint not implemented (200.2)",
      });
    }
    if (rest === "events") {
      return openSse(request, response, board);
    }
    if (rest === "commands" && request.method === "POST") {
      const body = await readJson(request);
      stats.commands += 1;
      if (body.ifMatch !== undefined && Number(body.ifMatch) !== board.seq) {
        return json(response, 409, {
          message: "board seq conflict",
          conflict: "version",
        });
      }
      const error = applyAction(board, body.action, user);
      if (error !== null) return json(response, 409, error);
      board.seq += 1;
      return json(response, 200, { seq: board.seq, versions: {} });
    }
    return json(response, 404, { message: "not found" });
  }

  function applyAction(board, action, user) {
    if (action === null || typeof action !== "object") {
      return { message: "invalid action" };
    }
    const card = board.cards[action.cardId];
    if (card === undefined) return { message: "unknown card" };
    if (action.type === "CLAIM_CARD") {
      const live =
        typeof card.claimedBy === "string" &&
        typeof card.leaseUntil === "number" &&
        card.leaseUntil > Date.now();
      if (live && card.claimedBy !== user.id) {
        return { message: "card is claimed by another member" };
      }
      if (action.claimedBy === null) {
        delete card.claimedBy;
        delete card.leaseUntil;
      } else {
        card.claimedBy = user.id;
        card.leaseUntil = Number(action.leaseUntil);
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
        return { message: "unknown column" };
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
    return null;
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

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const actualPort =
    typeof address === "object" && address ? address.port : port;
  return {
    url: `http://${host}:${actualPort}`,
    baseUrl: `http://${host}:${actualPort}/api/v1`,
    port: actualPort,
    stats: () => ({ ...stats }),
    close: async () => {
      for (const response of sseClients) response.end();
      sseClients.clear();
      await new Promise((resolve) => server.close(resolve));
    },
  };
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
  return {
    id: `mock-user-${digest}`,
    email: `${digest}@perf.invalid`,
    displayName: `Perf agent ${digest.slice(0, 4)}`,
  };
}

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
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
