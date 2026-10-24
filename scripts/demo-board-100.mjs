#!/usr/bin/env node
// demo-board-100 — a "race start" sweep: seed a board with many tasks up
// front, then let one stream per task run them all at once.
//
// Unlike `demo-board-swarm` (a dispatcher that assigns work as it goes), this
// script first creates every card in the backlog in one burst and assigns each
// to its own agent, then opens N concurrent streams that grab their cards and
// drive them across the flow (Новые → В работе → На ревью → [rework] →
// Тестирование → Готово) with comments, checklists and screenshot attachments.
// It exists to watch many agents *move at the same time*.
//
//   BOARD=<boardId> node scripts/demo-board-100.mjs        # 100 agents by default
//
// Everything the streams do goes over the public API; provisioning of the
// demo agents (users + access tokens + membership) is the only direct-DB
// shortcut, because `/auth/register` is throttled to 5/min per IP.
//
// Env: API, BOARD (required), AGENTS (100), SLOW (1), LEAD (0),
//      PURGE (demo|all|none), PG_CONTAINER/PG_USER/PG_DB, JWT_SECRET.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(`${REPO}/`);
const jwt = require("jsonwebtoken");

const API = process.env.API ?? "http://localhost:3000/api/v1";
const BOARD = process.env.BOARD;
const SLOW = Number(process.env.SLOW ?? 1);
const LEAD_S = Number(process.env.LEAD ?? 0);
const AGENTS = Number(process.env.AGENTS ?? 100);
const PURGE = process.env.PURGE ?? "demo";
const PG = {
  container: process.env.PG_CONTAINER ?? "janosik-postgres",
  user: process.env.PG_USER ?? "janosik",
  db: process.env.PG_DB ?? "janosik",
};

if (!BOARD) {
  console.error(
    "BOARD is required, e.g. BOARD=<boardId> node scripts/demo-board-100.mjs",
  );
  process.exit(1);
}

const SEEDER = { name: "Планировщик", email: "seeder@janosik.demo" };
const AGENT_NAMES = [
  "Аня",
  "Борис",
  "Вера",
  "Гриша",
  "Даша",
  "Егор",
  "Женя",
  "Зина",
  "Игорь",
  "Клава",
  "Лена",
  "Марк",
  "Нина",
  "Олег",
  "Паша",
  "Рита",
  "Соня",
  "Тимур",
  "Ульяна",
  "Фёдор",
];
const AGENTS_LIST = Array.from({ length: AGENTS }, (_, i) => {
  const base = AGENT_NAMES[i % AGENT_NAMES.length];
  return {
    index: i,
    name: `${base} ${String(i + 1).padStart(3, "0")}`,
    email: `agent${i + 1}@janosik.demo`,
  };
});

const COLS = ["Новые", "В работе", "На ревью", "Тестирование", "Готово"];
const LABELS = [
  { name: "bug", color: "red" },
  { name: "feature", color: "green" },
  { name: "ui", color: "brand" },
  { name: "backend", color: "blue" },
  { name: "urgent", color: "orange" },
];
const TASKS = [
  "Починить верстку на мобиле",
  "Фильтр по меткам",
  "Ускорить запрос доски",
  "Экспорт в JSON",
  "Онбординг участников",
  "Ретраи SSE",
  "Тултип undo",
  "Сортировка по сроку",
  "Тёмная тема диалогов",
  "Логирование команд",
  "Skeleton при загрузке",
  "Валидация дублей меток",
  "Горячие клавиши DnD",
  "Автосейв описания",
  "Пагинация истории",
  "Иконки приоритетов",
  "Мобильный DnD",
  "Кэш аватарок",
  "Дублирование колонки",
  "Ссылка на карточку",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms * SLOW));
const jitter = (a, b) => a + Math.random() * (b - a);
const newId = (p) => `${p}${randomBytes(8).toString("hex")}`;
const ts = () => new Date().toISOString().slice(11, 19);
const log = (who, msg) => console.log(`${ts()}  ${who.padEnd(12)} │ ${msg}`);

function readSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const txt = readFileSync(`${REPO}/backend/.env`, "utf8");
  return txt.match(/^JWT_SECRET="?([^"\n]+)"?/m)?.[1];
}
const JWT_SECRET = readSecret();
if (!JWT_SECRET) {
  console.error("JWT_SECRET not found (env or backend/.env)");
  process.exit(1);
}

