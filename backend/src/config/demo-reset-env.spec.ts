import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { consumeDemoResetEnv } from "./demo-reset-env";

const nonce = "a".repeat(64);
const inherited = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://localhost/janosik_task176_demo",
};
let dir: string;
let file: string;
let args: string[];

function payload() {
  return {
    nonce,
    env: {
      DATABASE_URL: inherited.DATABASE_URL,
      PORT: "5311",
      NODE_ENV: "test",
      PUBLIC_ORIGIN: "http://127.0.0.1:5311",
      JWT_SECRET: "reset-secret-for-test".repeat(2),
      SETTINGS_SECRET: "",
      COOKIE_SECURE: "false",
      UPLOAD_DIR: path.join(dir, "uploads"),
    },
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "demo-env-test-"));
  file = path.join(dir, `env-${nonce}.json`);
  args = [
    "--demo-reset",
    `--demo-reset-env-file=${file}`,
    `--demo-reset-nonce=${nonce}`,
    "--demo-reset-port=5311",
  ];
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

it("ignores env controls on normal boot", () => {
  expect(
    consumeDemoResetEnv([], {
      ...inherited,
      JANOSIK_DEMO_RESET: "1",
      JANOSIK_DEMO_RESET_ENV_FILE: file,
      JANOSIK_DEMO_RESET_NONCE: nonce,
    }),
  ).toBeUndefined();
});

it("consumes an owned 0600 reset file once", () => {
  fs.writeFileSync(file, JSON.stringify(payload()), { mode: 0o600 });
  expect(consumeDemoResetEnv(args, inherited)).toEqual(payload().env);
  expect(fs.existsSync(file)).toBe(false);
  expect(() => consumeDemoResetEnv(args, inherited)).toThrow(/consumed/);
});

it("fails closed on missing, mismatched, insecure, or production reset env", () => {
  expect(() => consumeDemoResetEnv(args, inherited)).toThrow(/Invalid/);
  fs.writeFileSync(
    file,
    JSON.stringify({ ...payload(), nonce: "b".repeat(64) }),
    { mode: 0o600 },
  );
  expect(() => consumeDemoResetEnv(args, inherited)).toThrow(/Invalid/);
  fs.writeFileSync(file, JSON.stringify(payload()));
  expect(() =>
    consumeDemoResetEnv(args, { ...inherited, NODE_ENV: "production" }),
  ).toThrow(/production/);
  expect(() =>
    consumeDemoResetEnv(args, {
      ...inherited,
      DATABASE_URL: "postgresql://localhost/janosik_dev",
    }),
  ).toThrow(/Invalid/);
  fs.chmodSync(file, 0o644);
  expect(() => consumeDemoResetEnv(args, inherited)).toThrow(/Invalid/);
  expect(fs.existsSync(file)).toBe(true);
});
