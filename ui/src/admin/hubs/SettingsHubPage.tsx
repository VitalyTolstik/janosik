import { lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { Lock } from "lucide-react";

import { useAdminT } from "../admin-i18n";
import { useAdminAuth } from "../AdminAuthContext";
import { EmailSettingsPage } from "../EmailSettingsPage";
import { OAuthSettingsPage } from "../OAuthSettingsPage";
import { ObservabilityPage } from "../ObservabilityPage";
import { OpsPage } from "../OpsPage";
import { SettingsSkeleton } from "../skeletons";
import { TrafficSettingsPage } from "../TrafficSettingsPage";
import { HubFrame } from "./HubTabs";

// These two panels carry the TOTP flow and the demo runner. They are opened
// rarely compared with board/card moderation, so keep them out of the admin
// card-page budget (TASK-180.3 size gate).
const SecurityPage = lazy(() =>
  import("../SecurityPage").then((module) => ({
    default: module.SecurityPage,
  })),
);
const DemoPage = lazy(() =>
  import("../DemoPage").then((module) => ({ default: module.DemoPage })),
);

/**
 * Settings hub: one predictable frame (subnav + panel) for seven screens that
 * used to be unrelated pages at three different widths. Owner-only sections
 * stay visible to an operator but the pages themselves are read-only, and the
 * server remains the source of truth.
 */
export function SettingsHubPage() {
  const t = useAdminT();
  const { admin } = useAdminAuth();
  const [params] = useSearchParams();
  const tab = params.get("tab") ?? "general";
  const isOwner = admin?.role === "OWNER";

  return (
    <HubFrame
      hub="settings"
      showOwnerTabs
      bodyClassName="min-h-0 flex-1 overflow-y-auto"
    >
      {!isOwner ? (
        <div
          data-testid="admin-settings-readonly"
          className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-border bg-card/60 px-3 py-2 text-[11px] text-muted-foreground"
        >
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{t("admin.settings.readonly")}</span>
        </div>
      ) : null}

      <Suspense
        fallback={
          <SettingsSkeleton testId="admin-settings-panel-skeleton" panels={2} />
        }
      >
        {tab === "email" ? (
          <EmailSettingsPage />
        ) : tab === "oauth" ? (
          <OAuthSettingsPage />
        ) : tab === "security" ? (
          <SecurityPage />
        ) : tab === "traffic" ? (
          <TrafficSettingsPage />
        ) : tab === "observability" ? (
          <ObservabilityPage />
        ) : tab === "demo" ? (
          <DemoPage />
        ) : (
          <OpsPage />
        )}
      </Suspense>
    </HubFrame>
  );
}
