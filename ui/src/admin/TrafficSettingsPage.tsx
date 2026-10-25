import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AdminThrottleSettingsDto,
  AdminTrafficDto,
} from "@janosik/shared";
import { Button } from "@/components/ui/button";
import { NumberStepper } from "@/components/ui/number-stepper";
import { useToast } from "@/components/Toast";
import { ApiError } from "@/api/client";
import { cn } from "@/lib/utils";
import { pollWhileFocused } from "@/lib/visible-poll";
import { adminApi } from "./admin-client";
import { useAdminT } from "./admin-i18n";
import { Chart } from "./chart/chart";
import { useAdminAuth } from "./AdminAuthContext";
import { Badge, ErrorState, LoadingState, PageHeader, Panel } from "./ui";

/**
 * Traffic & limits (TASK-57) — the live API request rate and the global rate
 * limit. The gauge is polled once a second; the limit is a singleton the owner
 * edits (operators see it read-only). Changes apply on the next request,
 * without a restart, so an owner can raise it before a demo storm and lower
 * it afterwards.
 */
export function TrafficSettingsPage() {
  const t = useAdminT();
  const toast = useToast();
  const { admin } = useAdminAuth();
  const isOwner = admin?.role === "OWNER";

  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [settings, setSettings] = useState<AdminThrottleSettingsDto | null>(
    null,
  );
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [traffic, setTraffic] = useState<AdminTrafficDto | null>(null);
  const mounted = useRef(true);

  const load = useCallback(() => {
    adminApi
      .getThrottleSettings()
      .then((value) => {
        setSettings(value);
        setDraft(String(value.limit));
        setPhase("ready");
      })
      .catch(() => setPhase("error"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Poll the live gauge once a second while the page is open. `mounted` is
  // raised here (not in the load effect) so StrictMode's double-mount cannot
  // leave it stuck at false and freeze the gauge.
  useEffect(() => {
    mounted.current = true;
    const tick = () => {
      adminApi
        .getTraffic()
        .then((value) => {
          if (mounted.current) setTraffic(value);
        })
        .catch(() => {
          /* a missed sample is not worth surfacing */
        });
    };
    // Visible-and-focused tabs only (see `pollWhileFocused`).
    const stopPolling = pollWhileFocused(tick, 1000);
    return () => {
      mounted.current = false;
      stopPolling();
    };
  }, []);

  const save = useCallback(async () => {
    const limit = Number(draft);
    if (!Number.isInteger(limit) || limit < 1) return;
    setSaving(true);
    try {
      const saved = await adminApi.updateThrottleSettings({ limit });
      setSettings(saved);
      setDraft(String(saved.limit));
      toast.success(t("admin.traffic.saved"));
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

  const retry = useCallback(() => {
    setPhase("loading");
    load();
  }, [load]);

  if (phase === "loading") return <LoadingState />;
  if (phase === "error") return <ErrorState onRetry={retry} />;

  const perSecond = traffic?.perSecond ?? new Array<number>(60).fill(0);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-6">
      <PageHeader
        title={t("admin.traffic.title")}
        subtitle={t("admin.traffic.subtitle")}
      />

      {!isOwner ? (
        <Panel className="p-4">
          <p className="text-xs text-muted-foreground">
            {t("admin.traffic.readonly")}
          </p>
        </Panel>
      ) : null}

      <Panel className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3">
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("admin.traffic.rpm")}
          </p>
          <p
            data-testid="admin-traffic-rpm"
            className="text-2xl font-semibold tabular-nums text-foreground"
          >
            {traffic?.lastMinute ?? 0}
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("admin.traffic.throttled")}
          </p>
          <p
            data-testid="admin-traffic-throttled"
            className={cn(
              "text-2xl font-semibold tabular-nums",
              (traffic?.throttledLastMinute ?? 0) > 0
                ? "text-danger"
                : "text-foreground",
            )}
          >
            {traffic?.throttledLastMinute ?? 0}
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("admin.traffic.limit")}
          </p>
          <p
            data-testid="admin-traffic-limit"
            className="text-2xl font-semibold tabular-nums text-foreground"
          >
            {settings?.limit ?? 0}
          </p>
        </div>
      </Panel>

      <Panel className="space-y-3 p-4">
        <Chart
          x={perSecond.map((_, index) => index)}
          series={[
            {
              label: t("admin.traffic.perSecond"),
              values: perSecond,
              colorToken: "--primary",
            },
          ]}
          xFormat={(value) => `${59 - value}s`}
          xTicks={[0, 15, 30, 45, 59]}
          xLabel={t("admin.chart.second")}
          height={160}
          ariaLabel={t("admin.traffic.title")}
          testId="admin-traffic-chart"
        />
        <p className="text-[11px] text-muted-foreground">
          {t("admin.traffic.subtitle")}
        </p>
      </Panel>

      <Panel className="space-y-3 p-4">
        <div className="space-y-1">
          <label
            htmlFor="admin-traffic-limit-input"
            className="text-xs font-medium text-foreground"
          >
            {t("admin.traffic.limit")}
          </label>
          <NumberStepper
            id="admin-traffic-limit-input"
            testId="admin-traffic-limit-input"
            min={1}
            max={1_000_000}
            value={draft}
            disabled={!isOwner}
            onChange={setDraft}
            ariaLabel={t("admin.traffic.limit")}
            increaseLabel={t("admin.common.increase")}
            decreaseLabel={t("admin.common.decrease")}
          />
          <div className="flex items-center gap-2 pt-0.5">
            <span className="text-[11px] text-muted-foreground">
              {t("admin.traffic.limitSource")}:
            </span>
            <Badge variant={settings?.source === "db" ? "primary" : "neutral"}>
              {settings?.source === "db"
                ? t("admin.traffic.limitSource.db")
                : t("admin.traffic.limitSource.env")}
            </Badge>
          </div>
        </div>
        {isOwner ? (
          <div className="flex justify-end">
            <Button
              size="sm"
              data-testid="admin-traffic-save"
              disabled={saving || draft === ""}
              onClick={() => void save()}
            >
              {saving ? t("admin.common.loading") : t("admin.traffic.save")}
            </Button>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
