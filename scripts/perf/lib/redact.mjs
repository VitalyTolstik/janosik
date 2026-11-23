// TASK-200.1 — keep credentials out of every output channel.
//
// The harness handles three secret sources: PATs, PostgreSQL connection
// strings and Redis URLs. Tokens are never rendered at all; URLs are stripped
// of their userinfo and secret query parameters before they reach console
// output, JSON or Markdown. The same helpers scrub child-process error text,
// because `execFile` puts its argv into `error.message` and a DSN there would
// leak the password.

/**
 * Any query key containing one of these words is treated as a secret.
 * Deliberately substring-based: `sslpassword`, `client_secret`, `x-api-key`
 * and future provider spellings must not slip through a fixed allow-list.
 */
const SECRET_QUERY = /(password|passwd|pwd|secret|token|key|auth)/i;

export function isSecretQueryKey(key) {
  return SECRET_QUERY.test(String(key ?? ""));
}

function decode(value) {
  if (typeof value !== "string" || value === "") return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Remove `user:password@` from an HTTP/PostgreSQL/Redis URL. */
export function stripUserInfo(value) {
  if (typeof value !== "string" || value === "") return value;
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return value.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/i, "$1");
  }
}

/**
 * True when a URL contains userinfo or a secret query parameter. Used to
 * reject credential-bearing CLI values before they become visible in `ps`.
 */
export function hasUrlCredentials(value) {
  if (typeof value !== "string" || value === "") return false;
  try {
    const url = new URL(value);
    if (url.username !== "" || url.password !== "") return true;
    return [...url.searchParams.keys()].some((key) => isSecretQueryKey(key));
  } catch {
    return /^[a-z][a-z0-9+.-]*:\/\/[^/@\s]*@/i.test(value);
  }
}

/** Delete secret query parameters entirely (for child-process argv). */
export function stripSecretQueryParams(value) {
  if (typeof value !== "string" || value === "") return value;
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (isSecretQueryKey(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return String(value)
      .replace(
        /([?&])[^=&#]*(?:password|passwd|pwd|secret|token|key|auth)[^=&#]*=[^&#]*/gi,
        "$1",
      )
      .replace(/\?&/g, "?")
      .replace(/&&+/g, "&")
      .replace(/[?&](?=#|$)/, "");
  }
}

/** Read a named query parameter (decoded), or `undefined`. */
export function getUrlQuerySecret(value, names) {
  if (typeof value !== "string" || value === "") return undefined;
  try {
    const url = new URL(value);
    for (const name of names) {
      const raw = url.searchParams.get(name);
      if (raw !== null && raw !== "") return decode(raw);
    }
  } catch {
    // Not a URL; fall through.
  }
  return undefined;
}

/** Read the userinfo password (decoded), or `undefined`. */
export function getUserInfoPassword(value) {
  try {
    const password = new URL(value).password;
    return password === "" ? undefined : decode(password);
  } catch {
    return undefined;
  }
}

/** Redact the userinfo and sensitive query parameters of a URL. */
export function redactUrl(value) {
  if (typeof value !== "string" || value === "") return value;
  let url;
  try {
    url = new URL(value);
  } catch {
    return stripSecretQueryParams(stripUserInfo(value));
  }
  url.username = "";
  url.password = "";
  for (const key of [...url.searchParams.keys()]) {
    if (isSecretQueryKey(key)) url.searchParams.set(key, "[redacted]");
  }
  return url.toString();
}

/** Replace every literal secret with `[redacted]`, longest first. */
export function redactSecrets(text, secrets = []) {
  let output = String(text ?? "");
  const unique = [
    ...new Set(
      secrets.filter(
        (secret) => typeof secret === "string" && secret.length > 0,
      ),
    ),
  ].sort((a, b) => b.length - a.length);
  for (const secret of unique) {
    output = output.split(secret).join("[redacted]");
  }
  return output;
}

/**
 * Scrub free-form text (child-process stderr, fetch errors, URLs) before it
 * reaches the report. Never pass `error.message` from `execFile` through
 * this without also dropping the argv prefix: callers use `safeChildError`.
 */
export function sanitizeText(text, secrets = []) {
  let output = redactSecrets(text, secrets);
  output = output.replace(
    /([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+:[^/@\s]+@/gi,
    "$1[redacted]@",
  );
  output = output.replace(/(Bearer\s+)[^\s,;]+/gi, "$1[redacted]");
  output = output.replace(
    /\b(jnk_[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{8,})\b/g,
    "[redacted]",
  );
  output = output.replace(
    /\b([A-Za-z0-9_-]*(?:password|passwd|pwd|secret|token|key|auth)[A-Za-z0-9_-]*)\s*=\s*([^\s&,;]+)/gi,
    "$1=[redacted]",
  );
  return output;
}

/**
 * Build a safe reason from a failed child process. `execFile` includes the
 * command line in `error.message`; use stderr (or the exit code) instead.
 */
export function safeChildError(error, secrets = []) {
  const stderr = sanitizeText(error?.stderr ?? "", secrets)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");
  if (stderr !== "") return stderr;
  if (typeof error?.code === "number") {
    return `command exited with code ${error.code}`;
  }
  if (typeof error?.code === "string" && error.code !== "") {
    return `command failed (${sanitizeText(error.code, secrets)})`;
  }
  return "command failed (no stderr)";
}
