import { useCallback, useEffect, useRef, useState } from "react";
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
import { useAdminAuth } from "./AdminAuthContext";
import { useAdminT, type AdminMessageKey } from "./admin-i18n";
import {
  CharCount,
  ConfirmDialog,
  ErrorState,
  PageHeader,
  Panel,
  Toggle,
} from "./ui";
import { SettingsSkeleton } from "./skeletons";

/**
 * Operations (TASK-61/63): behaviour flags, the maintenance switch, the
 * per-user rate limit, the soft-delete retention window and the purge button.
 * Every control writes straight through and takes effect without a restart.
 */
export function OpsPage() {
  const t = useAdminT();
  const toast = useToast();
  // TASK-79: global ops/flags/maintenance are owner-only server-side; the
  // panel mirrors that so an operator sees the state but cannot change it.
  const { admin } = useAdminAuth();
  const isOwner = admin?.role === "OWNER";
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [flags, setFlags] = useState<AdminFeatureFlagDto[]>([]);
  const [ops, setOps] = useState<AdminOpsSettingsDto | null>(null);
  const [retention, setRetention] = useState<AdminRetentionDto | null>(null);
  const [message, setMessage] = useState("");
  const [perUser, setPerUser] = useState("");
  const [retentionDays, setRetentionDays] = useState("");
  const [maintInterval, setMaintInterval] = useState("0");
  const [digestHours, setDigestHours] = useState("0");
  const [reminderLead, setReminderLead] = useState("0");
  const [busy, setBusy] = useState(false);
  const [purging, setPurging] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [openingQueues, setOpeningQueues] = useState(false);
  const [retentionState, setRetentionState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  // Only the latest retention-count request may write state; a slow answer
  // for an older draft window must not overwrite the current one.
  const retentionRequest = useRef(0);
  const lastRetentionRequestDays = useRef<number | null>(null);
  const savedRetentionDays = useRef<number | null>(null);
  // Live draft mirror: a reload that resolves after the owner edits the field
  // must read the newest value, not the one captured when the action started.
  const retentionDraft = useRef("");

  const setRetentionDraft = useCallback((value: string) => {
    retentionDraft.current = value;
    setRetentionDays(value);
  }, []);

  const fetchRetention = useCallback(
    async (days?: number): Promise<boolean> => {
      const request = ++retentionRequest.current;
      if (days !== undefined) lastRetentionRequestDays.current = days;
      setRetentionState("loading");
      try {
        const next = await adminApi.getRetention(days);
        if (retentionRequest.current !== request) return false;
        setRetention(next);
        setRetentionState("ready");
        return true;
      } catch {
        if (retentionRequest.current !== request) return false;
        setRetentionState("error");
        return false;
      }
    },
    [],
  );

  const load = useCallback(
    async (options: { preserveDrafts?: boolean } = {}) => {
      try {
        const [nextFlags, nextOps] = await Promise.all([
          adminApi.listFlags(),
          adminApi.getOps(),
        ]);
        setFlags(nextFlags);
        setOps(nextOps);
        setMessage(nextOps.maintenanceMessage ?? "");
        setPerUser(nextOps.perUserRateLimit?.toString() ?? "");
        // Default retention window: 30 days (mirrors the backend default).
        const days = nextOps.retentionDays ?? 30;
        const previousSaved = savedRetentionDays.current;
        savedRetentionDays.current = days;
        const currentDraft = retentionDraft.current;
        const keepDraft =
          options.preserveDrafts === true &&
          previousSaved !== null &&
          currentDraft !== String(previousSaved) &&
          days === previousSaved;
        const effectiveDraft = keepDraft
          ? currentDraft.trim() === ""
            ? 30
            : Number(currentDraft)
          : days;
        if (!keepDraft) setRetentionDraft(String(days));
        setMaintInterval(String(nextOps.maintenanceIntervalMinutes ?? 0));
        setDigestHours(String(nextOps.digestIntervalHours ?? 0));
        setReminderLead(String(nextOps.reminderLeadHours ?? 0));
        // Gate `ready` on the initial retention answer: the panel must not
        // briefly claim zero eligible rows or "no backup directory". When a
        // preserved draft is active, fetch counts for the draft, not the
        // stale saved window.
        const validDraft =
          Number.isFinite(effectiveDraft) &&
          effectiveDraft >= 1 &&
          effectiveDraft <= 3_650;
        if (validDraft) await fetchRetention(effectiveDraft);
        setPhase("ready");
      } catch {
        setPhase("error");
      }
    },
    [fetchRetention, setRetentionDraft],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // QA-A1: the "eligible" counts must describe the window the owner sees, not
  // the last saved setting. Debounced so typing 365 does not fire a request
  // per digit.
  useEffect(() => {
    if (phase !== "ready") return;
    const days = retentionDays.trim() === "" ? 30 : Number(retentionDays);
    if (!Number.isFinite(days) || days < 1 || days > 3_650) return;
    if (lastRetentionRequestDays.current === days) return;
    const timer = setTimeout(() => {
      void fetchRetention(days);
    }, 300);
    return () => clearTimeout(timer);
  }, [retentionDays, phase, fetchRetention]);

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
        void load({ preserveDrafts: true });
      }
    },
    [load, t, toast],
  );

  const saveOps = useCallback(async () => {
    const draftDays = retentionDays.trim() === "" ? 30 : Number(retentionDays);
    if (!Number.isFinite(draftDays) || draftDays < 1 || draftDays > 3_650) {
      return;
    }
    setBusy(true);
    try {
      const updated = await adminApi.updateOps({
        maintenanceMessage: message.trim() === "" ? null : message.trim(),
        perUserRateLimit: perUser.trim() === "" ? null : Number(perUser),
        retentionDays:
          retentionDays.trim() === "" ? null : Number(retentionDays),
        maintenanceIntervalMinutes: Number(maintInterval) || 0,
        digestIntervalHours: Number(digestHours) || 0,
        reminderLeadHours: Number(reminderLead) || 0,
      });
      setOps(updated);
      savedRetentionDays.current = updated.retentionDays ?? 30;
      toast.success(t("admin.ops.saved"));
    } catch {
      toast.error(t("admin.common.actionFailed"));
    } finally {
      setBusy(false);
    }
  }, [
    message,
    perUser,
    retentionDays,
    maintInterval,
    digestHours,
    reminderLead,
    t,
    toast,
  ]);

  const runSweeps = useCallback(async () => {
    setSweeping(true);
    try {
      const result = await adminApi.runMaintenance("all");
      if (result.queued) {
        toast.success(t("admin.ops.runNow.queued"));
      } else {
        const removed = result.results.reduce(
          (sum, entry) => sum + entry.removed,
          0,
        );
        toast.success(t("admin.ops.runNow.done", { count: removed }));
      }
      void load({ preserveDrafts: true });
    } catch {
      toast.error(t("admin.common.actionFailed"));
    } finally {
      setSweeping(false);
    }
  }, [load, t, toast]);

  const openQueues = useCallback(async () => {
    setOpeningQueues(true);
    try {
      await adminApi.requestQueueTicket();
      window.open(
        `${window.location.origin}/api/v1/admin/queues`,
        "_blank",
        "noopener,noreferrer",
      );
    } catch {
      toast.error(t("admin.common.actionFailed"));
    } finally {
      setOpeningQueues(false);
    }
  }, [t, toast]);

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
    if (purging) return;
    const days = retentionDays.trim() === "" ? 30 : Number(retentionDays);
    if (!Number.isFinite(days) || days < 1 || days > 3_650) return;
    setPurging(true);
    try {
      // QA-A1: always send the visible window. The server validates it and
      // never falls back to a stale saved value for this run.
      const result = await adminApi.purgeSoftDeleted(days);
      toast.success(
        t("admin.ops.retention.purged", { count: result.affected }),
      );
      setPurgeOpen(false);
      // Refresh the counts for the same window without resetting the draft.
      void fetchRetention(days);
    } catch {
      toast.error(t("admin.common.actionFailed"));
    } finally {
      setPurging(false);
    }
  }, [fetchRetention, purging, retentionDays, t, toast]);

  const effectiveDays =
    retentionDays.trim() === "" ? 30 : Number(retentionDays);
  const daysValid =
    Number.isFinite(effectiveDays) &&
    effectiveDays >= 1 &&
    effectiveDays <= 3_650;
  const savedDays = ops?.retentionDays ?? 30;
  const retentionDirty = daysValid && effectiveDays !== savedDays;
  const retentionMatches =
    retentionState === "ready" &&
    retention !== null &&
    retention.retentionDays === effectiveDays;
  const retentionData = retentionMatches ? retention : null;
  const retentionFailed = retentionState === "error";

  if (phase === "loading")
    return <SettingsSkeleton testId="admin-ops-skeleton" panels={3} wide />;
  if (phase === "error") {
    return (
      <ErrorState
        onRetry={() => {
          setPhase("loading");
          void load();
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
                disabled={!isOwner}
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
            disabled={!isOwner}
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
              disabled={!isOwner}
              onChange={(event) => setMessage(event.target.value)}
            />
            <CharCount value={message} max={500} />
          </label>
        </div>
        <div className="mt-3 flex justify-end">
          <Button
            size="sm"
            disabled={busy || !isOwner || !daysValid}
            data-testid="admin-ops-save"
            onClick={() => void saveOps()}
          >
            {t("admin.common.save")}
          </Button>
        </div>
      </Panel>

      <Panel className="p-4">
        <h2 className="mb-1 text-sm font-medium">{t("admin.ops.rateLimit")}</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          {t("admin.ops.rateLimit.hint")}
        </p>
        <label className="flex max-w-xs flex-col gap-1 text-xs">
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
            disabled={!isOwner}
            onChange={setPerUser}
          />
          <span className="text-[11px] text-muted-foreground">
            {t("admin.ops.perUserLimitHint")}
          </span>
        </label>
        <div className="mt-3 flex justify-end">
          <Button
            size="sm"
            disabled={busy || !isOwner || !daysValid}
            data-testid="admin-ops-rate-limit-save"
            onClick={() => void saveOps()}
          >
            {t("admin.common.save")}
          </Button>
        </div>
      </Panel>

      <Panel className="p-4">
        <h2 className="mb-1 text-sm font-medium">{t("admin.ops.retention")}</h2>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
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
              ariaDescribedBy={
                daysValid ? undefined : "admin-ops-retention-invalid"
              }
              invalid={!daysValid}
              increaseLabel={t("admin.common.increase")}
              decreaseLabel={t("admin.common.decrease")}
              disabled={!isOwner}
              onChange={setRetentionDraft}
            />
            {daysValid ? (
              <span className="text-[11px] text-muted-foreground">
                {t("admin.ops.retentionDaysHint")}
              </span>
            ) : (
              <span
                id="admin-ops-retention-invalid"
                role="alert"
                className="text-[11px] text-danger"
                data-testid="admin-ops-retention-invalid"
              >
                {t("admin.ops.retention.invalid")}
              </span>
            )}
            <div className="flex flex-wrap gap-1.5">
              {[30, 90, 365].map((preset) => (
                <Button
                  key={preset}
                  type="button"
                  size="sm"
                  variant={
                    retentionDays === String(preset) ? "default" : "outline"
                  }
                  data-testid={`admin-ops-retention-preset-${preset}`}
                  disabled={!isOwner}
                  onClick={() => setRetentionDraft(String(preset))}
                >
                  {t("admin.ops.retentionPreset", { days: preset })}
                </Button>
              ))}
            </div>
          </label>
        </div>
        <div className="mt-2 flex justify-end">
          <Button
            size="sm"
            disabled={busy || !isOwner || !daysValid}
            data-testid="admin-ops-retention-save"
            onClick={() => void saveOps()}
          >
            {t("admin.common.save")}
          </Button>
        </div>
        {daysValid ? (
          <>
            <p className="mt-3 text-xs text-muted-foreground">
              {t("admin.ops.retention.olderThan", { days: effectiveDays })}
            </p>
            {retentionDirty ? (
              <p
                className="mt-1 text-xs text-warning"
                data-testid="admin-ops-retention-dirty"
              >
                {t("admin.ops.retention.draftHint", { days: effectiveDays })}
              </p>
            ) : null}
            {retentionData === null ? (
              retentionFailed ? (
                <div
                  className="mt-1 flex flex-wrap items-center gap-2"
                  data-testid="admin-ops-retention-error"
                >
                  <p role="alert" className="text-xs text-danger">
                    {t("admin.ops.retention.loadError")}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    disabled={!daysValid}
                    data-testid="admin-ops-retention-retry"
                    onClick={() => void fetchRetention(effectiveDays)}
                  >
                    {t("admin.common.retry")}
                  </Button>
                </div>
              ) : (
                <div
                  className="mt-1 flex items-center"
                  data-testid="admin-ops-retention-loading"
                  aria-busy
                >
                  <span className="sr-only">
                    {t("admin.ops.retention.loading")}
                  </span>
                  <span
                    className="h-3 w-64 animate-pulse rounded bg-hover"
                    aria-hidden
                  />
                </div>
              )
            ) : (
              <>
                <p
                  className="mt-1 text-xs text-muted-foreground"
                  data-testid="admin-ops-retention-counts"
                >
                  {t("admin.ops.retention.purgeable", {
                    cards: retentionData.purgeable.cards,
                    comments: retentionData.purgeable.comments,
                    attachments: retentionData.purgeable.attachments,
                    columns: retentionData.purgeable.columns,
                  })}
                </p>
                <p
                  className="mt-1 text-xs text-muted-foreground"
                  data-testid="admin-ops-backup-status"
                >
                  {retentionData.backups.mode === "external"
                    ? t("admin.ops.backups.external", {
                        location: retentionData.backups.location ?? "",
                      })
                    : t("admin.ops.backups.none")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("admin.ops.backups.notAutomatic")}
                </p>
              </>
            )}
          </>
        ) : null}
        <div className="mt-3 flex justify-end">
          <Button
            variant="destructive"
            size="sm"
            disabled={!daysValid || !isOwner || purging || !retentionMatches}
            data-testid="admin-ops-purge"
            onClick={() => setPurgeOpen(true)}
          >
            {t("admin.ops.retention.purge")}
          </Button>
        </div>
      </Panel>

      <Panel className="p-4">
        <h2 className="mb-1 text-sm font-medium">{t("admin.ops.schedule")}</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          {t("admin.ops.schedule.hint")}
        </p>
        <label className="flex max-w-xs flex-col gap-1 text-xs">
          <span className="text-muted-foreground">
            {t("admin.ops.maintenanceInterval")}
          </span>
          <NumberStepper
            testId="admin-ops-maintenance-interval"
            min={0}
            max={10_080}
            value={maintInterval}
            ariaLabel={t("admin.ops.maintenanceInterval")}
            increaseLabel={t("admin.common.increase")}
            decreaseLabel={t("admin.common.decrease")}
            disabled={!isOwner}
            onChange={setMaintInterval}
          />
          <span className="text-[11px] text-muted-foreground">
            {t("admin.ops.maintenanceIntervalHint")}
          </span>
        </label>
        <div className="mt-3 flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={sweeping || !isOwner}
            data-testid="admin-ops-run-sweeps"
            onClick={() => void runSweeps()}
          >
            {t("admin.ops.runNow")}
          </Button>
          <Button
            size="sm"
            disabled={busy || !isOwner || !daysValid}
            data-testid="admin-ops-schedule-save"
            onClick={() => void saveOps()}
          >
            {t("admin.common.save")}
          </Button>
        </div>
      </Panel>

      <Panel className="p-4">
        <h2 className="mb-1 text-sm font-medium">{t("admin.ops.comms")}</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          {t("admin.ops.comms.hint")}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">
              {t("admin.ops.digestInterval")}
            </span>
            <NumberStepper
              testId="admin-ops-digest-interval"
              min={0}
              max={720}
              value={digestHours}
              ariaLabel={t("admin.ops.digestInterval")}
              increaseLabel={t("admin.common.increase")}
              decreaseLabel={t("admin.common.decrease")}
              disabled={!isOwner}
              onChange={setDigestHours}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">
              {t("admin.ops.reminderLead")}
            </span>
            <NumberStepper
              testId="admin-ops-reminder-lead"
              min={0}
              max={720}
              value={reminderLead}
              ariaLabel={t("admin.ops.reminderLead")}
              increaseLabel={t("admin.common.increase")}
              decreaseLabel={t("admin.common.decrease")}
              disabled={!isOwner}
              onChange={setReminderLead}
            />
          </label>
        </div>
        <div className="mt-3 flex justify-end">
          <Button
            size="sm"
            disabled={busy || !isOwner || !daysValid}
            data-testid="admin-ops-comms-save"
            onClick={() => void saveOps()}
          >
            {t("admin.common.save")}
          </Button>
        </div>
      </Panel>

      {ops?.queuesDashboard ? (
        <Panel className="p-4">
          <h2 className="mb-1 text-sm font-medium">{t("admin.ops.queues")}</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            {t("admin.ops.queues.hint")}
          </p>
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              disabled={openingQueues || !isOwner}
              data-testid="admin-ops-open-queues"
              onClick={() => void openQueues()}
            >
              {openingQueues
                ? t("admin.ops.queues.opening")
                : t("admin.ops.queues.open")}
            </Button>
          </div>
        </Panel>
      ) : null}

      <ConfirmDialog
        open={purgeOpen}
        title={t("admin.ops.retention.confirm.title")}
        body={t("admin.ops.retention.confirm.body", { days: effectiveDays })}
        confirmLabel={t("admin.ops.retention.purge")}
        busy={purging}
        onConfirm={() => void purge()}
        onClose={() => {
          if (!purging) setPurgeOpen(false);
        }}
      />
    </div>
  );
}
