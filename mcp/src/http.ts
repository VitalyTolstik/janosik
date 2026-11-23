/**
 * CLI entry point for the shared MCP Streamable HTTP gateway.
 *
 * Run it as a separate container/process next to the API:
 *   JANOSIK_URL=https://boards.example.com node mcp/dist/http.js
 *
 * The stdio entry point (`dist/index.js`) is unchanged for desktop clients.
 */

import { ConfigError } from "./config.js";
import { HTTP_USAGE, loadGatewayConfig } from "./http-config.js";
import { createLogger, type Logger } from "./http-log.js";
import { createHttpGateway, type HttpGateway } from "./http-server.js";
import { readVersion } from "./version.js";

function startupError(message: string): void {
  process.stderr.write(`janosik-mcp-http: ${message}\n`);
}

/** Start the gateway and install signal handlers; exported for tests. */
export async function main(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<HttpGateway | null> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${HTTP_USAGE}\n`);
    return null;
  }

  let loaded;
  try {
    loaded = loadGatewayConfig(env, argv);
  } catch (error) {
    if (error instanceof ConfigError) {
      startupError(error.message);
      throw error;
    }
    throw error;
  }

  const logger = createLogger({ level: loaded.config.logLevel });
  if (loaded.ignoredSharedToken) {
    logger.warn("shared_token_env_ignored", {
      variable: "JANOSIK_TOKEN",
      hint: "Each MCP session must send Authorization: Bearer … instead.",
    });
  }

  const gateway = createHttpGateway({
    config: loaded.config,
    logger,
    version: readVersion(),
  });
  await gateway.listen();

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals, log: Logger): void => {
    if (shuttingDown) {
      log.warn("second_signal", { signal });
      process.exit(1);
    }
    shuttingDown = true;
    logger.info("shutdown_signal", { signal });
    void gateway
      .close(signal)
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        logger.error("shutdown_failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        process.exit(1);
      });
  };
  process.on("SIGINT", () => shutdown("SIGINT", logger));
  process.on("SIGTERM", () => shutdown("SIGTERM", logger));
  process.on("unhandledRejection", (reason) => {
    logger.error("unhandled_rejection", {
      error: reason instanceof Error ? reason.message : String(reason),
    });
  });
  return gateway;
}

main().catch((error: unknown) => {
  if (!(error instanceof ConfigError)) {
    startupError(error instanceof Error ? error.message : String(error));
  }
  process.exit(1);
});
