#!/usr/bin/env node
// demo-board-swarm — showcase the command-log API under a burst of editors.
//
// A "dispatcher" creates a backlog on a board and hands each card to one of N
// worker streams; every worker then drives its cards across the flow
// (Новые → В работе → На ревью → [rework] → Тестирование → Готово), adding
// comments, checklists and screenshot attachments along the way. About 45% of
// the cards bounce back from review before finishing.
//
// Everything the streams *do* travels over HTTP:
//   * commands   POST /boards/:id/commands        (ADD_COLUMN/CARD, MOVE_CARD, …)
//   * comments   POST /cards/:id/comments
//   * files      POST /cards/:id/attachments
//   * presence   GET  /boards/:id/events (SSE) + POST /boards/:id/presence
//
// Provisioning of the demo *participants* is the only shortcut: `/auth/register`
// and `/auth/login` are throttled to 5/min per IP, far too slow for N streams,
// so the script creates the demo users and mints access tokens directly (the
// user JWT carries only `sub`; the strategy loads the user by id). It only ever
// touches users with the `@janosik.demo` emails below.
//
// Requires a running backend + Postgres reachable via `docker exec`. Point it
// at a board you own:
//
//   BOARD=<boardId> node scripts/demo-board-swarm.mjs
//
// Env: API (http://localhost:3000/api/v1), BOARD (required), WORKERS (10),
//      TASKS_PER_WORKER (5), SLOW (1), LEAD (0), PURGE (demo|all|none),
//      PG_CONTAINER (janosik-postgres), PG_USER (janosik), PG_DB (janosik),
//      JWT_SECRET (read from backend/.env when unset).

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
const WORKERS_COUNT = Number(process.env.WORKERS ?? 10);
const TASKS_PER_WORKER = Number(process.env.TASKS_PER_WORKER ?? 5);
const PURGE = process.env.PURGE ?? "demo";
const PG = {
  container: process.env.PG_CONTAINER ?? "janosik-postgres",
  user: process.env.PG_USER ?? "janosik",
  db: process.env.PG_DB ?? "janosik",
};

if (!BOARD) {
  console.error(
    "BOARD is required, e.g. BOARD=<boardId> node scripts/demo-board-swarm.mjs",
  );
  process.exit(1);
}

const DISPATCHER = { name: "Диспетчер", email: "dispatcher@janosik.demo" };
const WORKER_POOL = [
  ["Аня", "anna@janosik.demo"],
  ["Борис", "boris@janosik.demo"],
  ["Вера", "vera@janosik.demo"],
  ["Гриша", "grisha@janosik.demo"],
  ["Даша", "dasha@janosik.demo"],
  ["Егор", "egor@janosik.demo"],
  ["Женя", "zhenya@janosik.demo"],
  ["Зина", "zina@janosik.demo"],
  ["Игорь", "igor@janosik.demo"],
  ["Клава", "klava@janosik.demo"],
];
const WORKERS = Array.from({ length: WORKERS_COUNT }, (_, i) => {
  const [name, email] = WORKER_POOL[i] ?? [
    `Поток ${i + 1}`,
    `worker${i + 1}@janosik.demo`,
  ];
  return { name, email };
});

const COLS = ["Новые", "В работе", "На ревью", "Тестирование", "Готово"];
const LABELS = [
  { name: "bug", color: "red" },
  { name: "feature", color: "green" },
  { name: "ui", color: "brand" },
  { name: "backend", color: "blue" },
  { name: "urgent", color: "orange" },
];
const SUMMARIES = [
  "Починить верстку карточки на мобиле",
  "Добавить фильтр по меткам",
  "Ускорить запрос доски",
  "Поправить экспорт в JSON",
  "Онбординг для новых участников",
  "Ретраи для SSE-стрима",
  "Тултип на кнопке undo",
  "Сортировка по сроку",
  "Тёмная тема для диалогов",
  "Логирование команд",
  "Skeleton при загрузке доски",
  "Валидация дублей меток",
  "Горячие клавиши DnD",
  "Автосейв описания",
  "Pagination в истории",
  "Иконки приоритетов",
  "Мобильный DnD-сенсор",
  "Кэш аватарок",
  "Дублирование колонки",
  "Копирование ссылки на карточку",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms * SLOW));
const jitter = (a, b) => a + Math.random() * (b - a);
const newId = (p) => `${p}${randomBytes(8).toString("hex")}`;
const ts = () => new Date().toISOString().slice(11, 19);
const log = (who, msg) => console.log(`${ts()}  ${who.padEnd(10)} │ ${msg}`);

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
  const id = newId("bm");
  psql(
    `insert into "BoardMember" (id,"boardId","userId",role,"acceptedAt","createdAt") ` +
      `values ('${id}','${BOARD}','${userId}','MEMBER'::"Role", now(), now()) ` +
      `on conflict ("boardId","userId") do update set "acceptedAt"=now(), role='MEMBER'::"Role"`,
  );
}

