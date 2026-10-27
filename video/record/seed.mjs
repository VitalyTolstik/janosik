#!/usr/bin/env node
// seed — put a realistic board on a running Janosik stack so the feature
// clips can be recorded against the real UI.
//
// It talks only to the public API and the master API:
//   * master login           POST /admin/auth/login
//   * users                  GET/POST/PATCH/DELETE /admin/users
//   * login                  POST /auth/login
//   * board                  POST /boards, POST /boards/:id/commands
//   * members                POST /boards/:id/members, POST /invitations/:id/accept
//   * comments               POST /cards/:cardId/comments
//
// The seed is idempotent: any user whose email matches the fixed set is
// hard-deleted first (which also removes their boards), then recreated.
//
// Env:
//   API           base URL, default http://localhost:3210/api/v1
//   ADMIN_EMAIL   default admin@admin.com
//   ADMIN_PASS    default qQ!123456
//   STATE         manifest path, default video/record/.state.json
//
// Run: node video/record/seed.mjs

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const require = createRequire(`${REPO}/`);
const jwt = require("jsonwebtoken");

function jwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const envFile = readFileSync(path.join(REPO, "backend/.env"), "utf8");
  const match = envFile.match(/^JWT_SECRET=(.*)$/m);
  if (!match) throw new Error("JWT_SECRET not found in backend/.env");
  return match[1].trim().replace(/^["']|["']$/g, "");
}

// The user strategy only reads `sub`; minting the token avoids the 5/min
// login throttle while provisioning (same shortcut the swarm script takes).
function mintToken(userId) {
  return jwt.sign({ sub: userId }, jwtSecret(), {
    audience: "janosik-user",
    expiresIn: "2h",
  });
}

const API = process.env.API ?? "http://localhost:3210/api/v1";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@admin.com";
const ADMIN_PASS = process.env.ADMIN_PASS ?? "qQ!123456";
const STATE = process.env.STATE ?? path.join(HERE, ".state.json");

const PEOPLE = [
  { key: "ada", email: "ada@janosik.demo", name: "Ada Bell" },
  { key: "grace", email: "grace@janosik.demo", name: "Grace Fox" },
  { key: "leo", email: "leo@janosik.demo", name: "Leo Marsh" },
  { key: "nina", email: "nina@janosik.demo", name: "Nina Kade" },
  { key: "omar", email: "omar@janosik.demo", name: "Omar Reyes" },
  { key: "priya", email: "priya@janosik.demo", name: "Priya Nair" },
  { key: "sam", email: "sam@janosik.demo", name: "Sam Okafor" },
];
const PASSWORD = "JanosikDemo1!";

const COLUMNS = ["Backlog", "In progress", "Review", "Done"];
const LABELS = [
  { key: "feature", name: "feature", color: "blue" },
  { key: "bug", name: "bug", color: "red" },
  { key: "design", name: "design", color: "fuchsia" },
  { key: "backend", name: "backend", color: "indigo" },
  { key: "urgent", name: "urgent", color: "orange" },
];

// title, column, labels, priority, assignee, checklist, description
const CARDS = [
  {
    title: "Single sign-on for enterprise",
    column: "Backlog",
    labels: ["feature", "backend"],
    priority: "high",
  },
  {
    title: "Bulk import from CSV",
    column: "Backlog",
    labels: ["feature"],
  },
  {
    title: "Keyboard shortcut cheat sheet",
    column: "Backlog",
    labels: ["feature", "design"],
  },
  {
    title: "Dark mode contrast pass",
    column: "Backlog",
    labels: ["design"],
  },
  {
    title: "Mobile drag on touch screens",
    column: "Backlog",
    labels: ["bug"],
    priority: "high",
    due: -2,
  },
  {
    title: "Realtime cursors on the board",
    column: "In progress",
    labels: ["feature"],
    priority: "highest",
    assignee: "grace",
    due: 3,
    checklist: ["Presence avatars", "SSE reconnect", "Cursor colours"],
    description:
      "Show every editor's pointer while they move around the board, with a name label that fades after a few seconds of stillness.",
  },
  {
    title: "Attachment previews",
    column: "In progress",
    labels: ["feature", "design"],
    assignee: "leo",
    due: 5,
  },
  {
    title: "Per-column WIP limits",
    column: "In progress",
    labels: ["feature", "backend"],
    priority: "high",
    assignee: "ada",
    due: 1,
    description:
      "Cap how many cards a column accepts and block further moves once the cap is reached.",
  },
  {
    title: "Public read-only share links",
    column: "Review",
    labels: ["feature"],
    priority: "high",
    assignee: "nina",
    due: 6,
  },
  {
    title: "Comment mentions",
    column: "Review",
    labels: ["feature"],
    due: 8,
  },
  {
    title: "Offline mode",
    column: "Done",
    labels: ["feature"],
    assignee: "grace",
  },
  {
    title: "Board export and import",
    column: "Done",
    labels: ["feature", "backend"],
  },
];

const COMMENTS = {
  "Realtime cursors on the board": [
    "Cursor colour now follows the member avatar colour, so it matches the presence stack.",
    "Reconnect resumes from the last applied sequence, no duplicate frames.",
  ],
};

let adminToken = "";

async function call(method, url, body, token) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${method} ${url} -> ${res.status} ${text}`);
  }
  return data;
}

async function adminLogin() {
  const data = await call("POST", "/admin/auth/login", {
    email: ADMIN_EMAIL,
    password: ADMIN_PASS,
  });
  return data.accessToken;
}

async function deleteSeedUser(email) {
  const page = await call(
    "GET",
    `/admin/users?search=${encodeURIComponent(email)}&limit=100`,
    undefined,
    adminToken,
  );
  const row = page.items.find((u) => u.email === email);
  if (row) {
    await call("DELETE", `/admin/users/${row.id}`, undefined, adminToken);
  }
}

async function createVerifiedUser(person) {
  const created = await call(
    "POST",
    "/admin/users",
    { email: person.email, displayName: person.name, password: PASSWORD },
    adminToken,
  );
  await call(
    "PATCH",
    `/admin/users/${created.user.id}`,
    { emailVerified: true },
    adminToken,
  );
  return { ...person, id: created.user.id, token: mintToken(created.user.id) };
}

// One real login per user to capture the httpOnly refresh cookie the browser
// needs. /auth/login is throttled to 5/min per IP, so a 429 waits it out.
async function loginCookie(person) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const res = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: person.email, password: PASSWORD }),
    });
    if (res.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 15_000));
      continue;
    }
    if (!res.ok) throw new Error(`login ${person.email} -> ${res.status}`);
    const cookie = res.headers
      .getSetCookie()
      .find((c) => c.startsWith("refresh_token="));
    if (!cookie) throw new Error(`no refresh cookie for ${person.email}`);
    return cookie.split(";")[0].split("=").slice(1).join("=");
  }
  throw new Error(`login ${person.email} kept throttling`);
}

function command(action) {
  return { commandId: randomUUID(), action: { at: Date.now(), ...action } };
}

async function main() {
  adminToken = await adminLogin();

  for (const person of PEOPLE) {
    await deleteSeedUser(person.email);
  }
  const users = [];
  for (const person of PEOPLE) {
    users.push(await createVerifiedUser(person));
  }
  const owner = users[0];
  const byKey = Object.fromEntries(users.map((u) => [u.key, u]));

  const board = await call(
    "POST",
    "/boards",
    { title: "Product roadmap" },
    owner.token,
  );
  const boardId = board.id;

  const columnId = {};
  for (const title of COLUMNS) {
    const id = randomUUID();
    columnId[title] = id;
    await call(
      "POST",
      `/boards/${boardId}/commands`,
      command({ type: "ADD_COLUMN", newColumnId: id, title }),
      owner.token,
    );
  }

  const labelId = {};
  for (const label of LABELS) {
    const id = randomUUID();
    labelId[label.key] = id;
    await call(
      "POST",
      `/boards/${boardId}/commands`,
      command({
        type: "ADD_LABEL",
        label: { id, name: label.name, color: label.color },
      }),
      owner.token,
    );
  }

  const cardId = {};
  for (const card of CARDS) {
    const id = randomUUID();
    cardId[card.title] = id;
    await call(
      "POST",
      `/boards/${boardId}/commands`,
      command({
        type: "ADD_CARD",
        newCardId: id,
        columnId: columnId[card.column],
        title: card.title,
      }),
      owner.token,
    );
    if (card.description) {
      await call(
        "POST",
        `/boards/${boardId}/commands`,
        command({
          type: "UPDATE_CARD",
          cardId: id,
          description: card.description,
        }),
        owner.token,
      );
    }
    for (const key of card.labels ?? []) {
      await call(
        "POST",
        `/boards/${boardId}/commands`,
        command({
          type: "SET_CARD_LABEL",
          cardId: id,
          labelId: labelId[key],
          on: true,
        }),
        owner.token,
      );
    }
    if (card.priority) {
      await call(
        "POST",
        `/boards/${boardId}/commands`,
        command({
          type: "SET_CARD_PRIORITY",
          cardId: id,
          priority: card.priority,
        }),
        owner.token,
      );
    }
    if (card.due !== undefined) {
      await call(
        "POST",
        `/boards/${boardId}/commands`,
        command({
          type: "SET_CARD_DUE_DATE",
          cardId: id,
          dueDate: Date.now() + card.due * 86_400_000,
        }),
        owner.token,
      );
    }
    if (card.checklist) {
      const checklistId = randomUUID();
      await call(
        "POST",
        `/boards/${boardId}/commands`,
        command({
          type: "ADD_CHECKLIST",
          cardId: id,
          newChecklistId: checklistId,
          title: "Tasks",
        }),
        owner.token,
      );
      for (const text of card.checklist) {
        await call(
          "POST",
          `/boards/${boardId}/commands`,
          command({
            type: "ADD_CHECKLIST_ITEM",
            cardId: id,
            checklistId,
            newItemId: randomUUID(),
            text,
          }),
          owner.token,
        );
      }
    }
  }

  for (const person of users.slice(1)) {
    await call(
      "POST",
      `/boards/${boardId}/members`,
      { email: person.email, role: "MEMBER" },
      owner.token,
    );
    const invitations = await call(
      "GET",
      "/invitations",
      undefined,
      person.token,
    );
    const invitation = invitations.find((i) => i.boardId === boardId);
    if (invitation) {
      await call(
        "POST",
        `/invitations/${invitation.id}/accept`,
        undefined,
        person.token,
      );
    }
  }

  for (const card of CARDS) {
    if (!card.assignee) continue;
    await call(
      "POST",
      `/boards/${boardId}/commands`,
      command({
        type: "SET_CARD_ASSIGN",
        cardId: cardId[card.title],
        assigneeId: byKey[card.assignee].id,
      }),
      owner.token,
    );
  }

  for (const [title, texts] of Object.entries(COMMENTS)) {
    for (const text of texts) {
      await call(
        "POST",
        `/cards/${cardId[title]}/comments`,
        { text, commandId: randomUUID() },
        owner.token,
      );
    }
  }

  const cookies = {};
  for (const person of users) {
    cookies[person.key] = await loginCookie(person);
  }

  const state = {
    api: API,
    boardId,
    boardTitle: board.title,
    columnId,
    labelId,
    cardId,
    users: users.map(({ key, email, name, id, token }) => ({
      key,
      email,
      name,
      id,
      token,
      cookie: cookies[key],
    })),
  };
  mkdirSync(path.dirname(STATE), { recursive: true });
  writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`);
  console.log(`seeded board ${boardId} with ${CARDS.length} cards`);
  console.log(`manifest: ${STATE}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
