import { useEffect, useRef, useState, type FormEvent } from "react";
import OTPInput from "react-otp-input";
import { ArrowLeft, MailCheck } from "lucide-react";

import { api, ApiError } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/Toast";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

/** Seconds before the "Resend code" button unlocks again. */
const RESEND_COOLDOWN_SECONDS = 60;
const CODE_LENGTH = 6;

type Step = "form" | "code";

/**
 * Email change (TASK-51) — the double opt-in the top products use: prove
 * the current password, receive a 6-digit code at the NEW address, type it
 * back. The dialog runs the two steps inline; a successful confirmation
 * swaps the signed-in identity app-wide via `updateUser` (the response also
 * rotates the caller's session server-side).
 */
export function EmailChangeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const { updateUser } = useAuth();

  const [step, setStep] = useState<Step>("form");
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const resendTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Closing always resets — re-entering the dialog starts from the form. */
  const handleChangeOpen = (next: boolean) => {
    if (!next) {
      setStep("form");
      setNewEmail("");
      setPassword("");
      setCode("");
      setError(null);
      setBusy(false);
    }
    onOpenChange(next);
  };

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

  if (!open) return null;

  const mapRequestError = (cause: unknown): string => {
    if (cause instanceof ApiError) {
      if (cause.status === 401) return t("account.email.error.wrongPassword");
      if (cause.status === 409) return t("account.email.error.taken");
      if (cause.status === 429) return t("account.email.error.tooMany");
      if (cause.status === 503) return t("account.email.error.sendFailed");
      if (cause.status === 400 && cause.messageText.includes("differ")) {
        return t("account.email.error.sameEmail");
      }
    }
    return t("account.email.error.generic");
  };

  const requestCode = async (): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await api.requestEmailChange(newEmail.trim(), password);
      setStep("code");
      setCode("");
      setResendIn(RESEND_COOLDOWN_SECONDS);
      return true;
    } catch (cause) {
      setError(mapRequestError(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleRequest = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())) {
      setError(t("account.email.error.invalidEmail"));
      return;
    }
    await requestCode();
  };

  const handleConfirm = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || code.length !== CODE_LENGTH) return;
    setBusy(true);
    setError(null);
    try {
      const response = await api.confirmEmailChange(code);
      updateUser(response.user);
      onOpenChange(false);
      toast.success(t("account.email.success"));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setError(t("account.email.error.taken"));
      } else if (cause instanceof ApiError && cause.status === 429) {
        setError(t("account.email.error.tooMany"));
      } else {
        setError(t("account.email.error.invalidCode"));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleBack = () => {
    setStep("form");
    setCode("");
    setError(null);
  };

  return (
    <Dialog open={open} onOpenChange={handleChangeOpen}>
      <DialogContent
        data-testid="email-change-dialog"
        className="sm:max-w-sm"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t("account.email.title")}</DialogTitle>
          {step === "form" ? (
            <DialogDescription>
              {t("account.email.passwordHint")}
            </DialogDescription>
          ) : (
            <DialogDescription className="flex items-center gap-1.5">
              <MailCheck className="h-3.5 w-3.5" aria-hidden />
              {t("account.email.codeHint", { email: newEmail.trim() })}
            </DialogDescription>
          )}
        </DialogHeader>

        {step === "form" ? (
          <form onSubmit={handleRequest} className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="email-change-new"
                className="text-xs font-medium text-muted-foreground"
              >
                {t("account.email.emailLabel")}
              </label>
              <Input
                id="email-change-new"
                data-testid="email-change-new"
                type="email"
                autoComplete="email"
                placeholder={t("account.email.newEmailPlaceholder")}
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="email-change-password"
                className="text-xs font-medium text-muted-foreground"
              >
                {t("account.email.passwordLabel")}
              </label>
              <Input
                id="email-change-password"
                data-testid="email-change-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t("account.email.sessionsNote")}
            </p>
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                data-testid="email-change-send"
                disabled={busy || !newEmail.trim() || !password}
              >
                {busy
                  ? t("account.email.submitting")
                  : t("account.email.submit")}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form onSubmit={handleConfirm} className="space-y-4">
            <div className="flex flex-col items-center gap-3">
              <div className="flex gap-2" data-testid="email-change-code">
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
                  data-testid="email-change-resend"
                >
                  {t("account.email.resendIn", { seconds: resendIn })}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-testid="email-change-resend"
                  disabled={busy}
                  onClick={() => void requestCode()}
                >
                  {t("account.email.resend")}
                </Button>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={handleBack}
                data-testid="email-change-back"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
                {t("account.email.back")}
              </Button>
              <Button
                type="submit"
                data-testid="email-change-verify"
                disabled={busy || code.length !== CODE_LENGTH}
              >
                {busy
                  ? t("account.email.verifying")
                  : t("account.email.verify")}
              </Button>
            </DialogFooter>
          </form>
        )}

        {error !== null ? (
          <p
            role="alert"
            data-testid="email-change-error"
            className="text-xs text-danger"
          >
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
