import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

/**
 * TASK-200.12 deployment checks. These are deliberately cheap and hermetic:
 * `docker compose config` renders YAML from a temporary env file built from
 * `.env.example` (never the host's `.env`), and the nginx/Caddy syntax probes
 * run pinned images only when they are already present.
 *
 *   node --test scripts/deploy/scale.test.mjs
 *
 * Prepare the syntax images once:
 *   docker pull nginx:1.27-alpine && docker pull caddy:2-alpine
 */

const root = path.resolve(import.meta.dirname, "..", "..");
const baseFile = path.join(root, "docker-compose.yml");
const scaleFile = path.join(root, "docker-compose.scale.yml");
const baseArgs = ["-f", baseFile];
const scaleArgs = [...baseArgs, "-f", scaleFile];
const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "janosik-deploy-"));
process.on("exit", () => rmSync(tmpRoot, { recursive: true, force: true }));

const docker =
  spawnSync("docker", ["compose", "version"], { encoding: "utf8" }).status ===
  0;
const dockerDaemon =
  spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;

let envCounter = 0;

/**
 * A temporary env file built from the shipped `.env.example`. Only the JWT
 * secret is filled in (the example intentionally leaves it empty), so this is
 * exactly what a fresh self-hoster has before editing secrets.
 */
function stockEnvFile(extra = {}) {
  const lines = readFileSync(path.join(root, ".env.example"), "utf8")
    .split("\n")
    .filter((line) => !/^JWT_SECRET=/.test(line));
  lines.push(`JWT_SECRET=${"0".repeat(63)}f`);
  for (const [key, value] of Object.entries(extra)) {
    lines.push(`${key}=${value}`);
  }
  envCounter += 1;
  const file = path.join(tmpRoot, `env-${envCounter}.env`);
  writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}

