import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * TASK-200.12 deployment checks. These are deliberately cheap: `docker
 * compose config` renders YAML without starting anything, and the nginx/Caddy
 * syntax probes run only when their small base images are already present.
 *
 *   node --test scripts/deploy/scale.test.mjs
 *
 * Prepare the syntax images once with:
 *   docker pull nginx:alpine && docker pull caddy:2-alpine
 */

const root = path.resolve(import.meta.dirname, "..", "..");
const baseFile = path.join(root, "docker-compose.yml");
const scaleFile = path.join(root, "docker-compose.scale.yml");
const baseArgs = ["compose", "-f", baseFile];
const scaleArgs = [...baseArgs, "-f", scaleFile];
const baseEnv = {
  POSTGRES_USER: "janosik",
  POSTGRES_PASSWORD: "test-password",
  POSTGRES_DB: "janosik",
  JWT_SECRET: "0".repeat(63) + "f",
  PUBLIC_ORIGIN: "https://janosik.example.test",
  COOKIE_SECURE: "true",
};

const docker =
  spawnSync("docker", ["compose", "version"], { encoding: "utf8" }).status ===
  0;
const dockerDaemon =
  spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;

function composeConfig(args, extraEnv = {}) {
  const out = execFileSync("docker", [...args, "config", "--format", "json"], {
    cwd: root,
    env: { ...process.env, ...baseEnv, ...extraEnv },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out);
}

function publishedPorts(config) {
  return Object.values(config.services).flatMap((service) =>
    (service.ports ?? []).map((port) => `${port.published ?? ""}`),
  );
}

test(
  "single-replica base compose keeps the direct app port",
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
    assert.match(
      config.services.app.healthcheck.test.join(" "),
      /api\/v1\/health\/ready/,
    );
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
    assert.ok(app.deploy.resources.limits.cpus);
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
    assert.equal(migrate.depends_on.postgres.condition, "service_healthy");

    const proxy = config.services.proxy;
    assert.equal(proxy.ports[0].published, "3000");
    assert.equal(proxy.ports[0].target, 8080);
    assert.equal(proxy.depends_on.app.condition, "service_healthy");
    assert.match(proxy.healthcheck.test.join(" "), /healthz/);

    // One host port for one proxy; no service may silently double-bind.
    const published = publishedPorts(config).filter((port) => port !== "");
    assert.deepEqual(published, ["3000"]);
    for (const service of Object.values(config.services)) {
      assert.equal(
        service.container_name,
        undefined,
        "container_name would collide when replicas scale",
      );
    }
  },
);

test(
  "one replica behind the proxy is a valid rollback shape",
  { skip: !docker },
  () => {
    const config = composeConfig(scaleArgs, {
      API_REPLICAS: "1",
      PORT: "3000",
    });
    assert.equal(config.services.app.deploy.replicas, 1);
    assert.equal((config.services.app.ports ?? []).length, 0);
    assert.equal(config.services.proxy.ports[0].published, "3000");
  },
);

test("nginx proxy config: gzip, SSE, timeouts, upstream, retries", () => {
  const nginx = readFileSync(
    path.join(root, "deploy", "scale", "nginx.conf"),
    "utf8",
  );
  assert.match(nginx, /upstream janosik_api\s*\{[^}]*server app:3000/s);
  assert.match(nginx, /gzip on;/);
  assert.match(nginx, /proxy_buffering off;/);
  assert.match(nginx, /proxy_read_timeout 3600s;/);
  assert.match(nginx, /proxy_send_timeout 3600s;/);
  assert.match(nginx, /client_max_body_size 30m;/);
  assert.match(nginx, /proxy_cache_path .*janosik_static/s);
  assert.match(nginx, /proxy_cache janosik_static;/);
  assert.match(nginx, /location ~ \^\/\(\?:_astro\|app\/assets\)\//);
  assert.match(nginx, /location = \/healthz/);
  assert.match(nginx, /location \/api\//);
  assert.match(nginx, /proxy_next_upstream error timeout http_502 http_503;/);
  assert.doesNotMatch(nginx, /ip_hash|sticky\s+on/);
});

test("Caddy proxy config: gzip, SSE flush, timeouts, upstream", () => {
  const caddy = readFileSync(
    path.join(root, "deploy", "scale", "Caddyfile"),
    "utf8",
  );
  assert.match(caddy, /reverse_proxy app:3000\s*\{/);
  assert.match(caddy, /lb_policy round_robin/);
  assert.match(caddy, /flush_interval -1/);
  assert.match(caddy, /read_timeout 3600s/);
  assert.match(caddy, /write_timeout 3600s/);
  assert.match(caddy, /encode @static gzip/);
  assert.match(caddy, /respond \/healthz 200/);
});

test(
  "the overlay has no duplicate published host ports",
  { skip: !docker },
  () => {
    // `!reset` must have dropped the base app's port; otherwise the proxy and
    // the app would both try to bind PORT and `up` would fail.
    const config = composeConfig(scaleArgs, { API_REPLICAS: "2" });
    const hostPorts = publishedPorts(config).filter((port) => port !== "");
    assert.equal(new Set(hostPorts).size, hostPorts.length);
  },
);

test(
  "nginx accepts the proxy config",
  { skip: !docker || !dockerDaemon },
  () => {
    const image = "nginx:alpine";
    const hasImage =
      spawnSync("docker", ["image", "inspect", image], {
        encoding: "utf8",
      }).status === 0;
    if (!hasImage) {
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
    const hasImage =
      spawnSync("docker", ["image", "inspect", image], {
        encoding: "utf8",
      }).status === 0;
    if (!hasImage) {
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
