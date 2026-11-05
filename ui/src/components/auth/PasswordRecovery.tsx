import { useState, type FormEvent } from "react";
import { ArrowLeft, KeyRound, MailCheck } from "lucide-react";
import { api, ApiError } from "@/api/client";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";

export function PasswordRecovery({
  initialEmail,
  onBack,
}: {
  initialEmail: string;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [step, setStep] = useState<"request" | "confirm" | "done">("request");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setInvalidField(null);
    const invalid = Array.from(
      event.currentTarget.querySelectorAll("input"),
    ).find((input) => !input.validity.valid);
    if (invalid) {
      setInvalidField(invalid.id);
      if (invalid.id === "recovery-email")
        setError(
          t(
            invalid.validity.valueMissing
              ? "auth.recovery.emailRequired"
              : "auth.recovery.emailInvalid",
          ),
        );
      else if (invalid.id === "recovery-code")
        setError(
          t(
            invalid.validity.valueMissing
              ? "auth.recovery.codeRequired"
              : "auth.recovery.codeLength",
          ),
        );
      else if (invalid.id === "recovery-password")
        setError(
          t(
            invalid.validity.valueMissing
              ? "auth.recovery.passwordRequired"
              : "auth.recovery.passwordLength",
          ),
        );
      else
        setError(
          t(
            invalid.validity.valueMissing
              ? "auth.recovery.confirmRequired"
              : "auth.recovery.passwordLength",
          ),
        );
      invalid.focus();
      return;
    }
    if (step === "confirm" && password !== confirmation) {
      setError(t("auth.recovery.mismatch"));
      return;
    }
    setPending(true);
    try {
      if (step === "request") {
        await api.requestPasswordReset(email.trim());
        setStep("confirm");
      } else {
        await api.confirmPasswordReset(
          email.trim(),
          code.trim().toLowerCase(),
          password,
        );
        setStep("done");
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 503)
        setError(t("auth.recovery.unavailable"));
      else if (e instanceof ApiError && e.status === 429)
        setError(t("auth.recovery.rateLimited"));
      else if (e instanceof ApiError && e.status === 400 && step === "confirm")
        setError(t("auth.recovery.invalid"));
      else if (e instanceof ApiError && e.offline)
        setError(t("auth.networkError"));
      else setError(t("auth.recovery.error"));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="w-full max-w-sm">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <BrandMark size="large" />
        <h1 className="text-lg font-semibold">
          {step === "done"
            ? t("auth.recovery.doneTitle")
            : t("auth.recovery.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {step === "request"
            ? t("auth.recovery.subtitle")
            : step === "confirm"
              ? t("auth.recovery.sent")
              : t("auth.recovery.done")}
        </p>
      </div>
      <form
        noValidate
        onSubmit={submit}
        className="flex flex-col gap-3 rounded-xl border bg-card p-5 shadow-sm"
      >
        {step === "request" && (
          <>
            <label htmlFor="recovery-email" className="text-sm font-medium">
              {t("auth.email")}
            </label>
            <Input
              id="recovery-email"
              aria-invalid={invalidField === "recovery-email" || undefined}
              aria-describedby={
                invalidField === "recovery-email" ? "recovery-error" : undefined
              }
              data-testid="recovery-email"
              type="email"
              autoComplete="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </>
        )}
        {step === "confirm" && (
          <>
            <label htmlFor="recovery-code" className="text-sm font-medium">
              {t("auth.recovery.code")}
            </label>
            <Input
              id="recovery-code"
              aria-invalid={invalidField === "recovery-code" || undefined}
              aria-describedby={
                invalidField === "recovery-code" ? "recovery-error" : undefined
              }
              data-testid="recovery-code"
              autoComplete="one-time-code"
              required
              minLength={32}
              maxLength={32}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <label htmlFor="recovery-password" className="text-sm font-medium">
              {t("auth.recovery.newPassword")}
            </label>
            <Input
              id="recovery-password"
              aria-invalid={invalidField === "recovery-password" || undefined}
              aria-describedby={
                invalidField === "recovery-password"
                  ? "recovery-error"
                  : undefined
              }
              data-testid="recovery-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={100}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <label htmlFor="recovery-confirm" className="text-sm font-medium">
              {t("auth.recovery.confirmPassword")}
            </label>
            <Input
              id="recovery-confirm"
              aria-invalid={invalidField === "recovery-confirm" || undefined}
              aria-describedby={
                invalidField === "recovery-confirm"
                  ? "recovery-error"
                  : undefined
              }
              data-testid="recovery-confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={100}
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </>
        )}
        {error && (
          <p
            id="recovery-error"
            role="alert"
            data-testid="recovery-error"
            className="text-sm text-danger"
          >
            {error}
          </p>
        )}
        {step !== "done" && (
          <Button
            type="submit"
            data-testid="recovery-submit"
            disabled={pending}
          >
            {step === "request" ? (
              <MailCheck className="mr-2 h-4 w-4" />
            ) : (
              <KeyRound className="mr-2 h-4 w-4" />
            )}
            {step === "request"
              ? t("auth.recovery.send")
              : t("auth.recovery.reset")}
          </Button>
        )}
        {step === "confirm" && (
          <button
            type="button"
            data-testid="recovery-retry"
            onClick={() => {
              setStep("request");
              setError(null);
            }}
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {t("auth.recovery.tryAgain")}
          </button>
        )}
        <button
          type="button"
          data-testid="recovery-back"
          onClick={onBack}
          className="inline-flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("auth.recovery.back")}
        </button>
      </form>
    </div>
  );
}
