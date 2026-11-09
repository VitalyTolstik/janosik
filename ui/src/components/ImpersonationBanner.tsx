import { Eye } from "lucide-react";

import { Notice } from "@/components/notifications/Notice";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/auth/AuthContext";
import { useI18n } from "@/i18n";

/**
 * Irremovable "view as" banner (TASK-59): while a master impersonates a user
 * the app shows who is being viewed and offers the only way out. It leads
 * the notice stack because it explains why everything else looks different.
 */
export function ImpersonationBanner() {
  const { impersonating, user, exitImpersonation } = useAuth();
  const { t } = useI18n();
  if (!impersonating) return null;

  return (
    <Notice
      tone="warning"
      icon={Eye}
      eyebrow={t("impersonation.eyebrow")}
      title={t("impersonation.banner", { email: user?.email ?? "" })}
      testId="impersonation-banner"
      role="status"
      live="polite"
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="impersonation-exit"
          onClick={exitImpersonation}
        >
          {t("impersonation.exit")}
        </Button>
      }
    />
  );
}
