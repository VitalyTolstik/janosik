/**
 * Runtime configuration: where the Janosik instance lives, the personal API
 * token (`jnk_…`) that authenticates every call, the app's sub-path (for
 * building share links) and whether the filesystem tools are allowed.
 *
 * Values come from the environment (`JANOSIK_URL`, `JANOSIK_TOKEN`,
 * `JANOSIK_APP_BASE`, `JANOSIK_MCP_ALLOW_FS`, `JANOSIK_MCP_FS_ROOT`) or from
 * matching CLI flags, so the server works whether a client passes config via
 * `env` or via `args` (Claude Desktop, Cursor, VS Code, opencode all support
 * either).
 */

import path from "node:path";

/**
 * Tool groups. The default set covers working the board; the groups that
 * change who can see a board (members, share links) or expose the account
 * identity (`account`) are opt-in. Board content is untrusted input to the
 * model, and a prompt-injected agent holding those tools could invite an
 * outsider or publish the board. API-key management is not exposed to API
 * keys, and TASK-166 removed the invitation/profile tools: those routes are
 * session-only (`pat_forbidden`).
 */
export const TOOLSETS = [
  "boards",
  "columns",
  "cards",
  "labels",
  "checklists",
  "links",
  "comments",
  "activity",
  "attachments",
  "sessions",
  "members",
  "shares",
  "account",
] as const;
export type Toolset = (typeof TOOLSETS)[number];

/** Enabled unless the operator chooses otherwise. */
export const DEFAULT_TOOLSETS: readonly Toolset[] = [
  "boards",
  "columns",
  "cards",
  "labels",
  "checklists",
  "links",
  "comments",
  "activity",
  "attachments",
  "sessions",
];

export interface Config {
  /** Origin of the instance, e.g. `http://localhost:3000` (no trailing slash). */
  url: string;
  /** Personal API token, `jnk_…`. */
  token: string;
  /** App sub-path, `""` at the root or `"/app"` when the site owns the root. */
  appBase: string;
  /** Whether the attachment upload/download tools may touch the local disk. */
  allowFs: boolean;
  /** When set, filesystem tools are confined to this directory. */
  fsRoot: string | null;
  /** Tool groups to register. */
  toolsets: ReadonlySet<Toolset>;
  /** Register only tools that never change anything. */
  readOnly: boolean;
}

/** A config error a client can act on (surfaced on stderr at startup). */
export class ConfigError extends Error {}

interface ParsedArgs {
  url?: string;
  token?: string;
  appBase?: string;
  fsRoot?: string;
  allowFs?: boolean;
  toolsets?: string;
  readOnly?: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    // Split on the first `=` only, so a value may itself contain `=`.
    const eq = arg.indexOf("=");
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);
    const takeValue = (): string => {
      if (inline !== undefined) return inline;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("-")) {
        throw new ConfigError(`Missing value for ${flag}.`);
      }
      i += 1;
      return next;
    };
    switch (flag) {
      case "--url":
        out.url = takeValue();
        break;
      case "--token":
        out.token = takeValue();
        break;
      case "--app-base":
        out.appBase = takeValue();
        break;
      case "--fs-root":
        out.fsRoot = takeValue();
        break;
      case "--allow-fs":
        out.allowFs = true;
        break;
      case "--toolsets":
        out.toolsets = takeValue();
        break;
      case "--read-only":
        out.readOnly = true;
        break;
      case "--help":
      case "-h":
        out.help = true;
        break;
      default:
        // Ignore bare positionals, but reject an unknown flag so a typo
        // (`--URL`, `--tokne`) fails loudly instead of being dropped.
        if (flag.startsWith("-")) {
          throw new ConfigError(`Unknown argument "${arg}". Run with --help.`);
        }
        break;
    }
  }
  return out;
}

/** Accept an HTTP(S) origin, so API paths and share links use one base. */
function normalizeUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ConfigError("JANOSIK_URL must be an HTTP(S) instance origin.");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new ConfigError(
      "JANOSIK_URL must be an HTTP(S) instance origin without a path, " +
        "credentials, query or fragment (for example https://boards.example.com).",
    );
  }
  return parsed.origin;
}

/** Normalise a sub-path: `""` at the root, otherwise `"/app"` (no slashes). */
function normalizeAppBase(base: string): string {
  const trimmed = base.trim().replace(/^\/+|\/+$/g, "");
  return trimmed === "" ? "" : `/${trimmed}`;
}

