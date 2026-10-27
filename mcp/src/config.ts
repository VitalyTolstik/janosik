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
 * Tool groups. The default set covers working the board; the groups that act
 * on the *account* or on who can see a board (members, invitations, share
 * links, API keys) are opt-in. Board content is untrusted input to the model,
 * and a prompt-injected agent holding those tools could invite an outsider,
 * publish the board or mint itself a fresh API key.
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
  "members",
  "invitations",
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

/** Strip a trailing slash so `${url}/api/v1` never doubles up. */
function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
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
    else if ((TOOLSETS as readonly string[]).includes(name)) {
      out.add(name as Toolset);
    } else {
      throw new ConfigError(
        `Unknown toolset "${name}". Use a comma-separated list of: ` +
          `${TOOLSETS.join(", ")} (or "all", "default").`,
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
  const allowFs =
    args.allowFs ?? parseBool(env.JANOSIK_MCP_ALLOW_FS) ?? Boolean(fsRootRaw);

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
                       opt-in: members,invitations,shares,account; or "all")
  JANOSIK_MCP_READONLY Register read-only tools only

  Prefer the environment for JANOSIK_TOKEN: a --token flag is visible to
  other local users in the process list.

Flags:
  --url <url>          Override JANOSIK_URL
  --token <tok>        Override JANOSIK_TOKEN
  --app-base <path>    Override JANOSIK_APP_BASE
  --allow-fs           Enable the filesystem tools
  --fs-root <dir>      Confine the filesystem tools to a directory
  --toolsets <list>    Override JANOSIK_MCP_TOOLSETS
  --read-only          Register read-only tools only
  --help               Show this help`;
