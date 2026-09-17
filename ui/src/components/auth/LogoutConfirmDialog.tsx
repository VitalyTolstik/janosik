import { useAuth } from "@/auth/AuthContext";
import { ConfirmDialog } from "@/components/board/ConfirmDialog";
import { useI18n } from "@/i18n";

interface LogoutConfirmDialogProps {
  open: boolean;
  /** The account that will be signed out — shown in the description. */
  email: string;
  onOpenChange: (open: boolean) => void;
}

/**
 * Confirmation in front of sign-out: "Выйти" in the header (and in the data
 * menu) must not end the session on a stray click. Both triggers share this
 * dialog so the wording and behaviour stay identical.
 */
export function LogoutConfirmDialog({
  open,
  email,
  onOpenChange,
}: LogoutConfirmDialogProps) {
  const { t } = useI18n();
  const { logout } = useAuth();

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("auth.logoutConfirmTitle")}
      description={t("auth.logoutConfirmDescription", { email })}
      confirmLabel={t("auth.logout")}
      onConfirm={() => void logout()}
    />
  );
}
