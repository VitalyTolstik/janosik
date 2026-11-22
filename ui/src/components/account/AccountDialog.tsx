import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ChevronDown,
  Bot,
  Database,
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
import { userInitials, userLabel } from "@/utils/avatar";
import {
  ACCOUNT_QUERY_PARAM,
  isAccountSection,
  type AccountSection,
} from "@/utils/account-nav";
import { ApiTokensSection } from "./ApiTokensSection";
import { DataPrivacySection } from "./DataPrivacySection";
import { PreferencesSection } from "./PreferencesSection";
import { ProfileSection } from "./ProfileSection";
import { SecuritySection } from "./SecuritySection";

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
  { id: "data", labelKey: "account.sections.data", icon: Database },
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
export function AccountDialog({
  onOpenAgents,
  compact = false,
}: {
  onOpenAgents?: () => void;
  compact?: boolean;
}) {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = searchParams.get(ACCOUNT_QUERY_PARAM);
  const deepLinkSection = isAccountSection(requestedSection)
    ? requestedSection
    : null;
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<AccountSection>("profile");
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const externalTrigger = useRef<HTMLElement | null>(null);
  const sectionButtons = useRef<
    Partial<Record<AccountSection, HTMLButtonElement | null>>
  >({});
  // Mirrors Header's `?agents=` handling: Back from a deep-linked panel must
  // close it, not leave the URL and the dialog disagreeing.
  const lastDeepLink = useRef<AccountSection | null>(null);

  // TASK-177.6: a notification can deep-link to a section through
  // `?account=tokens|…`; the panel is not a route, so the header-owned
  // dialog consumes the param instead of inventing an account page.
  useEffect(() => {
    if (deepLinkSection !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the deep link is the effect's purpose
      setSection(deepLinkSection);
      setOpen(true);
    } else if (lastDeepLink.current !== null) {
      setOpen(false);
    }
    lastDeepLink.current = deepLinkSection;
  }, [deepLinkSection]);

  useEffect(() => {
    const openTokens = () => {
      externalTrigger.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setSection("tokens");
      setOpen(true);
    };
    window.addEventListener("janosik:open-api-keys", openTokens);
    return () =>
      window.removeEventListener("janosik:open-api-keys", openTokens);
  }, []);

  if (!isApiEnabled() || user === null) {
    return null;
  }

  const name = userLabel(user.displayName, user.email);
  const selectSection = (next: AccountSection) => {
    setSection(next);
    if (searchParams.has(ACCOUNT_QUERY_PARAM)) {
      const params = new URLSearchParams(searchParams);
      params.set(ACCOUNT_QUERY_PARAM, next);
      setSearchParams(params, { replace: true });
    }
  };
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next && searchParams.has(ACCOUNT_QUERY_PARAM)) {
      const params = new URLSearchParams(searchParams);
      params.delete(ACCOUNT_QUERY_PARAM);
      setSearchParams(params, { replace: true });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              data-testid="account-trigger"
              aria-label={`${t("account.aria")}: ${userInitials(
                user.displayName,
                user.email,
              )} ${name}`}
              className="gap-2 px-1.5 max-md:h-11 max-md:min-w-11 max-md:justify-center max-md:px-0 sm:px-2"
            >
              {/* The 390 mockup has no avatar in the header. Keep the account
                  reachable with the same 44 px target and a neutral glyph. */}
              <UserRound
                className="hidden h-[18px] w-[18px] max-[760px]:block"
                aria-hidden
              />
              <UserAvatar
                userId={user.id}
                displayName={user.displayName}
                email={user.email}
                color={user.avatarColor}
                avatarPath={user.avatarPath}
                size="sm"
                className={cn(
                  "max-[760px]:hidden",
                  compact && "h-[26px] w-[26px]",
                )}
              />
              {/* A real space keeps the avatar's initials from fusing with the
                  name in the visible-text string (axe label-in-name, U-04). */}{" "}
              <span
                className={cn(
                  "hidden max-w-28 truncate text-sm",
                  !compact && "sm:inline",
                )}
              >
                {name}
              </span>
              <ChevronDown
                aria-hidden
                className={cn(
                  "hidden h-3.5 w-3.5 shrink-0 text-muted-foreground",
                  !compact && "sm:block",
                )}
              />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("account.tooltip")}</TooltipContent>
      </Tooltip>

      <DialogContent
        onOpenAutoFocus={(event) => {
          // A deep link must land on the section it names, not Radix's first
          // default target. Tab switches keep the focus the user gave them.
          event.preventDefault();
          sectionButtons.current[section]?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (externalTrigger.current?.isConnected) {
            event.preventDefault();
            externalTrigger.current.focus();
          }
          externalTrigger.current = null;
        }}
        data-testid="account-dialog"
        // Fixed, viewport-bound height: sections differ in content length,
        // so the panel must not resize when switching tabs. Caps at 48rem on
        // tall screens, otherwise leaves a 1rem margin above and below.
        className="h-[min(48rem,calc(100dvh-2rem))] w-[calc(100vw-1.5rem)] gap-0 overflow-hidden p-0 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] sm:max-w-3xl"
      >
        {/* Identity band: who you are, at a glance. */}
        <div className="relative flex shrink-0 items-center gap-4 border-b bg-gradient-to-br from-primary/15 via-secondary/10 to-transparent px-5 py-4 pr-12">
          <UserAvatar
            userId={user.id}
            displayName={user.displayName}
            email={user.email}
            color={user.avatarColor}
            avatarPath={user.avatarPath}
            size="xl"
            className="shadow-sm"
          />
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
                ref={(node) => {
                  sectionButtons.current[id] = node;
                }}
                type="button"
                data-testid={`account-nav-${id}`}
                aria-current={section === id ? "page" : undefined}
                onClick={() => selectSection(id)}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors sm:w-full",
                  section === id
                    ? "bg-primary/10 font-medium text-primary"
                    : "text-muted-foreground hover:bg-hover hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="min-w-0 truncate">{t(labelKey)}</span>
              </button>
            ))}
            {onOpenAgents ? (
              <button
                type="button"
                data-testid="account-open-agents"
                onClick={() => {
                  setOpen(false);
                  onOpenAgents();
                }}
                className="flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground sm:w-full"
              >
                <Bot className="h-4 w-4 shrink-0" aria-hidden />
                {t("agents.open")}
              </button>
            ) : null}
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
            {section === "data" ? <DataPrivacySection /> : null}
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
