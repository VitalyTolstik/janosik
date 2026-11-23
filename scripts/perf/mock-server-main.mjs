#!/usr/bin/env node

// TASK-200.1 — standalone mock API for out-of-process integration tests.
//
// Prints one JSON line with the URL, then stays alive until SIGTERM. The
// real-mode test uses this so the CLI is spawned exactly as it would be
// against a real API: no in-process mock shortcut, no special code path.

import { clampMockSizes } from "./lib/config.mjs";
import { startMockServer } from "./lib/mock-server.mjs";

const port = Number(process.env.MOCK_PORT ?? 0);
const requestedBoards = Number(process.env.MOCK_BOARDS ?? 1);
const requestedCards = Number(process.env.MOCK_CARDS ?? 120);
const mockSize = clampMockSizes({
  boards: Number.isInteger(requestedBoards) ? requestedBoards : 1,
  cards: Number.isInteger(requestedCards) ? requestedCards : 120,
});
const boardCount = mockSize.boards;
const cardsPerBoard = mockSize.cards;
const injected = (name) => {
  const value = Number(process.env[name] ?? "");
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
};

const server = await startMockServer({
  port,
  boardCount,
  cardsPerBoard,
  commandStatus: injected("MOCK_COMMAND_STATUS"),
  commentStatus: injected("MOCK_COMMENT_STATUS"),
  sseStatus: injected("MOCK_SSE_STATUS"),
});
process.stdout.write(
  `${JSON.stringify({ baseUrl: server.baseUrl, url: server.url, port: server.port, boards: boardCount, cards: cardsPerBoard })}\n`,
);

const close = async () => {
  await server.close().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", close);
process.on("SIGTERM", close);