function psql(sql, { tuplesOnly = false } = {}) {
  const args = ["exec", PG.container, "psql", "-U", PG.user, "-d", PG.db];
  if (tuplesOnly) args.push("-t", "-A");
  args.push("-c", sql);
  return execFileSync("docker", args, { encoding: "utf8" });
}
const esc = (s) => String(s).replace(/'/g, "''");

async function api(path, { method = "GET", body, token, form } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + path, {
    method,
    headers,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }
  return { data, headers: res.headers };
}

function ensureUser(member) {
  let id = psql(`select id from "User" where email='${esc(member.email)}'`, {
    tuplesOnly: true,
  }).trim();
  if (!id) {
    id = newId("u");
    psql(
      `insert into "User" (id,email,"displayName","emailVerifiedAt","createdAt") ` +
        `values ('${id}','${esc(member.email)}','${esc(member.name)}', now(), now())`,
    );
  }
  const accessToken = jwt.sign({ sub: id }, JWT_SECRET, {
    audience: "janosik-user",
    expiresIn: "2h",
    algorithm: "HS256",
  });
  return {
    accessToken,
    user: { id, email: member.email, displayName: member.name },
  };
}

function ensureMembership(userId) {
  psql(
    `insert into "BoardMember" (id,"boardId","userId",role,"acceptedAt","createdAt") ` +
      `values ('${newId("bm")}','${BOARD}','${userId}','MEMBER'::"Role", now(), now()) ` +
      `on conflict ("boardId","userId") do update set "acceptedAt"=now(), role='MEMBER'::"Role"`,
  );
}

async function snapshot(token) {
  const { data, headers } = await api(`/boards/${BOARD}`, { token });
  return { board: data, seq: Number(headers.get("x-board-seq") ?? 0) };
}

async function withRetry(fn, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (e.status && e.status < 500) throw e;
      await sleep(250 * (i + 1));
    }
  }
  throw lastErr;
}

function send(auth, action) {
  const body = {
    commandId: newId("cmd"),
    action: { boardId: BOARD, at: Date.now(), ...action },
  };
  return withRetry(
    async () =>
      (
        await api(`/boards/${BOARD}/commands`, {
          method: "POST",
          token: auth.accessToken,
          body,
        })
      ).data,
  );
}

async function ensureColumns(auth) {
  const { board } = await snapshot(auth.accessToken);
  const byTitle = new Map(board.columns.map((c) => [c.title, c.id]));
  const ids = {};
  for (const title of COLS) {
    if (byTitle.has(title)) {
      ids[title] = byTitle.get(title);
      continue;
    }
    const newColumnId = newId("col");
    await send(auth, { type: "ADD_COLUMN", newColumnId, title });
    ids[title] = newColumnId;
    log("setup", `колонка «${title}»`);
    await sleep(200);
  }
  return ids;
}

async function ensureLabels(auth) {
  const { board } = await snapshot(auth.accessToken);
  const byName = new Map(board.labels.map((l) => [l.name, l.id]));
  for (const label of LABELS) {
    if (byName.has(label.name)) continue;
    const id = newId("lbl");
    await send(auth, { type: "ADD_LABEL", label: { id, ...label } });
    byName.set(label.name, id);
    await sleep(150);
  }
  return byName;
}

