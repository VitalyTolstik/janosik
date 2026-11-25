import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminSecurityDto, AdminTotpSetupDto } from "@janosik/shared";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/Toast";
import { formatDate, useHour12, useI18n } from "@/i18n";
import { adminApi } from "./admin-client";
import { useAdminT } from "./admin-i18n";
import { useAdminAuth } from "./AdminAuthContext";
import { Badge, CharCount, ErrorState, PageHeader, Panel } from "./ui";
import { SettingsSkeleton } from "./skeletons";

/**
 * Security (TASK-65): TOTP two-factor enrollment, the login IP allowlist and
 * a feed of suspicious activity derived from the audit log.
 */
export function SecurityPage() {
  const t = useAdminT();
  const { lang } = useI18n();
  const hour12 = useHour12();
  const toast = useToast();
  const { admin } = useAdminAuth();
  const isOwner = admin?.role === "OWNER";
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [security, setSecurity] = useState<AdminSecurityDto | null>(null);
  const [setup, setSetup] = useState<AdminTotpSetupDto | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [allowlist, setAllowlist] = useState("");
  const [busy, setBusy] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  // The setup panel replaces the enable/replace controls, so move focus to
  // the first code box (and announce the swap below with aria-live).
  useEffect(() => {
    if (setup !== null) codeInputRef.current?.focus();
  }, [setup]);

  const load = useCallback(() => {
    adminApi
      .getSecurity()
      .then((snapshot) => {
        setSecurity(snapshot);
        setAllowlist(snapshot.ipAllowlist ?? "");
        setPhase("ready");
      })
      .catch(() => setPhase("error"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const beginSetup = useCallback(
    async (proof: { totpCode?: string; password?: string } = {}) => {
      if (busy) return;
      setBusy(true);
      try {
        setSetup(await adminApi.setupTotp(proof));
        setCode("");
        setPassword("");
      } catch (cause) {
        toast.error(
          cause instanceof ApiError && cause.status === 401
            ? t("admin.security.totp.invalid")
            : t("admin.common.actionFailed"),
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, t, toast],
  );

  const confirm = useCallback(async () => {
    if (setup === null) return;
    setBusy(true);
    try {
      // The staged secret is active only after this call succeeds; a lost
      // setup response leaves the old factor working (M12).
      await adminApi.verifyTotp(code, setup.setupToken);
      toast.success(t("admin.security.totp.enabled"));
      setSetup(null);
      setCode("");
      load();
    } catch (cause) {
      const stale = cause instanceof ApiError && cause.code === "setup_stale";
      if (stale) {
        // The ticket can never succeed now; drop the dead panel instead of
        // inviting the operator to retry the same staged secret.
        setSetup(null);
        setCode("");
        load();
      }
      toast.error(
        stale
          ? t("admin.security.totp.stale")
          : t("admin.security.totp.invalid"),
      );
    } finally {
      setBusy(false);
    }
  }, [code, load, setup, t, toast]);

  const disable = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await adminApi.updateSecurity({
        totpEnabled: false,
        totpCode: code,
      });
      setSecurity(next);
      setCode("");
      toast.success(t("admin.security.totp.disabled"));
    } catch {
      toast.error(t("admin.security.totp.invalid"));
    } finally {
      setBusy(false);
    }
  }, [busy, code, t, toast]);

  const saveAllowlist = useCallback(async () => {
    setBusy(true);
    try {
      const next = await adminApi.updateSecurity({
        ipAllowlist: allowlist.trim() === "" ? null : allowlist.trim(),
      });
      setSecurity(next);
      toast.success(t("admin.common.save"));
    } catch (cause) {
      // A 400 names the problem — notably an allowlist that would exclude
      // the caller's own address (and lock them out mid-session).
      toast.error(
        cause instanceof ApiError && cause.status === 400
          ? cause.messageText
          : t("admin.common.actionFailed"),
      );
    } finally {
      setBusy(false);
    }
  }, [allowlist, t, toast]);

  if (phase === "loading")
    return <SettingsSkeleton testId="admin-security-skeleton" panels={2} />;
  if (phase === "error" || !security) {
    return (
      <ErrorState
        onRetry={() => {
          setPhase("loading");
          load();
        }}
      />
    );
  }

  return (
    <div className="w-full max-w-3xl space-y-4 p-4">
      <PageHeader
        title={t("admin.security.title")}
        subtitle={t("admin.security.subtitle")}
      />

      <p
        className="rounded-lg border border-border bg-hover/60 px-3 py-2 text-ui-label text-muted-foreground"
        data-testid="admin-security-scope"
      >
        {t("admin.security.scope")}
      </p>

      <Panel className="p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-ui-body font-medium">
            {t("admin.security.totp")}
          </h2>
          <Badge
            variant={security.totpEnabled ? "success" : "neutral"}
            data-testid="admin-totp-status"
          >
            {security.totpEnabled
              ? t("admin.observability.on")
              : t("admin.observability.off")}
          </Badge>
        </div>
        {setup ? (
          <div
            className="mt-3 space-y-3"
            data-testid="admin-totp-setup"
            aria-live="polite"
          >
            <p className="text-ui-label text-muted-foreground">
              {t("admin.security.totp.hint")}
            </p>
            <code
              className="block break-all rounded-md bg-hover p-2 font-mono text-ui-label"
              data-testid="admin-totp-secret"
            >
              {setup.secret}
            </code>
            <label className="flex flex-col gap-1 text-ui-label">
              <span className="text-muted-foreground">
                {t("admin.security.totp.code")}
              </span>
              <Input
                ref={codeInputRef}
                value={code}
                inputMode="numeric"
                maxLength={6}
                data-testid="admin-totp-code"
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, ""))
                }
              />
            </label>
            <Button
              size="sm"
              disabled={busy || code.length !== 6}
              data-testid="admin-totp-confirm"
              onClick={() => void confirm()}
            >
              {t("admin.security.totp.confirm")}
            </Button>
          </div>
        ) : security.totpEnabled ? (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-ui-label">
              <span className="text-muted-foreground">
                {t("admin.security.totp.code")}
              </span>
              <Input
                value={code}
                inputMode="numeric"
                maxLength={6}
                data-testid="admin-totp-code"
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, ""))
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-ui-label">
              <span className="text-muted-foreground">
                {t("admin.security.totp.password")}
              </span>
              <Input
                type="password"
                value={password}
                autoComplete="current-password"
                data-testid="admin-totp-password"
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || (code.length !== 6 && password.length === 0)}
              data-testid="admin-totp-replace"
              onClick={() =>
                void beginSetup({
                  ...(code.length === 6 ? { totpCode: code } : {}),
                  ...(password.length > 0 ? { password } : {}),
                })
              }
            >
              {t("admin.security.totp.replace")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy || code.length !== 6}
              data-testid="admin-totp-disable"
              onClick={() => void disable()}
            >
              {t("admin.security.totp.disable")}
            </Button>
          </div>
        ) : (
          <div className="mt-3">
            <Button
              size="sm"
              className="bg-action-primary hover:bg-[#1d4ed8]"
              data-testid="admin-totp-enable"
              disabled={busy}
              onClick={() => void beginSetup()}
            >
              {t("admin.security.totp.enable")}
            </Button>
          </div>
        )}
      </Panel>

      <Panel className="p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-ui-body font-medium">{t("admin.security.ip")}</h2>
          {!isOwner ? (
            <Badge variant="neutral">{t("admin.security.ip.readonly")}</Badge>
          ) : null}
        </div>
        <p className="mb-2 text-ui-label text-muted-foreground">
          {t("admin.security.ip.hint")}
        </p>
        <Input
          value={allowlist}
          maxLength={500}
          placeholder="203.0.113.7, 10.0.0.0/8"
          disabled={!isOwner}
          data-testid="admin-ip-allowlist"
          onChange={(event) => setAllowlist(event.target.value)}
        />
        <div className="flex justify-end">
          <CharCount value={allowlist} max={500} />
        </div>
        {!isOwner ? (
          <p
            className="mt-2 text-ui-meta text-muted-foreground"
            data-testid="admin-ip-readonly"
          >
            {t("admin.security.ip.ownerOnly")}
          </p>
        ) : (
          <div className="mt-3 flex justify-end">
            <Button
              size="sm"
              className="bg-action-primary hover:bg-[#1d4ed8]"
              disabled={busy}
              data-testid="admin-ip-save"
              onClick={() => void saveAllowlist()}
            >
              {t("admin.common.save")}
            </Button>
          </div>
        )}
      </Panel>

      <Panel className="p-4">
        <h2 className="mb-3 text-ui-body font-medium">
          {t("admin.security.alerts")}
        </h2>
        <p className="mb-3 text-ui-label text-muted-foreground">
          {t("admin.security.alert.window")}
        </p>
        {security.alerts.length === 0 ? (
          <p className="text-ui-label text-muted-foreground">
            {t("admin.security.alerts.empty")}
          </p>
        ) : (
          <div className="space-y-2" data-testid="admin-security-alerts">
            {security.alerts.map((alert) => (
              <div
                key={alert.id}
                className="flex items-center gap-3 text-ui-body"
              >
                <Badge
                  variant={
                    alert.action === "admin.login_locked" ? "danger" : "warning"
                  }
                >
                  {t(`admin.security.alert.${alert.reason}`)}
                </Badge>
                <span className="text-ui-label">
                  {t(`admin.security.stage.${alert.stage}`)}
                </span>
                <span className="text-ui-label">
                  {alert.adminEmail || t("admin.security.alert.noAccount")}
                </span>
                <span className="text-ui-label text-muted-foreground">
                  {alert.ip ?? t("admin.security.alert.noIp")}
                </span>
                {alert.count > 1 && (
                  <span className="text-ui-label">
                    {t("admin.security.alert.count")}: {alert.count} (
                    {formatDate(alert.createdAt, lang, hour12)})
                  </span>
                )}
                <span className="ml-auto text-ui-label text-muted-foreground">
                  {formatDate(alert.lastOccurredAt, lang, hour12)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
