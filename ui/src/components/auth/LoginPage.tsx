import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";

import { api, ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/auth/AuthContext";
import { useI18n, type MessageKey } from "@/i18n";
import type { OAuthProviderDto } from "@janosik/shared";

/**
 * Login / registration screen (TASK-29).
 *
 * One form, two modes: the server needs at least one account before anything
 * can be stored, and self-hosters start from zero, so registration lives on
 * the same screen instead of waiting for the landing page (TASK-32). Errors
 * map to localized messages; the raw NestJS text stays on the English
 * validation path only as a last resort.
 */

type Mode = "login" | "register";

/** Localized message for a failed auth call. */
function authErrorMessage(
  error: unknown,
  t: (key: MessageKey) => string,
): string {
  if (error instanceof ApiError) {
    if (error.offline) return t("auth.networkError");
    if (error.status === 429) return t("auth.rateLimited");
    if (error.status === 401) return t("auth.invalidCredentials");
    if (error.status === 409) return t("auth.emailTaken");
    if (error.status === 400) return t("auth.invalidInput");
  }
  return t("auth.genericError");
}

export function LoginPage() {
  const { t } = useI18n();
  const { login, register } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [oauthProviders, setOauthProviders] = useState<OAuthProviderDto[]>([]);

  const isRegister = mode === "register";

  // An OAuth round trip that failed server-side lands back here with
  // ?authError=oauth_failed — surface it and clean the URL.
  useEffect(() => {
    if (searchParams.get("authError") !== null) {
      setError(t("auth.oauthFailed"));
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount
  }, []);

  // Enabled providers only — an unconfigured instance renders no buttons
  // and behaves exactly like before TASK-54.
  useEffect(() => {
    let cancelled = false;
    api
      .listOAuthProviders()
      .then((response) => {
        if (!cancelled) setOauthProviders(response.providers);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      if (isRegister) {
        const name = displayName.trim();
        await register(email.trim(), password, name === "" ? undefined : name);
      } else {
        await login(email.trim(), password);
      }
      // Success unmounts this screen through the auth gate.
    } catch (caught) {
      setError(authErrorMessage(caught, t));
      setPending(false);
    }
  };

  const toggleMode = () => {
    setMode(isRegister ? "login" : "register");
    setError(null);
  };

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span
            aria-hidden
            className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-secondary text-primary-foreground shadow-sm"
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <path
                d="M14.086 18.412A2 2 0 0112.67 19H5v-7.672a2 2 0 01.586-1.414L11.75 3.75a6 6 0 118.49 8.49z"
                fill="currentColor"
              />
              <path
                d="M16 8 2 22"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <h1 className="text-lg font-semibold text-foreground">
            {isRegister ? t("auth.registerTitle") : t("auth.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isRegister ? t("auth.registerSubtitle") : t("auth.subtitle")}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-3 rounded-xl border bg-card p-5 shadow-sm"
        >
          {isRegister ? (
            <>
              <label
                className="text-sm font-medium text-foreground"
                htmlFor="auth-display-name"
              >
                {t("auth.displayName")}
              </label>
              <Input
                id="auth-display-name"
                data-testid="login-display-name"
                name="displayName"
                value={displayName}
                maxLength={50}
                autoComplete="name"
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </>
          ) : null}

          <label
            className="text-sm font-medium text-foreground"
            htmlFor="auth-email"
          >
            {t("auth.email")}
          </label>
          <Input
            id="auth-email"
            data-testid="login-email"
            name="email"
            type="email"
            required
            autoFocus
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <label
            className="text-sm font-medium text-foreground"
            htmlFor="auth-password"
          >
            {t("auth.password")}
          </label>
          <Input
            id="auth-password"
            data-testid="login-password"
            name="password"
            type="password"
            required
            autoComplete={isRegister ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {error !== null ? (
            <p
              role="alert"
              data-testid="login-error"
              className="text-sm text-danger"
            >
              {error}
            </p>
          ) : null}

          <Button type="submit" data-testid="login-submit" disabled={pending}>
            {isRegister ? t("auth.register") : t("auth.login")}
          </Button>

          {oauthProviders.length > 0 ? (
            <>
              <div className="my-1 flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">
                  {t("auth.oauthDivider")}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
              {oauthProviders.map((provider) => (
                <Button
                  key={provider.id}
                  variant="outline"
                  asChild
                  data-testid={`login-oauth-${provider.id}`}
                >
                  <a href={api.oauthStartUrl(provider.id)}>
                    {t("auth.oauthThrough", { provider: provider.label })}
                  </a>
                </Button>
              ))}
            </>
          ) : null}

          <button
            type="button"
            data-testid="login-toggle"
            onClick={toggleMode}
            className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            {isRegister ? t("auth.switchToLogin") : t("auth.switchToRegister")}
          </button>
        </form>
      </div>
    </main>
  );
}