async function openPresence(auth) {
  const clientId = newId("tab");
  const { seq } = await snapshot(auth.accessToken);
  const ctrl = new AbortController();
  const res = await fetch(
    `${API}/boards/${BOARD}/events?since=${seq}&client=${clientId}`,
    {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      signal: ctrl.signal,
    },
  );
  const reader = res.body.getReader();
  (async () => {
    try {
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch {
      /* aborted */
    }
  })();
  const ping = setInterval(() => {
    api(`/boards/${BOARD}/presence`, {
      method: "POST",
      token: auth.accessToken,
      body: { clientId },
    }).catch(() => {});
  }, 15_000);
  return () => {
    clearInterval(ping);
    ctrl.abort();
  };
}

// --- minimal PNG encoder (no deps) ---------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++)
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function pngBytes(w, h, seed) {
  const raw = Buffer.alloc(h * (1 + w * 3));
  const r = seed % 256;
  const g = (seed * 7) % 256;
  const b = (seed * 13) % 256;
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (1 + w * 3) + 1 + x * 3;
      raw[o] = (r + x * 2) % 256;
      raw[o + 1] = (g + y * 3) % 256;
      raw[o + 2] = (b + ((x + y) >> 1)) % 256;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function uploadScreenshot(auth, cardId, seed) {
  return withRetry(async () => {
    const fd = new FormData();
    fd.append(
      "file",
      new Blob([pngBytes(480, 270, seed)], { type: "image/png" }),
      `shot-${seed}.png`,
    );
    return (
      await api(`/cards/${cardId}/attachments`, {
        method: "POST",
        token: auth.accessToken,
        form: fd,
      })
    ).data;
  });
}
function comment(auth, cardId, text) {
  return withRetry(() =>
    api(`/cards/${cardId}/comments`, {
      method: "POST",
      token: auth.accessToken,
      body: { text },
    }),
  );
}
function move(auth, columns, cardId, fromTitle, toTitle) {
  return send(auth, {
    type: "MOVE_CARD",
    cardId,
    fromColumnId: columns[fromTitle],
    fromIndex: 0,
    toColumnId: columns[toTitle],
    toIndex: 0,
  });
}

async function purge(auth) {
  if (PURGE === "none") return;
  const { board } = await snapshot(auth.accessToken);
  const cards = Object.values(board.cards).filter(
    (c) =>
      !c.archivedAt &&
      (PURGE === "all" || /^(OPS|JAN|TASK)-\d+:/.test(c.title)),
  );
  for (const card of cards) {
    try {
      await send(auth, { type: "DELETE_CARD", cardId: card.id });
    } catch {
      /* ignore */
    }
  }
  if (cards.length)
    log("setup", `убрал карточек: ${cards.length} (PURGE=${PURGE})`);
}

/** Seed `count` cards in the backlog, each assigned to its agent. */
async function seed(auth, columns, labels, agents) {
  const count = agents.length;
  log("Планировщик", `создаю ${count} задач разом`);
  const t0 = Date.now();
  const seeds = Array.from({ length: count }, (_, i) => {
    const agent = agents[i];
    const summary = TASKS[i % TASKS.length];
    return {
      i,
      agent,
      summary,
      cardId: newId("card"),
      code: `TASK-${String(i + 1).padStart(3, "0")}`,
    };
  });
  // One card per command, all fired together — the board serializes them.
  await Promise.all(
    seeds.map(async ({ i, agent, summary, cardId, code }) => {
      await send(auth, {
        type: "ADD_CARD",
        newCardId: cardId,
        columnId: columns["Новые"],
        title: `${code}: ${summary}`,
        description: `Исполнитель — ${agent.name}.`,
      });
      const labelNames = [TASKS.indexOf(summary) % 2 === 0 ? "feature" : "bug"];
      if (i % 3 === 0) labelNames.push("ui");
      if (i % 4 === 0) labelNames.push("backend");
      await Promise.all(
        labelNames.map((name) =>
          labels.get(name)
            ? send(auth, {
                type: "SET_CARD_LABEL",
                cardId,
                labelId: labels.get(name),
                on: true,
              })
            : null,
        ),
      );
      await send(auth, {
        type: "SET_CARD_PRIORITY",
        cardId,
        priority: i % 5 === 0 ? "high" : i % 7 === 0 ? "highest" : "medium",
      });
      await send(auth, {
        type: "SET_CARD_DUE_DATE",
        cardId,
        dueDate: Date.now() + (2 + (i % 7)) * 86_400_000,
      });
      await send(auth, {
        type: "SET_CARD_ASSIGN",
        cardId,
        assigneeId: agent.auth.user.id,
      });
    }),
  );
  log("Планировщик", `${count} задач создано за ${Date.now() - t0}ms`);
  return seeds;
}

async function runCard(agent, columns, seedItem) {
  const { cardId, summary } = seedItem;
  const auth = agent.auth;
  await comment(auth, cardId, `Взял в работу: ${agent.name}.`);
  await move(auth, columns, cardId, "Новые", "В работе");
  log(agent.name, `«${summary}» → В работе`);
  await sleep(jitter(400, 900));

  const checklistId = newId("chk");
  const itemIds = [newId("it"), newId("it"), newId("it")];
  await send(auth, {
    type: "ADD_CHECKLIST",
    cardId,
    newChecklistId: checklistId,
    title: "Подзадачи",
  });
  const steps = ["Разобраться", "Сделать", "Проверить"];
  await Promise.all(
    steps.map((text, k) =>
      send(auth, {
        type: "ADD_CHECKLIST_ITEM",
        cardId,
        checklistId,
        newItemId: itemIds[k],
        text,
      }),
    ),
  );
  await send(auth, {
    type: "SET_CHECKLIST_ITEM_DONE",
    cardId,
    checklistId,
    itemId: itemIds[0],
    done: true,
  });
  await uploadScreenshot(auth, cardId, seedItem.i + 1);
  await comment(auth, cardId, "Скриншот проблемы приложил.");
  log(agent.name, `материалы на «${summary}»`);
  await sleep(jitter(1000, 2000));

  await send(auth, {
    type: "SET_CHECKLIST_ITEM_DONE",
    cardId,
    checklistId,
    itemId: itemIds[1],
    done: true,
  });
  await move(auth, columns, cardId, "В работе", "На ревью");
  log(agent.name, `«${summary}» → На ревью`);
  await sleep(jitter(1000, 1800));

  if (Math.random() < 0.45) {
    await comment(auth, cardId, "Ревью: нужны правки, вернул в работу.");
    await move(auth, columns, cardId, "На ревью", "В работе");
    log(agent.name, `«${summary}» ← доработка`);
    await sleep(jitter(1000, 1800));
    await send(auth, {
      type: "SET_CHECKLIST_ITEM_DONE",
      cardId,
      checklistId,
      itemId: itemIds[2],
      done: true,
    });
    await move(auth, columns, cardId, "В работе", "На ревью");
    log(agent.name, `«${summary}» → На ревью (повторно)`);
    await sleep(jitter(800, 1500));
  }

  await move(auth, columns, cardId, "На ревью", "Тестирование");
  log(agent.name, `«${summary}» → Тестирование`);
  await sleep(jitter(700, 1400));

  await move(auth, columns, cardId, "Тестирование", "Готово");
  await comment(auth, cardId, "Тесты прошли, закрываю.");
  log(agent.name, `«${summary}» → Готово`);
}

async function main() {
  console.log(
    `\n=== Демо: ${AGENTS} задач разом → ${AGENTS} потоков стартуют одновременно (доска ${BOARD}) ===\n`,
  );

  const seeder = ensureUser(SEEDER);
  ensureMembership(seeder.user.id);
  const agents = AGENTS_LIST.map((a) => ({ ...a, auth: ensureUser(a) }));
  for (const a of agents) ensureMembership(a.auth.user.id);
  log("setup", `участников готово: планировщик + ${agents.length}`);

  await purge(seeder);
  const columns = await ensureColumns(seeder);
  const labels = await ensureLabels(seeder);
  const seeds = await seed(seeder, columns, labels, agents);
  console.log("");

  const teardowns = await Promise.all([
    openPresence(seeder),
    ...agents.map((a) => openPresence(a.auth)),
  ]);
  await sleep(300);

  console.log(
    `>>> ${agents.length} задач в бэклоге. ${agents.length} потоков стартуют одновременно >>>`,
  );
  for (let s = LEAD_S; s > 0; s -= 5) {
    await sleep(5000);
    if (s - 5 > 0) console.log(`    ...старт через ${s - 5} сек`);
  }

  const t0 = Date.now();
  await Promise.all(
    agents.map((agent) =>
      runCard(agent, columns, seeds[agent.index]).catch((e) =>
        log(agent.name, `ошибка: ${e.message}`),
      ),
    ),
  );
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  await sleep(1200);
  teardowns.forEach((fn) => fn());
  await sleep(400);

  const { board } = await snapshot(seeder.accessToken);
  console.log(`\n--- все потоки завершили за ${secs}с ---`);
  for (const col of board.columns)
    console.log(`  ${col.title.padEnd(12)} ${col.cardIds.length}`);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
