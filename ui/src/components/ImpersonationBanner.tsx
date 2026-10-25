import { Eye } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { useI18n } from "@/i18n";

/**
 * Irremovable "view as" banner (TASK-59): while a master impersonates a user
 * the app shows who is being viewed and offers the only way out. It sits
 * above everything, including the announcement banners.
 */
export function ImpersonationBanner() {
  const { impersonating, user, exitImpersonation } = useAuth();
  const { t } = useI18n();
  if (!impersonating) return null;

  return (
    <div
      role="status"
      data-testid="impersonation-banner"
      className="flex items-center gap-2 bg-warning/15 px-4 py-2 text-sm text-foreground"
    >
      <Eye className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        {t("impersonation.banner", { email: user?.email ?? "" })}
      </span>
      <button
        type="button"
        data-testid="impersonation-exit"
        onClick={exitImpersonation}
        className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-hover"
      >
        {t("impersonation.exit")}
      </button>
    </div>
  );
}
