import { useEffect, useRef, useState, type FormEvent } from "react";
import OTPInput from "react-otp-input";
import { Loader2, LogOut, MailCheck } from "lucide-react";

import { ApiError, api } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

/** Seconds before the "Resend code" button unlocks again. */
const RESEND_COOLDOWN_SECONDS = 60;
const CODE_LENGTH = 6;

/**
 * Registration email confirmation (TASK-53): the fullscreen gate the app
 * shows instead of the boards while the signed-in account's email is not
 * confirmed yet. The 6-digit code arrives at the registered address; a
 * resend is throttled to 3/hour server-side, the cooldown here keeps the
 * button honest.
 */
export function EmailVerificationGate() {
  const { t } = useI18n();
  const { user, logout, updateUser } = useAuth();

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [resendIn, setResendIn] = useState(RESEND_COOLDOWN_SECONDS);
  const resendTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (resendIn <= 0) {
      if (resendTimer.current) {
        clearInterval(resendTimer.current);
        resendTimer.current = null;
      }
      return;
    }
    if (resendTimer.current) return;
    resendTimer.current = setInterval(() => {
      setResendIn((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => {
      if (resendTimer.current) {
        clearInterval(resendTimer.current);
        resendTimer.current = null;
      }
    };
  }, [resendIn]);

  const handleVerify = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || code.length !== CODE_LENGTH) return;
    setBusy(true);
    setError(null);
    try {
      const { user: verified } = await api.verifyEmail(code);
      updateUser(verified);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 429) {
        setError(t("auth.verifyEmail.error.tooMany"));
      } else {
        setError(t("auth.verifyEmail.error.invalidCode"));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.resendEmailVerification();
      setCode("");
      setResendIn(RESEND_COOLDOWN_SECONDS);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 429) {
        setError(t("auth.verifyEmail.error.tooMany"));
      } else if (cause instanceof ApiError && cause.status === 503) {
        setError(t("auth.verifyEmail.error.sendFailed"));
      } else {
        setError(t("auth.verifyEmail.error.generic"));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    await logout();
  };

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-border/70 bg-card p-6 shadow-sm">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <MailCheck className="h-5 w-5" aria-hidden />
          </span>
          <h1 className="text-base font-semibold">
            {t("auth.verifyEmail.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("auth.verifyEmail.subtitle", {
              email: user?.email ?? "",
            })}
          </p>
        </div>

        <form onSubmit={handleVerify} className="mt-5 space-y-4">
          <div className="flex flex-col items-center gap-3">
            <div className="flex gap-2" data-testid="email-verify-code">
              <OTPInput
                value={code}
                onChange={setCode}
                numInputs={CODE_LENGTH}
                inputType="tel"
                shouldAutoFocus
                skipDefaultStyles
                renderInput={(props) => (
                  <input
                    {...props}
                    className={cn(
                      "h-10 w-10 rounded-md border border-input bg-background text-center text-lg font-semibold tabular-nums shadow-sm transition-colors",
                      "focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40",
                      props.value && "border-ring bg-accent/50",
                    )}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                  />
                )}
              />
            </div>
            {resendIn > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled
                data-testid="email-verify-resend"
              >
                {t("auth.verifyEmail.resendIn", { seconds: resendIn })}
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid="email-verify-resend"
                disabled={busy}
                onClick={() => void handleResend()}
              >
                {t("auth.verifyEmail.resend")}
              </Button>
            )}
          </div>

          {error !== null ? (
            <p
              role="alert"
              data-testid="email-verify-error"
              className="text-center text-xs text-danger"
            >
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            className="w-full"
            data-testid="email-verify-verify"
            disabled={busy || code.length !== CODE_LENGTH}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              t("auth.verifyEmail.verify")
            )}
          </Button>
        </form>

        <Button
          type="button"
          variant="ghost"
          className="mt-2 w-full text-muted-foreground"
          data-testid="email-verify-signout"
          disabled={signingOut}
          onClick={() => void handleSignOut()}
        >
          <LogOut className="h-4 w-4" aria-hidden />
          {t("auth.verifyEmail.signOut")}
        </Button>
      </div>
    </main>
  );
}
