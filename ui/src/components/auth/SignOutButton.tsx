import { useState } from "react";

import { isApiEnabled } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { LogoutConfirmDialog } from "@/components/auth/LogoutConfirmDialog";
import { Button } from "@/components/ui/button";
import { LazyAnimatedIcon } from "@/components/ui/lazy-animated-icon";
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
 * and the tooltip names the account that will be signed out. The click asks
 * for confirmation (a stray click must not end the session) and the icon is
 * the animated lucide "logout" in the header's icon family.
 */
export function SignOutButton() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [confirming, setConfirming] = useState(false);

  if (!isApiEnabled() || user === null) return null;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("auth.logout")}
            data-testid="account-logout"
            onClick={() => setConfirming(true)}
            className="gap-1.5 px-2"
          >
            <LazyAnimatedIcon name="logout" size={16} aria-hidden />
            <span className="hidden sm:inline">{t("auth.logout")}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {t("auth.signedInAs", { email: user.email })}
        </TooltipContent>
      </Tooltip>
      <LogoutConfirmDialog
        open={confirming}
        email={user.email}
        onOpenChange={setConfirming}
      />
    </>
  );
}
