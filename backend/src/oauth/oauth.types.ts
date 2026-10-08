import { env } from "@/config/env";
import type { OAuthProviderId } from "@janosik/shared";

/**
 * OAuth login (TASK-54) — shared constants of the redirect-based
 * authorization-code flow. The state cookie exists only for the round trip
 * through the provider: it is set by `/:provider/start` and read by
 * `/:provider/callback`, so it is scoped to exactly this path and `lax`
 * (the provider's top-level GET redirect must carry it — `strict` would not).
 */

export const OAUTH_STATE_COOKIE = "oauth_state";

/** 10 minutes is plenty for a human to finish the provider round trip. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** Internal shape of one provider's endpoints and demands. */
export interface OAuthProviderConfig {
  id: OAuthProviderId;
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  /** `null` → the provider takes no scope parameter (Yandex). */
  scope: string | null;
  userinfoUrl: string;
}

/** Endpoints of the supported providers (official docs). */
export const OAUTH_PROVIDERS: Record<OAuthProviderId, OAuthProviderConfig> = {
  google: {
    id: "google",
    label: "Google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
    userinfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
  },
  yandex: {
    id: "yandex",
    label: "Яндекс",
    authorizeUrl: "https://oauth.yandex.ru/authorize",
    tokenUrl: "https://oauth.yandex.ru/token",
    scope: null,
    userinfoUrl: "https://login.yandex.ru/info?format=json",
  },
};

/** The exact URL that must be registered in the provider's console. */
export function oauthCallbackUrl(provider: OAuthProviderId): string {
  return `${env.PUBLIC_ORIGIN.replace(/\/+$/, "")}/api/v1/auth/oauth/${provider}/callback`;
}

/** Wire projection of a verified provider profile (TASK-54). */
export interface OAuthProfile {
  email: string;
  displayName: string | null;
}
