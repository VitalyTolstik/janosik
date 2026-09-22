import { useCallback, useEffect, useState } from "react";
import { CircleAlert, CircleCheck, ExternalLink } from "lucide-react";
import type {
  AdminEmailSettingsDto,
  AdminEmailTestResponse,
  EmailSmtpPreset,
} from "@janosik/shared";
import { EMAIL_SMTP_PRESETS, EMAIL_SMTP_TEST_PRESETS } from "@janosik/shared";
import { formatDate, useHour12, useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/Toast";
import { ApiError } from "@/api/client";
import { adminApi } from "./admin-client";
import { useAdminT, type AdminMessageKey } from "./admin-i18n";
import { useAdminAuth } from "./AdminAuthContext";
import { ErrorState, LoadingState, PageHeader, Panel } from "./ui";

/**
 * Email service (TASK-52) — owner-only settings page for the outgoing mail
 * transport. Pick a provider preset, enter credentials, flip the switch:
 * saving reconfigures the running backend in place, no restart and no code
 * or env change. Operators see the status read-only.
 */

type Draft = {
  provider: EmailSmtpPreset["id"];
  host: string;
  port: number;
  secure: boolean;
  from: string;
  username: string;
  password: string;
  enabled: boolean;
};

const PRESET_LABEL_KEYS: Record<EmailSmtpPreset["id"], AdminMessageKey> = {
  gmail: "admin.email.preset.gmail",
  yandex: "admin.email.preset.yandex",
  mailru: "admin.email.preset.mailru",
  brevo: "admin.email.preset.brevo",
  sendgrid: "admin.email.preset.sendgrid",
  custom: "admin.email.preset.custom",
  ethereal: "admin.email.preset.ethereal",
};

const toDraft = (dto: AdminEmailSettingsDto): Draft => ({
  provider: dto.provider,
  host: dto.host,
  port: dto.port,
  secure: dto.secure,
  from: dto.source === "db" ? dto.from : "",
  username: dto.source === "db" ? dto.username : "",
  password: "",
  enabled: dto.enabled,
});

function StatusBanner({ settings }: { settings: AdminEmailSettingsDto }) {
  const t = useAdminT();
  const preset = EMAIL_SMTP_PRESETS.find((p) => p.id === settings.provider);
  let tone: "ok" | "muted" = "muted";
  let text: string;
  if (settings.source === "db" && settings.enabled) {
    tone = "ok";
    text = t("admin.email.status.on")
      .replace("{provider}", preset?.label ?? settings.provider)
      .replace("{host}", settings.host)
      .replace("{port}", String(settings.port));
  } else if (settings.source === "env") {
    tone = "ok";
    text = t("admin.email.status.env");
  } else if (settings.source === "db") {
    text = t("admin.email.status.off");
  } else {
    text = t("admin.email.status.log");
  }
  return (
    <div
      data-testid="admin-email-status"
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
        tone === "ok"
          ? "border-success/30 bg-success/10 text-foreground"
          : "border-border bg-hover/40 text-muted-foreground"
      }`}
    >
      {tone === "ok" ? (
        <CircleCheck className="h-4 w-4 shrink-0 text-success" aria-hidden />
      ) : (
        <CircleAlert className="h-4 w-4 shrink-0" aria-hidden />
      )}
      <span>{text}</span>
    </div>
  );
}

function LastProbe({ settings }: { settings: AdminEmailSettingsDto }) {
  const t = useAdminT();
  const { lang } = useI18n();
  const hour12 = useHour12();
  if (settings.lastTestAt === null) return null;
  return (
    <p className="text-[11px] text-muted-foreground">
      {t("admin.email.lastTest.label")}{" "}
      {settings.lastTestOk ? (
        <span className="text-success">{t("admin.email.lastTest.ok")}</span>
      ) : (
        <span className="text-danger">{t("admin.email.lastTest.failed")}</span>
      )}
      {" · "}
      {formatDate(Date.parse(settings.lastTestAt), lang, hour12)}
    </p>
  );
}

export function EmailSettingsPage() {
  const t = useAdminT();
  const toast = useToast();
  const { admin } = useAdminAuth();
  const isOwner = admin?.role === "OWNER";

  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [settings, setSettings] = useState<AdminEmailSettingsDto | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AdminEmailTestResponse | null>(
    null,
  );

  const load = useCallback(() => {
    adminApi
      .getEmailSettings()
      .then((dto) => {
        setSettings(dto);
        setDraft(toDraft(dto));
        setPhase("ready");
      })
      .catch(() => {
        setPhase("error");
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const retry = useCallback(() => {
    setPhase("loading");
    load();
  }, [load]);

  const patch = useCallback((changes: Partial<Draft>) => {
    setDraft((current) =>
      current === null ? current : { ...current, ...changes },
    );
  }, []);

  const selectPreset = useCallback(
    (id: EmailSmtpPreset["id"]) => {
      const preset = [...EMAIL_SMTP_PRESETS, ...EMAIL_SMTP_TEST_PRESETS].find(
        (p) => p.id === id,
      );
      if (preset === undefined) return;
      patch({
        provider: id,
        host: preset.host,
        port: preset.port,
        secure: preset.secure,
        username: id === "sendgrid" ? "apikey" : "",
      });
    },
    [patch],
  );

  const save = useCallback(async () => {
    if (draft === null) return;
    setSaving(true);
    try {
      const custom = draft.provider === "custom";
      const sandbox = draft.provider === "ethereal";
      const saved = await adminApi.updateEmailSettings({
        provider: draft.provider,
        ...(custom
          ? { host: draft.host, port: draft.port, secure: draft.secure }
          : {}),
        // The sandbox account is server-generated — no credentials to send.
        from: draft.from,
        username: sandbox ? "" : draft.username,
        ...(sandbox || draft.password === ""
          ? {}
          : { password: draft.password }),
        enabled: draft.enabled,
      });
      setSettings(saved);
      setDraft(toDraft(saved));
      toast.success(t("admin.email.saved"));
    } catch (cause) {
      const message =
        cause instanceof ApiError && cause.messageText
          ? cause.messageText
          : t("admin.common.error");
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }, [draft, t, toast]);

  const sendTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await adminApi.testEmailSettings({ to: testTo });
      setTestResult(result);
      const fresh = await adminApi.getEmailSettings();
      setSettings(fresh);
    } catch (cause) {
      const message =
        cause instanceof ApiError && cause.messageText
          ? cause.messageText
          : t("admin.common.error");
      toast.error(message);
    } finally {
      setTesting(false);
    }
  }, [t, testTo, toast]);

  if (phase === "loading") return <LoadingState />;
  if (phase === "error" || settings === null || draft === null) {
    return <ErrorState onRetry={retry} />;
  }

  const preset = [...EMAIL_SMTP_PRESETS, ...EMAIL_SMTP_TEST_PRESETS].find(
    (p) => p.id === draft.provider,
  );
  const custom = draft.provider === "custom";
  const sandbox = draft.provider === "ethereal";
  const passwordStored = settings.hasPassword;
  // The sandbox needs nothing from the user — the account is minted on save.
  const saveDisabled =
    saving || (sandbox ? false : draft.from === "" || draft.username === "");

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-6">
      <PageHeader
        title={t("admin.email.title")}
        subtitle={t("admin.email.subtitle")}
      />

      <Panel className="space-y-3 p-4">
        <StatusBanner settings={settings} />
        <LastProbe settings={settings} />
        {!isOwner ? (
          <p className="text-xs text-muted-foreground">
            {t("admin.email.readonly")}
          </p>
        ) : null}
      </Panel>

      <Panel className="space-y-3 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("admin.email.provider.title")}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {EMAIL_SMTP_PRESETS.map((item) => {
            const selected = draft.provider === item.id;
            return (
              <button
                key={item.id}
                type="button"
                data-testid={`admin-email-preset-${item.id}`}
                disabled={!isOwner}
                onClick={() => selectPreset(item.id)}
                className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                  selected
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-background/50 text-muted-foreground hover:bg-hover"
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <span className="block font-medium text-foreground">
                  {t(PRESET_LABEL_KEYS[item.id])}
                </span>
                <span className="block truncate">
                  {item.id === "custom"
                    ? t("admin.email.preset.customHint")
                    : `${item.host}:${item.port}`}
                </span>
              </button>
            );
          })}
        </div>

        <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("admin.email.testproviders.title")}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {t("admin.email.testproviders.hint")}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {EMAIL_SMTP_TEST_PRESETS.map((item) => {
            const selected = draft.provider === item.id;
            return (
              <button
                key={item.id}
                type="button"
                data-testid={`admin-email-preset-${item.id}`}
                disabled={!isOwner}
                onClick={() => selectPreset(item.id)}
                className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                  selected
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-background/50 text-muted-foreground hover:bg-hover"
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <span className="block font-medium text-foreground">
                  {t(PRESET_LABEL_KEYS[item.id])}
                </span>
                <span className="block truncate">
                  {t("admin.email.preset.sandboxHint")}
                </span>
              </button>
            );
          })}
        </div>

        {custom ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>{t("admin.email.host")}</span>
              <Input
                value={draft.host}
                disabled={!isOwner}
                data-testid="admin-email-host"
                onChange={(event) => patch({ host: event.target.value })}
              />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>{t("admin.email.port")}</span>
              <Input
                type="number"
                value={draft.port}
                disabled={!isOwner}
                data-testid="admin-email-port"
                onChange={(event) =>
                  patch({ port: Number(event.target.value) || 0 })
                }
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={draft.secure}
                disabled={!isOwner}
                onCheckedChange={(checked) => patch({ secure: checked })}
              />
              <span>{t("admin.email.secure")}</span>
            </label>
          </div>
        ) : null}

        <label className="block space-y-1 text-xs text-muted-foreground">
          <span>{t("admin.email.from")}</span>
          <Input
            value={draft.from}
            disabled={!isOwner}
            placeholder="Janosik <no-reply@example.com>"
            data-testid="admin-email-from"
            onChange={(event) => patch({ from: event.target.value })}
          />
        </label>

        {sandbox ? (
          <p className="text-[11px] text-muted-foreground">
            {t("admin.email.ethereal.auto")}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block space-y-1 text-xs text-muted-foreground">
                <span>{t("admin.email.username")}</span>
                <Input
                  value={draft.username}
                  disabled={!isOwner}
                  placeholder={preset?.usernameHint ?? ""}
                  data-testid="admin-email-username"
                  onChange={(event) => patch({ username: event.target.value })}
                />
              </label>
              <label className="block space-y-1 text-xs text-muted-foreground">
                <span>{t("admin.email.password")}</span>
                <Input
                  type="password"
                  value={draft.password}
                  disabled={!isOwner}
                  autoComplete="new-password"
                  placeholder={
                    passwordStored ? t("admin.email.password.saved") : undefined
                  }
                  data-testid="admin-email-password"
                  onChange={(event) => patch({ password: event.target.value })}
                />
              </label>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t("admin.email.password.hint")}{" "}
              {preset?.helpUrl ? (
                <a
                  href={preset.helpUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline underline-offset-2"
                >
                  {t("admin.email.password.help")}
                </a>
              ) : null}
            </p>
          </>
        )}

        <label className="flex items-center gap-2 text-xs font-medium text-foreground">
          <Checkbox
            checked={draft.enabled}
            disabled={!isOwner}
            onCheckedChange={(checked) => patch({ enabled: checked })}
            data-testid="admin-email-enabled"
          />
          <span>{t("admin.email.enabled")}</span>
        </label>

        {isOwner ? (
          <Button
            size="sm"
            onClick={() => void save()}
            disabled={saveDisabled}
            data-testid="admin-email-save"
          >
            {saving ? t("admin.email.saving") : t("admin.common.save")}
          </Button>
        ) : null}
      </Panel>

      <Panel className="space-y-3 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("admin.email.test.title")}
        </p>
        {!settings.active ? (
          <p className="text-[11px] text-muted-foreground">
            {t("admin.email.test.logHint")}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={testTo}
            disabled={!isOwner}
            placeholder="you@example.com"
            className="max-w-xs"
            data-testid="admin-email-test-to"
            onChange={(event) => setTestTo(event.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!isOwner || testTo === "" || testing}
            onClick={() => void sendTest()}
            data-testid="admin-email-test-send"
          >
            {testing
              ? t("admin.email.test.sending")
              : t("admin.email.test.send")}
          </Button>
        </div>
        {testResult !== null ? (
          testResult.ok ? (
            settings.active ? (
              <p
                className="text-xs text-success"
                data-testid="admin-email-test-ok"
              >
                {t("admin.email.test.ok")}
              </p>
            ) : (
              <p
                className="text-xs text-muted-foreground"
                data-testid="admin-email-test-ok"
              >
                {t("admin.email.test.logOk")}
              </p>
            )
          ) : (
            <p
              className="text-xs text-danger"
              data-testid="admin-email-test-failed"
            >
              {t("admin.email.test.failed").replace(
                "{error}",
                testResult.error ?? "",
              )}
            </p>
          )
        ) : null}
      </Panel>

      {settings.webViewer !== null ? (
        <Panel className="space-y-3 p-4" data-testid="admin-email-webviewer">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("admin.email.ethereal.inboxTitle")}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {t("admin.email.ethereal.note")}
          </p>
          <div className="space-y-1.5 font-mono text-xs text-foreground">
            <p>
              <span className="mr-2 font-sans text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("admin.email.ethereal.login")}
              </span>
              {settings.webViewer.user}
            </p>
            <p>
              <span className="mr-2 font-sans text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("admin.email.ethereal.password")}
              </span>
              {settings.webViewer.pass}
            </p>
          </div>
          <Button size="sm" variant="outline" asChild>
            <a href={settings.webViewer.url} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              {t("admin.email.ethereal.open")}
            </a>
          </Button>
        </Panel>
      ) : null}
    </div>
  );
}
