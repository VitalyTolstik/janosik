import { useCallback, useEffect, useState } from "react";
import type { AdminOAuthProviderDto } from "@janosik/shared";
import { OAUTH_PROVIDER_IDS } from "@janosik/shared";
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
 * OAuth login (TASK-54) — owner-only settings page for the external
 * providers (Google / Yandex). Paste the client id/secret from the
 * provider's console, register the shown callback URL there, flip the
 * switch: the sign-in screen gains the button the moment saving succeeds.
 * Operators see the settings read-only. The secret never leaves the backend
 * — a blank field keeps the stored one.
 */

type Draft = {
  clientId: string;
  clientSecret: string;
  enabled: boolean;
};

const LABEL_KEYS: Record<string, AdminMessageKey> = {
  google: "admin.oauth.provider.google",
  yandex: "admin.oauth.provider.yandex",
};

const toDraft = (dto: AdminOAuthProviderDto): Draft => ({
  clientId: dto.clientId,
  clientSecret: "",
  enabled: dto.enabled,
});

export function OAuthSettingsPage() {
  const t = useAdminT();
  const toast = useToast();
  const { admin } = useAdminAuth();
  const isOwner = admin?.role === "OWNER";

  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [providers, setProviders] = useState<AdminOAuthProviderDto[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(() => {
    adminApi
      .listOAuthProviders()
      .then((rows) => {
        setProviders(rows);
        setDrafts(
          Object.fromEntries(rows.map((row) => [row.provider, toDraft(row)])),
        );
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

  const patch = useCallback((provider: string, changes: Partial<Draft>) => {
    setDrafts((current) =>
      current[provider] === undefined
        ? current
        : { ...current, [provider]: { ...current[provider], ...changes } },
    );
  }, []);

  const save = useCallback(
    async (provider: string) => {
      const draft = drafts[provider];
      if (draft === undefined) return;
      setSavingId(provider);
      try {
        const saved = await adminApi.updateOAuthProvider(provider, {
          clientId: draft.clientId,
          // Blank field = keep the stored secret (undefined on the wire).
          ...(draft.clientSecret === ""
            ? {}
            : { clientSecret: draft.clientSecret }),
          enabled: draft.enabled,
        });
        setProviders((current) =>
          current.map((row) => (row.provider === provider ? saved : row)),
        );
        setDrafts((current) => ({ ...current, [provider]: toDraft(saved) }));
        toast.success(t("admin.oauth.saved"));
      } catch (cause) {
        const message =
          cause instanceof ApiError && cause.messageText
            ? cause.messageText
            : t("admin.common.error");
        toast.error(message);
      } finally {
        setSavingId(null);
      }
    },
    [drafts, t, toast],
  );

  if (phase === "loading") return <LoadingState />;
  if (phase === "error") return <ErrorState onRetry={retry} />;

  return (
    <div className="w-full max-w-3xl space-y-4 p-4">
      <PageHeader
        title={t("admin.oauth.title")}
        subtitle={t("admin.oauth.subtitle")}
      />

      {!isOwner ? (
        <Panel className="p-4">
          <p className="text-xs text-muted-foreground">
            {t("admin.oauth.readonly")}
          </p>
        </Panel>
      ) : null}

      {OAUTH_PROVIDER_IDS.map((provider) => {
        const settings = providers.find((row) => row.provider === provider);
        const draft = drafts[provider];
        if (settings === undefined || draft === undefined) return null;
        const label = t(LABEL_KEYS[provider]);
        return (
          <Panel key={provider} className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">{label}</p>
              <span
                data-testid={`admin-oauth-status-${provider}`}
                className={`text-xs ${settings.enabled ? "text-success" : "text-muted-foreground"}`}
              >
                {settings.enabled
                  ? t("admin.oauth.status.on")
                  : t("admin.oauth.status.off")}
              </span>
            </div>

            <div className="space-y-1">
              <label
                className="text-xs font-medium text-foreground"
                htmlFor={`admin-oauth-client-id-${provider}`}
              >
                {t("admin.oauth.clientId")}
              </label>
              <Input
                id={`admin-oauth-client-id-${provider}`}
                data-testid={`admin-oauth-client-id-${provider}`}
                value={draft.clientId}
                disabled={!isOwner}
                autoComplete="off"
                onChange={(e) => patch(provider, { clientId: e.target.value })}
              />
            </div>

            <div className="space-y-1">
              <label
                className="text-xs font-medium text-foreground"
                htmlFor={`admin-oauth-secret-${provider}`}
              >
                {t("admin.oauth.clientSecret")}
              </label>
              <Input
                id={`admin-oauth-secret-${provider}`}
                data-testid={`admin-oauth-secret-${provider}`}
                type="password"
                value={draft.clientSecret}
                disabled={!isOwner}
                placeholder={
                  settings.hasSecret ? t("admin.oauth.secretStored") : ""
                }
                autoComplete="new-password"
                onChange={(e) =>
                  patch(provider, { clientSecret: e.target.value })
                }
              />
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium text-foreground">
                {t("admin.oauth.callback")}
              </p>
              <code
                data-testid={`admin-oauth-callback-${provider}`}
                className="block rounded-md border bg-muted/50 px-2 py-1.5 text-xs break-all text-foreground"
              >
                {settings.callbackUrl}
              </code>
              <p className="text-[11px] text-muted-foreground">
                {t("admin.oauth.callbackHint", { provider: label })}
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox
                data-testid={`admin-oauth-enabled-${provider}`}
                checked={draft.enabled}
                disabled={!isOwner}
                onCheckedChange={(checked) =>
                  patch(provider, { enabled: checked })
                }
              />
              {t("admin.oauth.enabled")}
            </label>

            {isOwner ? (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  data-testid={`admin-oauth-save-${provider}`}
                  disabled={savingId === provider || draft.clientId === ""}
                  onClick={() => void save(provider)}
                >
                  {savingId === provider
                    ? t("admin.oauth.saving")
                    : t("admin.common.save")}
                </Button>
              </div>
            ) : null}
          </Panel>
        );
      })}
    </div>
  );
}