/** Env truthiness: `1`, `true`, `yes`, `on` (case-insensitive). */
function parseBool(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

/**
 * Parse a toolset list: comma-separated names, `all`, or `default` (the
 * default set), combinable (`default,members`). Unknown names are an error
 * so a typo never silently drops or grants a group.
 */
function parseToolsets(value: string | undefined): ReadonlySet<Toolset> {
  if (value === undefined || value.trim() === "") {
    return new Set(DEFAULT_TOOLSETS);
  }
  const out = new Set<Toolset>();
  for (const raw of value.split(",")) {
    const name = raw.trim().toLowerCase();
    if (name === "") continue;
    if (name === "all") TOOLSETS.forEach((set) => out.add(set));
    else if (name === "default")
      DEFAULT_TOOLSETS.forEach((set) => out.add(set));
    else if (name === "invitations") {
      // TASK-166 removed the invitation tools (the routes are session-only).
      // Keep old configurations starting instead of failing the whole agent;
      // the group contributes nothing.
      process.stderr.write(
        'janosik-mcp: warning: toolset "invitations" was removed; ignoring it.\n',
      );
    } else if ((TOOLSETS as readonly string[]).includes(name)) {
      out.add(name as Toolset);
    } else {
      throw new ConfigError(
        `Unknown toolset "${name}". Use a comma-separated list of: ` +
          `${TOOLSETS.join(", ")} (or "all", "default"); ` +
          `"invitations" is accepted but removed.`,
      );
    }
  }
  return out;
}

/**
 * Resolve the config, or throw a {@link ConfigError} naming the missing
 * variable so the client shows an actionable message instead of a stack.
 */
export function loadConfig(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Config {
  const args = parseArgs(argv);
  const url = args.url ?? env.JANOSIK_URL;
  const token = args.token ?? env.JANOSIK_TOKEN;

  if (!url) {
    throw new ConfigError(
      "Missing JANOSIK_URL. Set it to your instance origin, e.g. " +
        "https://boards.example.com (or pass --url).",
    );
  }
  if (!token) {
    throw new ConfigError(
      "Missing JANOSIK_TOKEN. Create a personal API key in Janosik " +
        "(Account → API keys) and set it here (or pass --token).",
    );
  }

  const appBase = normalizeAppBase(args.appBase ?? env.JANOSIK_APP_BASE ?? "");
  const fsRootRaw = args.fsRoot ?? env.JANOSIK_MCP_FS_ROOT;
  const allowFs = args.allowFs ?? parseBool(env.JANOSIK_MCP_ALLOW_FS) ?? false;

  return {
    url: normalizeUrl(url),
    token,
    appBase,
    allowFs,
    fsRoot: fsRootRaw ? path.resolve(fsRootRaw) : null,
    toolsets: parseToolsets(args.toolsets ?? env.JANOSIK_MCP_TOOLSETS),
    readOnly: args.readOnly ?? parseBool(env.JANOSIK_MCP_READONLY) ?? false,
  };
}

/** Usage text printed for `--help` (kept tiny; the README has the full guide). */
export const USAGE = `janosik-mcp — MCP server for a Janosik board

Environment:
  JANOSIK_URL          Instance origin, e.g. http://localhost:3000
  JANOSIK_TOKEN        Personal API key (jnk_…)
  JANOSIK_APP_BASE     App sub-path (default none; e.g. /app)
  JANOSIK_MCP_ALLOW_FS Allow attachment upload/download (default off)
  JANOSIK_MCP_FS_ROOT  Confine filesystem tools to this directory
  JANOSIK_MCP_TOOLSETS Tool groups (default: ${DEFAULT_TOOLSETS.join(",")};
                       opt-in: members,shares,account; or "all"). The removed
                       "invitations" name is accepted but does nothing.
  JANOSIK_MCP_READONLY Register read-only tools only

  Prefer the environment for JANOSIK_TOKEN: a --token flag is visible to
  other local users in the process list. Create the key in Account → API keys
  with a browser session; this server only consumes it.

Flags:
  --url <url>          Override JANOSIK_URL
  --token <tok>        Override JANOSIK_TOKEN
  --app-base <path>    Override JANOSIK_APP_BASE
  --allow-fs           Enable the filesystem tools
  --fs-root <dir>      Confine the filesystem tools to a directory
  --toolsets <list>    Override JANOSIK_MCP_TOOLSETS
  --read-only          Register read-only tools only
  --help               Show this help`;
