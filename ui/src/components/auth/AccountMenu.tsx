import { LogOut, UserRound } from "lucide-react";

import { isApiEnabled } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";

/**
 * Account menu (board header): who is signed in and the way out.
 *
 * The board only offered sign-out inside the data/backup dropdown, where
 * nobody looked for it — after login there was no visible "log out" on the
 * page. The header now carries a dedicated account trigger with the email
 * and the action one click away. Server mode only, and only while a session
 * exists (an anonymous screen has no account to show); the data menu keeps
 * its own sign-out for muscle memory.
 */
export function AccountMenu() {
  const { t } = useI18n();
  const { user, logout } = useAuth();

  if (!isApiEnabled() || user === null) return null;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("auth.accountAria")}
              data-testid="account-menu"
            >
              <UserRound className="h-5 w-5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{user.email}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
          {t("auth.signedInAs", { email: user.email })}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="account-logout"
          onClick={() => void logout()}
        >
          <LogOut className="h-4 w-4" />
          {t("auth.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
