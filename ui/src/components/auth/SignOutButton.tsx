import { LogOut } from "lucide-react";

import { isApiEnabled } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";

/**
 * Sign-out control for the board header (server mode, live session only).
 *
 * An icon-only account dropdown turned out to be undiscoverable — the
 * question "how do I log out here?" came back twice. The control now says
 * what it does: the label is visible from `sm` up, the icon alone below it,
 * and the tooltip names the account that will be signed out.
 */
export function SignOutButton() {
  const { t } = useI18n();
  const { user, logout } = useAuth();

  if (!isApiEnabled() || user === null) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("auth.logout")}
          data-testid="account-logout"
          onClick={() => void logout()}
          className="gap-1.5 px-2"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">{t("auth.logout")}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {t("auth.signedInAs", { email: user.email })}
      </TooltipContent>
    </Tooltip>
  );
}
