import fs from "node:fs";
import path from "node:path";

const flags = [
  "--demo-reset-env-file",
  "--demo-reset-nonce",
  "--demo-reset-port",
];
const keys = [
  "DATABASE_URL",
  "NODE_ENV",
  "PORT",
  "JWT_SECRET",
  "SETTINGS_SECRET",
  "PUBLIC_ORIGIN",
  "COOKIE_SECURE",
  "UPLOAD_DIR",
];

export function consumeDemoResetEnv(
  argv: readonly string[],
  inherited: Readonly<NodeJS.ProcessEnv>,
): NodeJS.ProcessEnv | undefined {
  const resetArgs = argv.filter((arg) => arg.startsWith("--demo-reset"));
  if (resetArgs.length === 0) return undefined;

  const fail = () =>
    new Error("Invalid or already consumed TASK-176 reset environment.");
  if (inherited.NODE_ENV === "production") {
    throw new Error("TASK-176 reset boot refuses NODE_ENV=production.");
  }
  if (resetArgs.length !== 4 || !resetArgs.includes("--demo-reset"))
    throw fail();
  const [file, nonce, port] = flags.map((flag) =>
    resetArgs.find((arg) => arg.startsWith(`${flag}=`))?.slice(flag.length + 1),
  );
  if (
    !nonce ||
    !/^[a-f0-9]{64}$/.test(nonce) ||
    !port ||
    !file ||
    !path.isAbsolute(file) ||
    path.basename(file) !== `env-${nonce}.json`
  ) {
    throw fail();
  }

  try {
    const uid = process.getuid?.();
    const dir = fs.lstatSync(path.dirname(file));
    if (!dir.isDirectory() || dir.uid !== uid || (dir.mode & 0o777) !== 0o700)
      throw fail();
    const fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
    try {
      const stat = fs.fstatSync(fd);
      if (
        !stat.isFile() ||
        stat.uid !== uid ||
        stat.nlink !== 1 ||
        (stat.mode & 0o777) !== 0o600 ||
        stat.size > 16_384
      )
        throw fail();
      const payload = JSON.parse(fs.readFileSync(fd, "utf8"));
      const env = payload.env;
      if (
        payload.nonce !== nonce ||
        !env ||
        Object.keys(env).length !== keys.length ||
        keys.some((key) => typeof env[key] !== "string") ||
        env.DATABASE_URL !== inherited.DATABASE_URL ||
        env.NODE_ENV !== "test" ||
        env.PORT !== port ||
        env.COOKIE_SECURE !== "false" ||
        env.JWT_SECRET.length < 32 ||
        env.UPLOAD_DIR !== path.join(path.dirname(file), "uploads")
      ) {
        throw fail();
      }
      // Unlink must succeed before these values can be used. A second opener
      // with the same nonce cannot consume a file this boot already used.
      fs.unlinkSync(file);
      return env;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    throw fail();
  }
}
