/**
 * Entry point: read config, build the server, speak MCP over stdio. All
 * diagnostics go to stderr — stdout is the protocol channel.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { ConfigError, USAGE, loadConfig } from "./config.js";
import { createServer } from "./server.js";

function log(message: string): void {
  process.stderr.write(`janosik-mcp: ${message}\n`);
}

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      log(error.message);
      process.exit(1);
    }
    throw error;
  }

  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`connected to ${config.url}`);

  // Close cleanly when the client (or a shell) stops us, so the transport
  // releases stdin/stdout instead of being killed mid-frame.
  const shutdown = (signal: NodeJS.Signals): void => {
    void server.close().finally(() => {
      log(`stopped (${signal})`);
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

process.on("unhandledRejection", (reason) => {
  log(
    `unhandled rejection: ${reason instanceof Error ? reason.message : reason}`,
  );
});

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  log(`failed: ${message}`);
  process.exit(1);
});
