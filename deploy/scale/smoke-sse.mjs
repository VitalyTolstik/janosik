#!/usr/bin/env node
/**
 * TASK-200.12 live SSE smoke: prove that a command committed on one API
 * replica reaches a subscriber on another replica.
 *
 * This is an optional on-host check (Linux bridge networking). The cheap
 * always-run version is the unit smoke in
 * backend/src/realtime/realtime.replicas.spec.ts; this script exercises the
 * real containers, Redis and the command log.
 *
 *   JANOSIK_TOKEN=jnk_… JANOSIK_BOARD_ID=<uuid> node deploy/scale/smoke-sse.mjs
 *
 * The token needs ADMIN/MEMBER on the board. The script reads the board from
 * replica A, opens the stream on replica B, commits an ADD_CARD on A, waits for
 * the frame on B, then deletes the card again. Docker Desktop on macOS/Windows
 * cannot reach container IPs from the host; run it on the Docker host (Linux).
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const token = process.env.JANOSIK_TOKEN;
const boardId = process.env.JANOSIK_BOARD_ID;
if (!token || !boardId) {
  console.error(
    "usage: JANOSIK_TOKEN=jnk_… JANOSIK_BOARD_ID=<board-id> node deploy/scale/smoke-sse.mjs",
  );
  process.exit(2);
}

const compose = [
  "compose",
  "-f",
  "docker-compose.yml",
  "-f",
  "docker-compose.scale.yml",
];

function replicaAddresses() {
  const ids = execFileSync("docker", [...compose, "ps", "-q", "app"], {
    encoding: "utf8",
  })
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (ids.length < 2) {
    throw new Error(`expected at least two API replicas, found ${ids.length}`);
  }
  return ids
    .map((id) =>
      execFileSync(
        "docker",
        [
          "inspect",
          "-f",
          "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
          id,
        ],
        { encoding: "utf8" },
      ).trim(),
    )
    .filter(Boolean);
}

function authHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    ...extra,
  };
}

async function json(base, path, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: authHeaders(init.headers),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `${init.method ?? "GET"} ${path} → ${response.status} ${text}`,
    );
  }
  return { response, body: text === "" ? null : JSON.parse(text) };
}

async function command(base, action) {
  const commandId = `smoke-${randomUUID()}`;
  return json(base, `/api/v1/boards/${boardId}/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commandId, action }),
  });
}

function matchingFrame(buffer, cardId) {
  for (const line of buffer.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const frame = JSON.parse(line.slice(5).trim());
      if (
        frame?.type === "command" &&
        frame.action?.type === "ADD_CARD" &&
        frame.action?.newCardId === cardId
      ) {
        return frame;
      }
    } catch {
      /* keep waiting */
    }
  }
  return null;
}

const [writerHost, readerHost] = replicaAddresses();
const writer = `http://${writerHost}:3000`;
const reader = `http://${readerHost}:3000`;
console.log(`writer replica: ${writerHost}\nreader replica: ${readerHost}`);

const board = await json(writer, `/api/v1/boards/${boardId}`);
const columnId = board.body?.columns?.[0]?.id;
if (!columnId) throw new Error("board has no columns to add a smoke card to");
const since = Number(board.response.headers.get("x-board-seq") ?? 0);
const cardId = `smoke-card-${randomUUID()}`;
const controller = new AbortController();

try {
  const stream = await fetch(
    `${reader}/api/v1/boards/${boardId}/events?since=${since}&presence=0&client=${randomUUID()}`,
    {
      headers: authHeaders({ Accept: "text/event-stream" }),
      signal: controller.signal,
    },
  );
  if (!stream.ok) {
    throw new Error(`reader stream → ${stream.status}`);
  }
  console.log("stream open on the reader replica; committing on the writer");

  const waitForFrame = (async () => {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of stream.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const frame = matchingFrame(buffer, cardId);
      if (frame !== null) return frame;
    }
    throw new Error("stream ended before a command frame arrived");
  })();

  await command(writer, {
    type: "ADD_CARD",
    at: Date.now(),
    newCardId: cardId,
    columnId,
    title: "Replica smoke",
  });

  const timeout = new Promise((_, reject) =>
    setTimeout(
      () => reject(new Error("timed out waiting for the SSE frame")),
      10_000,
    ).unref?.(),
  );
  const frame = await Promise.race([waitForFrame, timeout]);
  if (frame?.action?.newCardId !== cardId) {
    throw new Error(`unexpected frame: ${JSON.stringify(frame)}`);
  }
  console.log(
    `ok: command seq ${frame.seq} committed on ${writerHost} arrived on ${readerHost}`,
  );
} finally {
  controller.abort();
  // Best-effort cleanup: soft-delete the smoke card through the writer.
  await command(writer, {
    type: "DELETE_CARD",
    at: Date.now(),
    cardId,
  }).catch((error) => {
    console.warn(`cleanup failed (delete ${cardId}): ${error.message}`);
  });
}
