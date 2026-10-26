import { useCallback, useEffect, useState } from "react";
import type { AdminSecurityDto, AdminTotpSetupDto } from "@janosik/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/Toast";
import { adminApi } from "./admin-client";
import { useAdminT } from "./admin-i18n";
import { useAdminAuth } from "./AdminAuthContext";
import {
  Badge,
  CharCount,
  ErrorState,
  LoadingState,
  PageHeader,
  Panel,
} from "./ui";

/**
 * Security (TASK-65): TOTP two-factor enrollment, the login IP allowlist and
 * a feed of suspicious activity derived from the audit log.
 */
export function SecurityPage() {
  const t = useAdminT();
  const toast = useToast();
  const { admin } = useAdminAuth();
  const isOwner = admin?.role === "OWNER";
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [security, setSecurity] = useState<AdminSecurityDto | null>(null);
  const [setup, setSetup] = useState<AdminTotpSetupDto | null>(null);
  const [code, setCode] = useState("");
  const [allowlist, setAllowlist] = useState("");
  const [busy, setBusy] = useState(false);

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

  const beginSetup = useCallback(async () => {
    try {
      setSetup(await adminApi.setupTotp());
    } catch {
      toast.error(t("admin.common.actionFailed"));
    }
  }, [t, toast]);

  const confirm = useCallback(async () => {
    setBusy(true);
    try {
      await adminApi.verifyTotp(code);
      toast.success(t("admin.security.totp.enabled"));
      setSetup(null);
      setCode("");
      load();
    } catch {
      toast.error(t("admin.security.totp.invalid"));
    } finally {
      setBusy(false);
    }
  }, [code, load, t, toast]);

  const disable = useCallback(async () => {
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
    }
  }, [code, t, toast]);

  const saveAllowlist = useCallback(async () => {
    setBusy(true);
    try {
      const next = await adminApi.updateSecurity({
        ipAllowlist: allowlist.trim() === "" ? null : allowlist.trim(),
      });
      setSecurity(next);
      toast.success(t("admin.common.save"));
    } catch {
      toast.error(t("admin.common.actionFailed"));
    } finally {
      setBusy(false);
    }
  }, [allowlist, t, toast]);

  if (phase === "loading") return <LoadingState />;
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
        className="rounded-lg border border-border bg-hover/60 px-3 py-2 text-xs text-muted-foreground"
        data-testid="admin-security-scope"
      >
        {t("admin.security.scope")}
      </p>

      <Panel className="p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">{t("admin.security.totp")}</h2>
          <Badge variant={security.totpEnabled ? "success" : "neutral"}>
            {security.totpEnabled
              ? t("admin.observability.on")
              : t("admin.observability.off")}
          </Badge>
        </div>
        {security.totpEnabled ? (
          <div className="mt-3 flex items-end gap-2">
            <label className="flex flex-col gap-1 text-xs">
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
            <Button
              variant="destructive"
              size="sm"
              disabled={code.length !== 6}
              data-testid="admin-totp-disable"
              onClick={() => void disable()}
            >
              {t("admin.security.totp.disable")}
            </Button>
          </div>
        ) : setup ? (
          <div className="mt-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              {t("admin.security.totp.hint")}
            </p>
            <code
              className="block break-all rounded-md bg-hover p-2 font-mono text-xs"
              data-testid="admin-totp-secret"
            >
              {setup.secret}
            </code>
            <label className="flex flex-col gap-1 text-xs">
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
            <Button
              size="sm"
              disabled={busy || code.length !== 6}
              data-testid="admin-totp-confirm"
              onClick={() => void confirm()}
            >
              {t("admin.security.totp.confirm")}
            </Button>
          </div>
        ) : (
          <div className="mt-3">
            <Button
              size="sm"
              data-testid="admin-totp-enable"
              onClick={() => void beginSetup()}
            >
              {t("admin.security.totp.enable")}
            </Button>
          </div>
        )}
      </Panel>

      <Panel className="p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">{t("admin.security.ip")}</h2>
          {!isOwner ? (
            <Badge variant="neutral">{t("admin.security.ip.readonly")}</Badge>
          ) : null}
        </div>
        <p className="mb-2 text-xs text-muted-foreground">
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
            className="mt-2 text-[11px] text-muted-foreground"
            data-testid="admin-ip-readonly"
          >
            {t("admin.security.ip.ownerOnly")}
          </p>
        ) : (
          <div className="mt-3 flex justify-end">
            <Button
              size="sm"
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
        <h2 className="mb-3 text-sm font-medium">
          {t("admin.security.alerts")}
        </h2>
        {security.alerts.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("admin.security.alerts.empty")}
          </p>
        ) : (
          <div className="space-y-2" data-testid="admin-security-alerts">
            {security.alerts.map((alert) => (
              <div key={alert.id} className="flex items-center gap-3 text-sm">
                <Badge
                  variant={
                    alert.action === "admin.login_locked" ? "danger" : "warning"
                  }
                >
                  {alert.action === "admin.login_locked"
                    ? t("admin.security.alert.locked")
                    : t("admin.security.alert.failed")}
                </Badge>
                <span className="text-xs">{alert.adminEmail}</span>
                <span className="text-xs text-muted-foreground">
                  {alert.ip ?? "—"}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {new Date(alert.createdAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
