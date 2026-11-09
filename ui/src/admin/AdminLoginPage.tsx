import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  CircleAlert,
  Eye,
  EyeOff,
  Loader2,
  Moon,
  Sun,
} from "lucide-react";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";
import { ApiError } from "@/api/client";
import { routes } from "@/routes";
import { useAdminT } from "./admin-i18n";
import { useAdminAuth } from "./AdminAuthContext";
import { fieldError } from "./validation";

type ErrorKind = "invalid" | "totp" | "locked" | "disabled" | "ip" | "offline";

interface LoginError {
  kind: ErrorKind;
  title: string;
  body?: string;
}

/**
 * Master sign-in: one centered form, no brand rail and no marketing copy.
 * It keeps the separate master API, the progressive TOTP step and the
 * existing test ids.
 */
export function AdminLoginPage() {
  const t = useAdminT();
  const { login } = useAdminAuth();
  const { theme, setTheme } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [totpRequired, setTotpRequired] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState<LoginError | null>(null);
  const [emailTouched, setEmailTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [totpRemaining, setTotpRemaining] = useState(30);
  const emailRef = useRef<HTMLInputElement>(null);
  const totpRef = useRef<HTMLInputElement>(null);

  const localEmailError =
    emailTouched || email.trim() !== ""
      ? fieldError(t, email, { required: true, email: true })
      : null;

  useEffect(() => {
    if (!totpRequired) return;
    const tick = () =>
      setTotpRemaining(30 - (Math.floor(Date.now() / 1000) % 30));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [totpRequired]);

  useEffect(() => {
    if (totpRequired) totpRef.current?.focus();
  }, [totpRequired]);

  const capsLockFrom = (event: React.KeyboardEvent) => {
    if (typeof event.getModifierState === "function") {
      setCapsLock(event.getModifierState("CapsLock"));
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setEmailTouched(true);
    setError(null);

    const emailProblem = fieldError(t, email, { required: true, email: true });
    if (emailProblem !== null) {
      emailRef.current?.focus();
      return;
    }
    if (password === "") {
      setError({ kind: "invalid", title: t("admin.login.error") });
      return;
    }
    if (totpRequired && code.length !== 6) {
      setError({ kind: "totp", title: t("admin.login.totpInvalid") });
      return;
    }

    setBusy(true);
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
          setCode("");
          setError(
            code.trim() === ""
              ? null
              : { kind: "totp", title: t("admin.login.totpInvalid") },
          );
          return;
        }
        if (cause.status === 403 && body?.code === "ip_not_allowed") {
          setError({
            kind: "ip",
            title: t("admin.login.ipDenied"),
            body: t("admin.login.ipDeniedHint"),
          });
          return;
        }
        if (
          cause.status === 403 &&
          cause.messageText.toLowerCase().includes("disabled")
        ) {
          setError({
            kind: "disabled",
            title: t("admin.login.disabled"),
            body: t("admin.login.disabledBody"),
          });
          return;
        }
        if (cause.status === 429) {
          setError({
            kind: "locked",
            title: t("admin.login.locked"),
            body: t("admin.login.lockedBody"),
          });
          return;
        }
        if (cause.status === 0) {
          setError({
            kind: "offline",
            title: t("admin.login.offline"),
            body: t("admin.login.offlineBody"),
          });
          return;
        }
      }
      setError({
        kind: "invalid",
        title: t("admin.login.error"),
        body: t("admin.login.errorBody"),
      });
    } finally {
      setBusy(false);
    }
  };

  const errorTitleId = "admin-login-error-title";
  const emailErrorId = "admin-login-email-error";

  return (
    <div className="admin-login">
      <div className="admin-login-tools">
        <LanguageSwitcher />
        <button
          type="button"
          aria-label={t("admin.login.theme")}
          data-testid="admin-login-theme"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card/50 text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
        >
          {theme === "dark" ? (
            <Sun className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Moon className="h-3.5 w-3.5" aria-hidden />
          )}
        </button>
      </div>

      <section className="admin-login-pane" aria-label="Janosik master console">
        <div className="admin-login-form-wrap">
          <div className="mb-6">
            <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.025em] text-foreground">
              {totpRequired
                ? t("admin.login.totpTitle")
                : t("admin.login.title")}
            </h1>
            {totpRequired ? (
              <p className="mt-1.5 text-[12px] leading-5 text-muted-foreground">
                {t("admin.login.totpSubtitle")}
              </p>
            ) : null}
          </div>

          <form
            noValidate
            onSubmit={(event) => void submit(event)}
            data-testid="admin-login-form"
            aria-busy={busy}
            className="space-y-3"
          >
            {error ? (
              <div
                role="alert"
                aria-labelledby={errorTitleId}
                className="flex gap-2.5 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-xs text-danger"
              >
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <div>
                  <p id={errorTitleId} data-testid="admin-login-error">
                    {error.title}
                  </p>
                  {error.body ? (
                    <p className="mt-1 leading-5 text-danger/85">
                      {error.body}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {!totpRequired ? (
              <>
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-foreground">
                    {t("admin.login.email")}
                  </span>
                  <input
                    ref={emailRef}
                    type="email"
                    name="email"
                    required
                    autoComplete="username"
                    spellCheck={false}
                    placeholder={t("admin.login.emailPlaceholder")}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    onBlur={() => setEmailTouched(true)}
                    aria-invalid={localEmailError !== null}
                    aria-describedby={
                      localEmailError !== null ? emailErrorId : undefined
                    }
                    data-testid="admin-login-email"
                    className="h-10 w-full rounded-lg border border-input bg-card/60 px-3 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-danger max-sm:h-11"
                  />
                  {localEmailError !== null ? (
                    <span
                      id={emailErrorId}
                      role="alert"
                      className="block text-[11px] text-danger"
                    >
                      {localEmailError}
                    </span>
                  ) : null}
                </label>

                <label className="block space-y-1">
                  <span className="flex items-center justify-between gap-2 text-[11px] font-medium text-foreground">
                    <span>{t("admin.login.password")}</span>
                    <button
                      type="button"
                      data-testid="admin-login-show-password"
                      aria-label={
                        showPassword
                          ? t("admin.login.hidePassword")
                          : t("admin.login.showPassword")
                      }
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((visible) => !visible)}
                      className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-normal text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {showPassword ? (
                        <EyeOff className="h-3 w-3" aria-hidden />
                      ) : (
                        <Eye className="h-3 w-3" aria-hidden />
                      )}
                      {showPassword
                        ? t("admin.login.hide")
                        : t("admin.login.show")}
                    </button>
                  </span>
                  <input
                    type={showPassword ? "text" : "password"}
                    name="password"
                    required
                    autoComplete="current-password"
                    placeholder={t("admin.login.passwordPlaceholder")}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    onKeyDown={capsLockFrom}
                    onKeyUp={capsLockFrom}
                    data-testid="admin-login-password"
                    className="h-10 w-full rounded-lg border border-input bg-card/60 px-3 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring max-sm:h-11"
                  />
                  {capsLock ? (
                    <span
                      data-testid="admin-login-capslock"
                      className="block text-[11px] text-warning"
                    >
                      ⇪ {t("admin.login.capsLock")}
                    </span>
                  ) : null}
                </label>
              </>
            ) : (
              <div className="space-y-2">
                <label className="block space-y-1">
                  <span className="flex items-center justify-between text-[11px] font-medium text-foreground">
                    <span>{t("admin.login.totpCode")}</span>
                    <span className="font-mono text-[10px] font-normal text-muted-foreground">
                      {String(totpRemaining).padStart(2, "0")}s
                    </span>
                  </span>
                  <input
                    ref={totpRef}
                    type="text"
                    name="totpCode"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(event) =>
                      setCode(event.target.value.replace(/\D/g, ""))
                    }
                    data-testid="admin-login-totp"
                    className="h-11 w-full rounded-lg border border-input bg-card/60 px-3 text-center font-mono text-xl tracking-[0.42em] text-foreground outline-none transition focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <span
                    className="block h-0.5 overflow-hidden rounded-full bg-border"
                    aria-hidden
                  >
                    <span
                      className="block h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear"
                      style={{ width: `${(totpRemaining / 30) * 100}%` }}
                    />
                  </span>
                  <span className="block text-[11px] leading-5 text-muted-foreground">
                    {t("admin.login.totpHint")}
                  </span>
                </label>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <button
                    type="button"
                    data-testid="admin-login-back"
                    onClick={() => {
                      setTotpRequired(false);
                      setCode("");
                      setError(null);
                    }}
                    className="text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
                  >
                    {t("admin.login.backToPassword")}
                  </button>
                  <span className="text-muted-foreground">
                    {t("admin.login.lostDevice")}
                  </span>
                </div>
              </div>
            )}

            <Button
              type="submit"
              disabled={busy}
              data-testid="admin-login-submit"
              className="mt-1 h-10 w-full text-[13px] max-sm:h-11"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  {totpRequired
                    ? t("admin.login.verifying")
                    : t("admin.login.submitting")}
                </>
              ) : totpRequired ? (
                t("admin.login.verify")
              ) : (
                t("admin.login.submit")
              )}
            </Button>
          </form>

          <div className="mt-6 flex items-center justify-center gap-3 text-[11px] text-muted-foreground">
            <Link
              to={routes.home}
              className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              {t("admin.login.back")}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