async function snapshot(token) {
  const { data, headers } = await api(`/boards/${BOARD}`, { token });
  return { board: data, seq: Number(headers.get("x-board-seq") ?? 0) };
}

// Board writes are serialized *server-side* per board (BoardWriteService,
// TASK-56), so the demo fires every call concurrently — many agents act on
// the board at once. A transient 5xx is still retried with the same
// idempotent commandId.
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
  // One commandId per logical command so a retried command is idempotent.
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

// Minimal PNG encoder (no deps) so each card gets a distinct "screenshot".
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
      `screenshot-${seed}.png`,
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

const queues = new Map();
let dispatcherDone = false;

async function processCard(auth, worker, columns, item) {
  const cid = item.cardId;
  const title = item.summary;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  await move(auth, columns, cid, "Новые", "В работе");
  log(worker.name, `«${title}» → В работе`);
  await comment(auth, cid, `Взял в работу: ${worker.name}.`);
  await sleep(jitter(600, 1200));

  const checklistId = newId("chk");
  const itemIds = [newId("it"), newId("it"), newId("it")];
  await send(auth, {
    type: "ADD_CHECKLIST",
    cardId: cid,
    newChecklistId: checklistId,
    title: "Подзадачи",
  });
  const steps = ["Разобраться в задаче", "Сделать", "Проверить"];
  for (let i = 0; i < 3; i++) {
    await send(auth, {
      type: "ADD_CHECKLIST_ITEM",
      cardId: cid,
      checklistId,
      newItemId: itemIds[i],
      text: steps[i],
    });
  }
  log(worker.name, `чек-лист из 3 пунктов на «${title}»`);
  await sleep(jitter(500, 1000));

  await send(auth, {
    type: "SET_CHECKLIST_ITEM_DONE",
    cardId: cid,
    checklistId,
    itemId: itemIds[0],
    done: true,
  });
  await uploadScreenshot(auth, cid, item.seed);
  await comment(auth, cid, "Прикрепил скриншот того, где воспроизводится.");
  log(worker.name, `скриншот + комментарий на «${title}»`);
  await sleep(jitter(1200, 2200));

  await send(auth, {
    type: "SET_CHECKLIST_ITEM_DONE",
    cardId: cid,
    checklistId,
    itemId: itemIds[1],
    done: true,
  });
  await send(auth, {
    type: "UPDATE_CARD",
    cardId: cid,
    description: `В работе у ${worker.name}. Сделан первый подход, детали в комментариях.`,
  });

  await move(auth, columns, cid, "В работе", "На ревью");
  log(worker.name, `«${title}» → На ревью`);
  await comment(
    auth,
    cid,
    pick(["Отправил на ревью.", "Прошу ревью.", "Готово к проверке."]),
  );
  await sleep(jitter(1200, 2200));

  const rework = Math.random() < 0.45;
  if (rework) {
    await comment(auth, cid, "Ревью: нужны правки, вернул в работу.");
    await move(auth, columns, cid, "На ревью", "В работе");
    log(worker.name, `«${title}» ← вернул в В работе`);
    await sleep(jitter(1200, 2000));
    await comment(auth, cid, "Правки внесены, повторно отправляю на ревью.");
    await send(auth, {
      type: "SET_CHECKLIST_ITEM_DONE",
      cardId: cid,
      checklistId,
      itemId: itemIds[2],
      done: true,
    });
    await move(auth, columns, cid, "В работе", "На ревью");
    log(worker.name, `«${title}» → На ревью (повторно)`);
    await sleep(jitter(1000, 1800));
  }

  await move(auth, columns, cid, "На ревью", "Тестирование");
  log(worker.name, `«${title}» → Тестирование`);
  await comment(auth, cid, "Ушло на тестирование, собираю на стенде.");
  await sleep(jitter(800, 1600));

  await move(auth, columns, cid, "Тестирование", "Готово");
  await comment(auth, cid, "Тестирование пройдено, закрываю задачу.");
  log(worker.name, `«${title}» → Готово${rework ? " (после правок)" : ""}`);
  await sleep(jitter(500, 1000));
}

async function workerLoop(auth, worker, columns, expected) {
  log(worker.name, "на доске (presence), жду задачи");
  const q = queues.get(worker.name);
  let done = 0;
  const deadline = Date.now() + 300_000;
  while (done < expected && Date.now() < deadline) {
    if (q.length === 0) {
      if (dispatcherDone) break;
      await sleep(300);
      continue;
    }
    const item = q.shift();
    try {
      await processCard(auth, worker, columns, item);
      done += 1;
    } catch (e) {
      log(worker.name, `ошибка на «${item.summary}»: ${e.message}`);
    }
  }
  log(worker.name, `завершил(а) смену: ${done}/${expected}`);
}

