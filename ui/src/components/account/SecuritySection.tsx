import { useEffect, useState, type FormEvent } from "react";
import type { OAuthProviderDto } from "@janosik/shared";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";

import { api, ApiError } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/Toast";
import { useI18n } from "@/i18n";

/** Password field with a visibility toggle that keeps the label semantics. */
function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        id={id}
        data-testid={id}
        type={visible ? "text" : "password"}
        value={value}
        autoComplete={autoComplete}
        maxLength={100}
        className="pr-10"
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        data-testid={`${id}-toggle`}
        aria-label={
          visible ? t("account.security.hide") : t("account.security.show")
        }
        onClick={() => setVisible((current) => !current)}
        className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
      >
        {visible ? (
          <EyeOff className="h-4 w-4" aria-hidden />
        ) : (
          <Eye className="h-4 w-4" aria-hidden />
        )}
      </button>
    </div>
  );
}

/**
 * Security section (TASK-36.1): change the password after proving the
 * current one. The server revokes every other refresh session and every
 * personal API token, keeping only the caller's session — the copy says
 * exactly that. A rotation is the user's "something leaked" button, so a
 * key minted with the old password must die with it.
 */
export function SecuritySection() {
  const { t } = useI18n();
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [providers, setProviders] = useState<OAuthProviderDto[]>([]);
  const [linking, setLinking] = useState(false);
  useEffect(() => {
    let alive = true;
    void api.listOAuthProviders().then((result) => {
      if (alive) setProviders(result.providers);
    });
    return () => {
      alive = false;
    };
  }, []);

  const linkProvider = async (provider: string) => {
    setLinking(true);
    setError(null);
    try {
      const { redirectUrl } = await api.startOAuthLink(provider, current);
      window.location.assign(redirectUrl);
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 401
          ? t("account.security.wrongCurrent")
          : t("account.security.genericError"),
      );
      setLinking(false);
    }
  };

  const tooShort = next.length > 0 && next.length < 8;
  const mismatch = confirm.length > 0 && confirm !== next;
  const canSubmit =
    (user?.hasPassword === false || current.length > 0) &&
    next.length >= 8 &&
    confirm === next &&
    !saving;

  const validationError = tooShort
    ? t("account.security.tooShort")
    : mismatch
      ? t("account.security.mismatch")
      : null;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      await api.changePassword(current, next);
      try {
        updateUser(await api.me());
      } catch {
        /* the session may need a fresh sign-in */
      }
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.success(t("account.security.changed"));
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 401
          ? t("account.security.wrongCurrent")
          : t("account.security.genericError"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-5" data-testid="account-security">
      <header className="space-y-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
          {t("account.security.title")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t("account.security.description")}
        </p>
      </header>

      <form
        noValidate
        onSubmit={handleSubmit}
        className="space-y-4 rounded-lg border bg-muted/30 p-4"
      >
        {user?.hasPassword !== false && (
          <div className="space-y-1.5">
            <label
              htmlFor="security-current"
              className="text-xs font-medium text-muted-foreground"
            >
              {t("account.security.current")}
            </label>
            <PasswordInput
              id="security-current"
              value={current}
              autoComplete="current-password"
              onChange={setCurrent}
            />
          </div>
        )}

        <div className="space-y-1.5">
          <label
            htmlFor="security-new"
            className="text-xs font-medium text-muted-foreground"
          >
            {t("account.security.new")}
          </label>
          <PasswordInput
            id="security-new"
            value={next}
            autoComplete="new-password"
            onChange={setNext}
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="security-confirm"
            className="text-xs font-medium text-muted-foreground"
          >
            {t("account.security.confirm")}
          </label>
          <PasswordInput
            id="security-confirm"
            value={confirm}
            autoComplete="new-password"
            onChange={setConfirm}
          />
        </div>

        {(validationError ?? error) ? (
          <p
            role="alert"
            data-testid="security-error"
            className="text-xs text-danger"
          >
            {validationError ?? error}
          </p>
        ) : null}

        {user?.hasPassword !== false && providers.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {t("account.security.oauthLinkHint")}
            </p>
            <div className="flex flex-wrap gap-2">
              {providers.map((provider) => (
                <Button
                  key={provider.id}
                  type="button"
                  variant="outline"
                  disabled={!current || linking}
                  onClick={() => void linkProvider(provider.id)}
                >
                  {t("account.security.oauthLink", {
                    provider: provider.label,
                  })}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-muted-foreground">
            {t("account.security.note")}
          </p>
          <Button
            type="submit"
            data-testid="security-submit"
            disabled={!canSubmit}
          >
            {saving ? t("common.saving") : t("account.security.submit")}
          </Button>
        </div>
      </form>
    </section>
  );
}
