import { useCallback, useEffect, useState } from "react";
import type {
  AdminFeatureFlagDto,
  AdminOpsSettingsDto,
  AdminRetentionDto,
} from "@janosik/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberStepper } from "@/components/ui/number-stepper";
import { useToast } from "@/components/Toast";
import { adminApi } from "./admin-client";
import { useAdminT, type AdminMessageKey } from "./admin-i18n";
import {
  CharCount,
  ConfirmDialog,
  ErrorState,
  LoadingState,
  PageHeader,
  Panel,
  Toggle,
} from "./ui";

/**
 * Operations (TASK-61/63): behaviour flags, the maintenance switch, the
 * per-user rate limit, the soft-delete retention window and the purge button.
 * Every control writes straight through and takes effect without a restart.
 */
export function OpsPage() {
  const t = useAdminT();
  const toast = useToast();
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [flags, setFlags] = useState<AdminFeatureFlagDto[]>([]);
  const [ops, setOps] = useState<AdminOpsSettingsDto | null>(null);
  const [retention, setRetention] = useState<AdminRetentionDto | null>(null);
  const [message, setMessage] = useState("");
  const [perUser, setPerUser] = useState("");
  const [retentionDays, setRetentionDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [purging, setPurging] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      adminApi.listFlags(),
      adminApi.getOps(),
      adminApi.getRetention(),
    ])
      .then(([nextFlags, nextOps, nextRetention]) => {
        setFlags(nextFlags);
        setOps(nextOps);
        setRetention(nextRetention);
        setMessage(nextOps.maintenanceMessage ?? "");
        setPerUser(nextOps.perUserRateLimit?.toString() ?? "");
        // Default retention window: 30 days (mirrors the backend default).
        setRetentionDays(String(nextOps.retentionDays ?? 30));
        setPhase("ready");
      })
      .catch(() => setPhase("error"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleFlag = useCallback(
    async (flag: AdminFeatureFlagDto, next: boolean) => {
      setFlags((current) =>
        current.map((entry) =>
          entry.key === flag.key ? { ...entry, enabled: next } : entry,
        ),
      );
      try {
        const updated = await adminApi.updateFlag(flag.key, { enabled: next });
        setFlags((current) =>
          current.map((entry) => (entry.key === flag.key ? updated : entry)),
        );
        toast.success(t("admin.ops.saved"));
      } catch {
        toast.error(t("admin.common.actionFailed"));
        load();
      }
    },
    [load, t, toast],
  );

  const saveOps = useCallback(async () => {
    setBusy(true);
    try {
      const updated = await adminApi.updateOps({
        maintenanceMessage: message.trim() === "" ? null : message.trim(),
        perUserRateLimit: perUser.trim() === "" ? null : Number(perUser),
        retentionDays:
          retentionDays.trim() === "" ? null : Number(retentionDays),
      });
      setOps(updated);
      toast.success(t("admin.ops.saved"));
    } catch {
      toast.error(t("admin.common.actionFailed"));
    } finally {
      setBusy(false);
    }
  }, [message, perUser, retentionDays, t, toast]);

  const toggleMaintenance = useCallback(
    async (next: boolean) => {
      try {
        const updated = await adminApi.updateOps({ maintenanceMode: next });
        setOps(updated);
        toast.success(
          next ? t("admin.ops.maintenance.on") : t("admin.ops.maintenance.off"),
        );
      } catch {
        toast.error(t("admin.common.actionFailed"));
      }
    },
    [t, toast],
  );

  const purge = useCallback(async () => {
    setPurging(true);
    try {
      const result = await adminApi.purgeSoftDeleted();
      toast.success(
        t("admin.ops.retention.purged", { count: result.affected }),
      );
      load();
    } catch {
      toast.error(t("admin.common.actionFailed"));
    } finally {
      setPurging(false);
    }
  }, [load, t, toast]);

  const effectiveDays =
    retentionDays.trim() === "" ? 30 : Number(retentionDays);
  const daysValid = Number.isFinite(effectiveDays) && effectiveDays >= 1;

  if (phase === "loading") return <LoadingState />;
  if (phase === "error") {
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
        title={t("admin.ops.title")}
        subtitle={t("admin.ops.subtitle")}
      />

      <Panel className="p-4">
        <h2 className="mb-1 text-sm font-medium">{t("admin.ops.flags")}</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          {t("admin.ops.flags.hint")}
        </p>
        <div className="space-y-3" data-testid="admin-flags">
          {flags.map((flag) => (
            <div
              key={flag.key}
              className="flex items-start justify-between gap-4"
            >
              <div>
                <p className="text-sm font-medium">
                  {t(`admin.flag.${flag.key}.label` as AdminMessageKey)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t(`admin.flag.${flag.key}.description` as AdminMessageKey)}
                </p>
                {flag.overrides > 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    {t("admin.ops.flagOverrides", { count: flag.overrides })}
                  </p>
                ) : null}
              </div>
              <Toggle
                label={flag.label}
                checked={flag.enabled}
                onChange={(next) => void toggleFlag(flag, next)}
              />
            </div>
          ))}
        </div>
      </Panel>

      <Panel className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium">
              {t("admin.ops.maintenance")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("admin.ops.maintenance.hint")}
            </p>
          </div>
          <Toggle
            label={t("admin.ops.maintenance")}
            checked={ops?.maintenanceMode ?? false}
            onChange={(next) => void toggleMaintenance(next)}
          />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">
              {t("admin.ops.maintenanceMessage")}
            </span>
            <Input
              value={message}
              maxLength={500}
              data-testid="admin-ops-message"
              onChange={(event) => setMessage(event.target.value)}
            />
            <CharCount value={message} max={500} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">
              {t("admin.ops.perUserLimit")}
            </span>
            <NumberStepper
              testId="admin-ops-peruser"
              min={1}
              max={100_000}
              value={perUser}
              ariaLabel={t("admin.ops.perUserLimit")}
              increaseLabel={t("admin.common.increase")}
              decreaseLabel={t("admin.common.decrease")}
              onChange={setPerUser}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">
              {t("admin.ops.retentionDays")}
            </span>
            <NumberStepper
              testId="admin-ops-retention"
              min={1}
              max={3650}
              value={retentionDays}
              ariaLabel={t("admin.ops.retentionDays")}
              increaseLabel={t("admin.common.increase")}
              decreaseLabel={t("admin.common.decrease")}
              onChange={setRetentionDays}
            />
            <span className="text-[11px] text-muted-foreground">
              {t("admin.ops.retentionDaysHint")}
            </span>
          </label>
        </div>
        <div className="mt-3 flex justify-end">
          <Button
            size="sm"
            disabled={busy}
            data-testid="admin-ops-save"
            onClick={() => void saveOps()}
          >
            {t("admin.common.save")}
          </Button>
        </div>
      </Panel>

      <Panel className="p-4">
        <h2 className="mb-1 text-sm font-medium">{t("admin.ops.retention")}</h2>
        <p className="text-xs text-muted-foreground">
          {t("admin.ops.retention.olderThan", { days: effectiveDays })}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("admin.ops.retention.purgeable", {
            cards: retention?.purgeable.cards ?? 0,
            comments: retention?.purgeable.comments ?? 0,
            attachments: retention?.purgeable.attachments ?? 0,
            columns: retention?.purgeable.columns ?? 0,
          })}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {retention?.backups.configured
            ? t("admin.ops.backups.configured", {
                location: retention.backups.location ?? "",
              })
            : t("admin.ops.backups.none")}
        </p>
        <div className="mt-3 flex justify-end">
          <Button
            variant="destructive"
            size="sm"
            disabled={!daysValid}
            data-testid="admin-ops-purge"
            onClick={() => setPurging(true)}
          >
            {t("admin.ops.retention.purge")}
          </Button>
        </div>
      </Panel>

      <ConfirmDialog
        open={purging}
        title={t("admin.ops.retention.confirm.title")}
        body={t("admin.ops.retention.confirm.body", { days: effectiveDays })}
        confirmLabel={t("admin.ops.retention.purge")}
        busy={false}
        onConfirm={() => void purge()}
        onClose={() => setPurging(false)}
      />
    </div>
  );
}