function composeConfig(args, extraEnv = {}) {
  const envFile = stockEnvFile(extraEnv);
  const cleanEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    DOCKER_CONFIG: process.env.DOCKER_CONFIG,
    DOCKER_HOST: process.env.DOCKER_HOST,
    TMPDIR: process.env.TMPDIR,
  };
  const out = execFileSync(
    "docker",
    ["compose", "--env-file", envFile, ...args, "config", "--format", "json"],
    {
      cwd: root,
      env: Object.fromEntries(
        Object.entries(cleanEnv).filter(([, value]) => value !== undefined),
      ),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return JSON.parse(out);
}

function publishedPorts(config) {
  return Object.values(config.services).flatMap((service) =>
    (service.ports ?? []).map((port) => `${port.published ?? ""}`),
  );
}

test(
  "stock single-replica compose keeps the direct app port and TRUST_PROXY=0",
  { skip: !docker },
  () => {
    const config = composeConfig(baseArgs, { PORT: "3000" });
    assert.deepEqual(Object.keys(config.services).sort(), [
      "app",
      "postgres",
      "redis",
    ]);
    assert.equal(config.services.app.ports[0].published, "3000");
    assert.equal(config.services.app.ports[0].target, 3000);
    assert.equal(
      config.services.app.environment.REDIS_URL,
      "redis://redis:6379",
    );
    assert.equal(config.services.app.environment.TRUST_PROXY, "0");
    assert.match(
      config.services.app.healthcheck.test.join(" "),
      /api\/v1\/health\/ready/,
    );
  },
);

test(
  "API_REPLICAS does not affect the base single-container stack",
  { skip: !docker },
  () => {
    const config = composeConfig(baseArgs, { API_REPLICAS: "4" });
    assert.equal(Object.keys(config.services).length, 3);
    assert.equal(config.services.app.deploy, undefined);
    assert.equal(config.services.app.ports[0].published, "3000");
  },
);

test(
  "3-replica overlay: proxy is public, app replicates on the internal net",
  { skip: !docker },
  () => {
    const config = composeConfig(scaleArgs, {
      API_REPLICAS: "3",
      PORT: "3000",
    });
    assert.deepEqual(Object.keys(config.services).sort(), [
      "app",
      "migrate",
      "postgres",
      "proxy",
      "redis",
    ]);

    const app = config.services.app;
    assert.equal(app.deploy.replicas, 3);
    assert.equal(
      (app.ports ?? []).length,
      0,
      "app must not publish a host port",
    );
    assert.equal(app.environment.MIGRATE_ON_BOOT, "false");
    assert.equal(app.environment.TRUST_PROXY, "1");
    assert.equal(app.environment.DB_CONNECTION_LIMIT, "10");
    assert.equal(app.environment.REDIS_URL, "redis://redis:6379");
    assert.match(app.environment.NODE_OPTIONS, /max-old-space-size=768/);
    assert.equal(app.ulimits.nofile.soft, 65536);
    assert.equal(app.ulimits.nofile.hard, 65536);
    assert.equal(app.stop_grace_period, "45s");
    assert.match(
      String(app.deploy.resources.limits.memory),
      /1536M|1610612736/,
    );
    assert.match(app.healthcheck.test.join(" "), /api\/v1\/health\/ready/);
    assert.equal(
      app.depends_on.migrate.condition,
      "service_completed_successfully",
    );
    assert.equal(app.depends_on.postgres.condition, "service_healthy");

    const migrate = config.services.migrate;
    assert.equal(migrate.restart, "no");
    assert.equal(migrate.environment.MIGRATE_ONLY, "true");
    assert.match(migrate.environment.DATABASE_URL, /@postgres:5432\/janosik$/);

    const proxy = config.services.proxy;
    assert.equal(proxy.ports[0].published, "3000");
    assert.equal(proxy.ports[0].target, 8080);
    assert.equal(proxy.depends_on.app.condition, "service_healthy");
    assert.match(proxy.healthcheck.test.join(" "), /healthz/);
    assert.equal(proxy.ulimits.nofile.soft, 131072);
    assert.equal(proxy.ulimits.nofile.hard, 131072);
    assert.match(
      String(proxy.deploy.resources.limits.memory),
      /512M|536870912/,
    );

    assert.deepEqual(
      publishedPorts(config).filter((port) => port !== ""),
      ["3000"],
    );
    for (const service of Object.values(config.services)) {
      assert.equal(
        service.container_name,
        undefined,
        "container_name would collide when replicas scale",
      );
    }
  },
);

test("4-replica overlay is a valid production shape", { skip: !docker }, () => {
  const config = composeConfig(scaleArgs, { API_REPLICAS: "4" });
  assert.equal(config.services.app.deploy.replicas, 4);
  assert.equal((config.services.app.ports ?? []).length, 0);
});

test(
  "proxy limits are configurable for the larger profile",
  { skip: !docker },
  () => {
    const config = composeConfig(scaleArgs, {
      API_REPLICAS: "4",
      PROXY_CPUS: "1.0",
      PROXY_MEMORY_LIMIT: "1G",
      PROXY_NOFILE: "131072",
    });
    const proxy = config.services.proxy;
    assert.equal(String(proxy.deploy.resources.limits.cpus), "1");
    assert.match(String(proxy.deploy.resources.limits.memory), /1G|1073741824/);
    assert.equal(proxy.ulimits.nofile.soft, 131072);
  },
);

test(
  "one replica behind the proxy is a valid rollback shape",
  { skip: !docker },
  () => {
    const config = composeConfig(scaleArgs, { API_REPLICAS: "1" });
    assert.equal(config.services.app.deploy.replicas, 1);
    assert.equal((config.services.app.ports ?? []).length, 0);
    assert.equal(config.services.proxy.ports[0].published, "3000");
  },
);

test("nginx main config raises the stream/file-descriptor ceiling", () => {
  const main = readFileSync(
    path.join(root, "deploy", "scale", "nginx-main.conf"),
    "utf8",
  );
  assert.match(main, /worker_processes 4;/);
  assert.match(main, /worker_rlimit_nofile 131072;/);
  assert.match(main, /worker_connections 65536;/);
  assert.match(main, /include \/etc\/nginx\/conf\.d\/\*\.conf;/);
});

test("nginx proxy config: SSE, normal API timeouts, retries, uploads", () => {
  const nginx = readFileSync(
    path.join(root, "deploy", "scale", "nginx.conf"),
    "utf8",
  );
  assert.match(nginx, /upstream janosik_api\s*\{[^}]*zone janosik_api 64k;/s);
  assert.match(nginx, /server app:3000 max_fails=3 fail_timeout=10s;/);
  assert.match(nginx, /keepalive 64;/);
  assert.match(nginx, /gzip on;/);
  assert.match(nginx, /location ~ \^\/api\/v1\//);
  assert.match(nginx, /proxy_buffering off;/);
  assert.match(nginx, /proxy_read_timeout 3600s;/);
  assert.match(nginx, /proxy_send_timeout 3600s;/);
  assert.match(nginx, /proxy_read_timeout 90s;/);
  assert.match(nginx, /proxy_read_timeout 60s;/);
  assert.match(nginx, /client_max_body_size 30m;/);
  assert.match(nginx, /proxy_cache_path .*janosik_static/s);
  assert.match(nginx, /proxy_cache janosik_static;/);
  assert.match(nginx, /location = \/healthz/);
  assert.match(nginx, /proxy_next_upstream_tries 0;/);
  assert.doesNotMatch(nginx, /proxy_next_upstream_tries 2;/);
  assert.match(nginx, /users\/\(\?:me\|\[\^\/\]\+\)\/avatar/);
  assert.match(nginx, /boards\/import/);
  assert.match(
    nginx,
    /attachments\/\[\^\/\]\+\/\(\?:content\|thumbnail\|poster\)/,
  );
  assert.match(nginx, /proxy_pass http:\/\/janosik_api;/);
  assert.doesNotMatch(nginx, /ip_hash|sticky\s+on/);
});

test("Caddy proxy config: SSE handle, retries, health and normal timeout", () => {
  const caddy = readFileSync(
    path.join(root, "deploy", "scale", "Caddyfile"),
    "utf8",
  );
  assert.match(caddy, /@sse path \/api\/v1\/boards\/\*\/events\* /);
  assert.match(caddy, /lb_policy round_robin/);
  assert.match(caddy, /lb_try_duration 10s/);
  assert.match(caddy, /fail_duration 30s/);
  assert.match(caddy, /max_fails 3/);
  assert.match(caddy, /flush_interval -1/);
  assert.match(caddy, /read_timeout 3600s/);
  assert.match(caddy, /read_timeout 90s/);
  assert.match(caddy, /handle \/healthz/);
  assert.match(caddy, /rewrite \* \/api\/v1\/health\/ready/);
  assert.match(caddy, /encode @static gzip/);
});

test(
  "the overlay has no duplicate published host ports",
  { skip: !docker },
  () => {
    const config = composeConfig(scaleArgs, { API_REPLICAS: "2" });
    const hostPorts = publishedPorts(config).filter((port) => port !== "");
    assert.equal(new Set(hostPorts).size, hostPorts.length);
  },
);

test("rollout never forces a stale --scale value", () => {
  const rollout = readFileSync(
    path.join(root, "deploy", "scale", "rollout.sh"),
    "utf8",
  );
  assert.doesNotMatch(rollout, /up -d[^\n]*--scale/);
  assert.match(rollout, /API_REPLICAS/);
  assert.match(rollout, /short API gap is possible/);
});

test(
  "rollout rejects a replica count outside the supported range",
  { skip: process.platform === "win32" },
  () => {
    const result = spawnSync(
      "bash",
      [path.join(root, "deploy", "scale", "rollout.sh")],
      {
        cwd: root,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          API_REPLICAS: "5",
        },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /2-4 for production/);
  },
);

test("SSE query strings are preserved by both proxies", () => {
  const nginx = readFileSync(
    path.join(root, "deploy", "scale", "nginx.conf"),
    "utf8",
  );
  // No URI part after the upstream name and no rewrite in the events location.
  assert.match(
    nginx,
    /events\/\?\$ \{[\s\S]*?proxy_pass http:\/\/janosik_api;/,
  );
  assert.doesNotMatch(
    nginx,
    /events\/\?\$ \{[\s\S]*?rewrite\s/,
    "an SSE rewrite would drop ?since=",
  );
  const caddy = readFileSync(
    path.join(root, "deploy", "scale", "Caddyfile"),
    "utf8",
  );
  assert.doesNotMatch(
    caddy.split("handle /healthz")[0],
    /rewrite /,
    "an SSE rewrite would drop ?since=",
  );
});

function fakeEntrypoint(name, mode) {
  const bin = path.join(tmpRoot, `bin-${name}`);
  mkdirSync(bin, { recursive: true });
  const calls = path.join(bin, "calls");
  for (const name of ["npx", "node"]) {
    const file = path.join(bin, name);
    writeFileSync(
      file,
      `#!/bin/sh\nprintf '%s %s\\n' '${name}' "$*" >> "$CALLS"\n`,
    );
    chmodSync(file, 0o755);
  }
  const env = {
    PATH: `${bin}:${process.env.PATH}`,
    HOME: process.env.HOME,
    CALLS: calls,
    DATABASE_URL: "postgresql://janosik:secret@postgres:5432/janosik",
    JWT_SECRET: "0".repeat(63) + "f",
    UPLOAD_DIR: path.join(bin, "uploads"),
    ALLOW_REGISTRATION: "false",
    ...mode,
  };
  const result = spawnSync("sh", [path.join(root, "docker-entrypoint.sh")], {
    env,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return { calls: readFileSync(calls, "utf8"), stdout: result.stdout };
}

test(
  "entrypoint applies migrations on boot, or only as the one-shot job",
  { skip: process.platform === "win32" || process.getuid?.() === 0 },
  () => {
    const normal = fakeEntrypoint("normal", {});
    assert.match(normal.calls, /npx prisma migrate deploy/);
    assert.match(normal.calls, /node dist\/main\.js/);

    const replica = fakeEntrypoint("replica", { MIGRATE_ON_BOOT: "false" });
    assert.doesNotMatch(replica.calls, /npx prisma/);
    assert.match(replica.calls, /node dist\/main\.js/);

    const job = fakeEntrypoint("job", { MIGRATE_ONLY: "true" });
    assert.match(job.calls, /npx prisma migrate deploy/);
    assert.doesNotMatch(job.calls, /node dist\/main\.js/);
    assert.match(job.stdout, /one-shot job/);
  },
);

test(
  "nginx accepts the full pinned main config",
  { skip: !docker || !dockerDaemon },
  () => {
    const image = "nginx:1.27-alpine";
    if (
      spawnSync("docker", ["image", "inspect", image], { encoding: "utf8" })
        .status !== 0
    ) {
      console.log(`skip: ${image} not present (docker pull ${image})`);
      return;
    }
    execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "--add-host",
        "app:127.0.0.1",
        "-v",
        `${path.join(root, "deploy", "scale", "nginx-main.conf")}:/etc/nginx/nginx.conf:ro`,
        "-v",
        `${path.join(root, "deploy", "scale", "nginx.conf")}:/etc/nginx/conf.d/default.conf:ro`,
        image,
        "nginx",
        "-t",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  },
);

test(
  "Caddy accepts the proxy config",
  { skip: !docker || !dockerDaemon },
  () => {
    const image = "caddy:2-alpine";
    if (
      spawnSync("docker", ["image", "inspect", image], { encoding: "utf8" })
        .status !== 0
    ) {
      console.log(`skip: ${image} not present (docker pull ${image})`);
      return;
    }
    execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "--add-host",
        "app:127.0.0.1",
        "-v",
        `${path.join(root, "deploy", "scale", "Caddyfile")}:/etc/caddy/Caddyfile:ro`,
        image,
        "caddy",
        "validate",
        "--config",
        "/etc/caddy/Caddyfile",
        "--adapter",
        "caddyfile",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  },
);
