import { ForbiddenException } from "@nestjs/common";

/**
 * Read-only "view as" sessions (TASK-147, finding B3).
 *
 * An impersonation token is a real user access token with an extra `imp`
 * claim, so without a rule it could change the victim's password, move the
 * account to another mailbox or mint personal API tokens — a support login
 * would be a full account takeover. The token's 15-minute life limits the
 * damage but does not stop it.
 *
 * The policy: an impersonated session may only *read*. Safe HTTP methods
 * always pass; a write is refused unless it is on {@link IMPERSONATION_WRITES}
 * (liveness bookkeeping the UI needs to keep the board honest). A handful of
 * sensitive read paths — personal token listings — are refused too, because a
 * support agent has no business enumerating a victim's keys.
 *
 * The decision is a pure function of method and path so the rule is unit
 * tested directly, away from the guard plumbing.
 */
export const IMPERSONATION_FORBIDDEN_MESSAGE =
  "This is a read-only support session — you cannot change anything while viewing as a user";

/** Message of the 403 an impersonated session gets. Stable, for UI/MCP. */
export const IMPERSONATION_FORBIDDEN_CODE = "impersonation_read_only";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Writes a read-only session still needs: the presence heartbeat. */
const IMPERSONATION_WRITES: RegExp[] = [/\/presence\/?$/];

/** Paths refused even for a read: a victim's personal-token surface. */
const IMPERSONATION_BLOCKED_READS: RegExp[] = [/\/users\/me\/tokens(\/|$)/];

/** True when a read-only impersonated session may perform this request. */
export function impersonationAllows(method: string, path: string): boolean {
  const upper = method.toUpperCase();
  if (IMPERSONATION_BLOCKED_READS.some((re) => re.test(path))) return false;
  if (SAFE_METHODS.has(upper)) return true;
  return IMPERSONATION_WRITES.some((re) => re.test(path));
}

/** Throws the stable 403 when a read-only session is not allowed to act. */
export function assertImpersonationAllows(method: string, path: string): void {
  if (!impersonationAllows(method, path)) {
    throw new ForbiddenException({
      message: IMPERSONATION_FORBIDDEN_MESSAGE,
      code: IMPERSONATION_FORBIDDEN_CODE,
    });
  }
}
