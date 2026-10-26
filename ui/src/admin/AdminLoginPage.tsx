import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/api/client";
import { routes } from "@/routes";
import { useAdminT } from "./admin-i18n";
import { useAdminAuth } from "./AdminAuthContext";
import { fieldError } from "./validation";

/**
 * Master login (TASK-36) — deliberately a different screen from the user
 * login: no registration link, no password recovery, no social entry. The
 * form talks only to `/admin/auth/login`; a normal account cannot pass it.
 */
export function AdminLoginPage() {
  const t = useAdminT();
  const { login } = useAdminAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [totpRequired, setTotpRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const emailError = fieldError(t, email, { required: true, email: true });
  const canSubmit =
    emailError === null &&
    password !== "" &&
    (!totpRequired || code.length === 6);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(
        email.trim(),
        password,
        totpRequired ? code.trim() : undefined,
      );
    } catch (cause) {
      if (cause instanceof ApiError) {
        const body = cause.body as { code?: unknown } | null;
        if (body?.code === "totp_required") {
          setTotpRequired(true);
          setError(code.trim() === "" ? null : t("admin.login.totpInvalid"));
          return;
        }
        if (cause.status === 429) {
          setError(t("admin.login.locked"));
          return;
        }
      }
      setError(t("admin.login.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      {/* Ambient brand glow — pure CSS, no assets. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-52 right-[-10rem] h-96 w-[32rem] rounded-full bg-secondary/10 blur-3xl"
      />

      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-card shadow-lg shadow-primary/10">
            <Lock className="h-5 w-5 text-primary" aria-hidden />
          </span>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            {t("admin.login.title")}
          </h1>
          <p className="text-xs text-muted-foreground">
            {t("admin.login.subtitle")}
          </p>
        </div>

        <form
          onSubmit={(event) => void submit(event)}
          data-testid="admin-login-form"
          className="space-y-3 rounded-2xl border border-border bg-card/80 p-5 shadow-xl shadow-black/20 backdrop-blur"
        >
          <label className="block space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("admin.login.email")}
            </span>
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              data-testid="admin-login-email"
              className="h-9 w-full rounded-lg border border-input bg-background/70 px-3 text-sm text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("admin.login.password")}
            </span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              data-testid="admin-login-password"
              className="h-9 w-full rounded-lg border border-input bg-background/70 px-3 text-sm text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>

          {totpRequired ? (
            <label className="block space-y-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("admin.login.totpCode")}
              </span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, ""))
                }
                data-testid="admin-login-totp"
                className="h-9 w-full rounded-lg border border-input bg-background/70 px-3 text-center font-mono text-lg tracking-[0.3em] text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span className="block text-[11px] leading-4 text-muted-foreground">
                {t("admin.login.totpHint")}
              </span>
            </label>
          ) : null}

          {email.trim() !== "" && emailError !== null ? (
            <p
              role="alert"
              data-testid="admin-login-error"
              className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
            >
              {emailError}
            </p>
          ) : error ? (
            <p
              role="alert"
              data-testid="admin-login-error"
              className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
            >
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            disabled={busy || !canSubmit}
            data-testid="admin-login-submit"
            className="w-full"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {t("admin.login.submitting")}
              </>
            ) : (
              t("admin.login.submit")
            )}
          </Button>

          <p className="text-center text-[11px] leading-4 text-muted-foreground">
            {t("admin.login.hint")}
          </p>
        </form>

        <div className="mt-5 text-center">
          <Link
            to={routes.home}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            {t("admin.login.back")}
          </Link>
        </div>
      </div>
    </div>
  );
}
