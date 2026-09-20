import { useState } from "react";
import {
  ChevronDown,
  KeyRound,
  LogOut,
  Palette,
  ShieldCheck,
  UserRound,
  type LucideIcon,
} from "lucide-react";

import { LogoutConfirmDialog } from "@/components/auth/LogoutConfirmDialog";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { isApiEnabled } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { formatDateOnly, useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/i18n";
import { cn } from "@/lib/utils";
import { userAvatarColor, userInitials, userLabel } from "@/utils/avatar";
import { ApiTokensSection } from "./ApiTokensSection";
import { PreferencesSection } from "./PreferencesSection";
import { ProfileSection } from "./ProfileSection";
import { SecuritySection } from "./SecuritySection";

type AccountSection = "profile" | "security" | "tokens" | "preferences";

const SECTIONS: {
  id: AccountSection;
  labelKey: MessageKey;
  icon: LucideIcon;
}[] = [
  { id: "profile", labelKey: "account.sections.profile", icon: UserRound },
  { id: "security", labelKey: "account.sections.security", icon: ShieldCheck },
  { id: "tokens", labelKey: "account.sections.tokens", icon: KeyRound },
  {
    id: "preferences",
    labelKey: "account.sections.preferences",
    icon: Palette,
  },
];

/**
 * The personal account panel (TASK-36.1) — the avatar button in the header
 * opens a Linear-style dialog: an identity band on top, a section rail on
 * the left (horizontal tabs on mobile) and one scrollable section at a time
 * (profile, security, API tokens, preferences). Sign-out lives at the
 * bottom of the rail behind the usual confirmation.
 *
 * Rendered without a server session (local mode, tests) the trigger simply
 * disappears — same guard the sign-out button used before it.
 */
export function AccountDialog() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<AccountSection>("profile");
  const [confirmingLogout, setConfirmingLogout] = useState(false);

  if (!isApiEnabled() || user === null) {
    return null;
  }

  const name = userLabel(user.displayName, user.email);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              data-testid="account-trigger"
              aria-label={t("account.aria")}
              className="gap-2 px-1.5 sm:px-2"
            >
              <UserAvatar
                userId={user.id}
                displayName={user.displayName}
                email={user.email}
                color={user.avatarColor}
                avatarPath={user.avatarPath}
                size="sm"
              />
              <span className="hidden max-w-28 truncate text-sm sm:inline">
                {name}
              </span>
              <ChevronDown
                aria-hidden
                className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground sm:block"
              />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("account.tooltip")}</TooltipContent>
      </Tooltip>

      <DialogContent
        data-testid="account-dialog"
        // Fixed, viewport-bound height: sections differ in content length,
        // so the panel must not resize when switching tabs. Caps at 48rem on
        // tall screens, otherwise leaves a 1rem margin above and below.
        className="h-[min(48rem,calc(100dvh-2rem))] w-[calc(100vw-1.5rem)] gap-0 overflow-hidden p-0 sm:max-w-3xl"
      >
        {/* Identity band: who you are, at a glance. */}
        <div className="relative flex shrink-0 items-center gap-4 border-b bg-gradient-to-br from-primary/15 via-secondary/10 to-transparent px-5 py-4 pr-12">
          <span
            aria-hidden
            className={cn(
              "flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-semibold text-white shadow-sm",
              userAvatarColor(user.id, user.avatarColor),
            )}
          >
            {userInitials(user.displayName, user.email)}
          </span>
          <div className="min-w-0 space-y-0.5">
            <DialogTitle className="truncate text-base font-semibold">
              {name}
            </DialogTitle>
            <DialogDescription className="truncate text-xs">
              {user.email}
            </DialogDescription>
            <p className="text-[11px] text-muted-foreground/80">
              {t("account.memberSince", {
                date: formatDateOnly(user.createdAt, lang),
              })}
            </p>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav
            aria-label={t("account.nav")}
            className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 sm:w-52 sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r sm:p-3"
          >
            {SECTIONS.map(({ id, labelKey, icon: Icon }) => (
              <button
                key={id}
                type="button"
                data-testid={`account-nav-${id}`}
                aria-current={section === id ? "page" : undefined}
                onClick={() => setSection(id)}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors sm:w-full",
                  section === id
                    ? "bg-primary/10 font-medium text-primary"
                    : "text-muted-foreground hover:bg-hover hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="whitespace-nowrap">{t(labelKey)}</span>
              </button>
            ))}
            <button
              type="button"
              data-testid="account-logout"
              onClick={() => setConfirmingLogout(true)}
              className="flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-danger transition-colors hover:bg-danger/10 sm:mt-auto sm:w-full"
            >
              <LogOut className="h-4 w-4 shrink-0" aria-hidden />
              <span className="whitespace-nowrap">{t("auth.logout")}</span>
            </button>
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {section === "profile" ? <ProfileSection /> : null}
            {section === "security" ? <SecuritySection /> : null}
            {section === "tokens" ? <ApiTokensSection /> : null}
            {section === "preferences" ? <PreferencesSection /> : null}
          </div>
        </div>
      </DialogContent>

      <LogoutConfirmDialog
        open={confirmingLogout}
        email={user.email}
        onOpenChange={setConfirmingLogout}
      />
    </Dialog>
  );
}