async function purge(auth) {
  if (PURGE === "none") return;
  const { board } = await snapshot(auth.accessToken);
  const cards = Object.values(board.cards).filter(
    (c) =>
      !c.archivedAt && (PURGE === "all" || /^(OPS|JAN)-\d+:/.test(c.title)),
  );
  for (const card of cards) {
    try {
      await send(auth, { type: "DELETE_CARD", cardId: card.id });
    } catch {
      /* ignore */
    }
  }
  if (cards.length) {
    log("Диспетчер", `убрал карточек: ${cards.length} (PURGE=${PURGE})`);
    await sleep(400);
  }
}

async function dispatcher(auth, columns, labels, workers) {
  log("Диспетчер", "создаю и распределяю задачи");
  await purge(auth);
  const total = TASKS_PER_WORKER * workers.length;
  for (let i = 0; i < total; i++) {
    const worker = workers[i % workers.length];
    const code = `OPS-${String(i + 1).padStart(2, "0")}`;
    const summary = SUMMARIES[i % SUMMARIES.length];
    try {
      const cardId = newId("card");
      await send(auth, {
        type: "ADD_CARD",
        newCardId: cardId,
        columnId: columns["Новые"],
        title: `${code}: ${summary}`,
        description: `Задача от диспетчера. Исполнитель — ${worker.member.name}.`,
      });
      const labelNames = [
        SUMMARIES.indexOf(summary) % 2 === 0 ? "feature" : "bug",
      ];
      if (i % 3 === 0) labelNames.push("ui");
      if (i % 4 === 0) labelNames.push("backend");
      for (const name of labelNames) {
        const labelId = labels.get(name);
        if (labelId)
          await send(auth, {
            type: "SET_CARD_LABEL",
            cardId,
            labelId,
            on: true,
          });
      }
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
        assigneeId: worker.userId,
      });
      await comment(auth, cardId, `Назначено на ${worker.member.name}.`);
      queues
        .get(worker.member.name)
        ?.push({ cardId, summary, seed: 1 + ((i * 7) % 200) });
      log("Диспетчер", `«${summary}» → ${worker.member.name} (${code})`);
    } catch (e) {
      log("Диспетчер", `ошибка на ${code}: ${e.message}`);
    }
    await sleep(jitter(250, 600));
  }
  log("Диспетчер", `все ${total} задач распределены`);
}

async function main() {
  console.log(
    `\n=== Демо: диспетчер + ${WORKERS.length} потоков на доске ${BOARD} ===\n`,
  );
  const members = [DISPATCHER, ...WORKERS];
  const auths = new Map();
  for (const member of members) {
    const auth = ensureUser(member);
    ensureMembership(auth.user.id);
    auths.set(member.email, auth);
  }
  const workers = WORKERS.map((m) => ({
    member: m,
    auth: auths.get(m.email),
    userId: auths.get(m.email).user.id,
  }));
  workers.forEach((w) => queues.set(w.member.name, []));
  log("setup", `участников готово: диспетчер + ${workers.length}`);

  const dispAuth = auths.get(DISPATCHER.email);
  const columns = await ensureColumns(dispAuth);
  const labels = await ensureLabels(dispAuth);
  console.log("");

  const teardowns = await Promise.all(
    members.map((m) => openPresence(auths.get(m.email))),
  );
  await sleep(500);

  console.log(">>> ГОТОВ. Открой доску. Старт через " + LEAD_S + " сек >>>");
  for (let s = LEAD_S; s > 0; s -= 5) {
    await sleep(5000);
    if (s - 5 > 0) console.log(`    ...старт через ${s - 5} сек`);
  }
  console.log("\n--- РАБОТА НАЧАЛАСЬ ---");

  const disp = dispatcher(dispAuth, columns, labels, workers)
    .catch((e) => log("Диспетчер", `ошибка: ${e.message}`))
    .finally(() => {
      dispatcherDone = true;
    });
  const pool = workers.map((w) =>
    workerLoop(w.auth, w.member, columns, TASKS_PER_WORKER).catch((e) =>
      log(w.member.name, `ошибка: ${e.message}`),
    ),
  );
  await Promise.all([disp, ...pool]);

  await sleep(1500);
  teardowns.forEach((fn) => fn());
  await sleep(500);

  const { board } = await snapshot(dispAuth.accessToken);
  console.log("\n--- итог по колонкам ---");
  for (const col of board.columns)
    console.log(`  ${col.title.padEnd(11)} ${col.cardIds.length}`);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
