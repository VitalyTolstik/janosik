import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Check, RotateCcw, Upload } from "lucide-react";
import { DISPLAY_NAME_MAX, type UserAvatarColor } from "@janosik/shared";

import { api, ApiError } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { EmailChangeDialog } from "@/components/account/EmailChangeDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/Toast";
import { useAvatarObjectUrl } from "@/hooks/use-avatar-object-url";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  AVATAR_COLOR_KEYS,
  avatarColorClass,
  avatarColorKey,
  userInitials,
} from "@/utils/avatar";

/**
 * Profile section (TASK-36.1): the avatar preview and palette picker, the
 * editable display name and the sign-in email. Since TASK-51 the email can
 * be changed through the double opt-in dialog (password proof + code to the
 * new address); the field itself stays read-only — the dialog owns the flow.
 */
export function ProfileSection() {
  const { user, updateUser } = useAuth();
  const { t } = useI18n();
  const toast = useToast();
  const [name, setName] = useState(user?.displayName ?? "");
  const [color, setColor] = useState<UserAvatarColor | null>(
    user?.avatarColor ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [changingEmail, setChangingEmail] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  if (user === null) return null;

  const trimmed = name.trim();
  const dirty =
    trimmed !== (user.displayName ?? "") || color !== user.avatarColor;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const next = await api.updateProfile({
        displayName: trimmed === "" ? null : trimmed,
        avatarColor: color,
      });
      updateUser(next);
      setName(next.displayName ?? "");
      toast.success(t("account.profile.saved"));
    } catch {
      toast.error(t("account.profile.saveError"));
    } finally {
      setSaving(false);
    }
  };

  /** Photo upload (TASK-47): the server validates type and size. */
  const handlePhoto = async (file: File | undefined) => {
    if (!file || uploading) return;
    setUploading(true);
    try {
      const next = await api.uploadAvatar(file);
      updateUser(next);
      toast.success(t("account.profile.saved"));
    } catch (error) {
      if (error instanceof ApiError && error.status === 413) {
        toast.error(t("card.attachments.tooLarge", { max: 2 }));
      } else {
        toast.error(t("account.profile.avatarError"));
      }
    } finally {
      setUploading(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  };

  return (
    <section className="space-y-5" data-testid="account-profile">
      <header className="space-y-1">
        <h3 className="text-sm font-semibold">{t("account.profile.title")}</h3>
        <p className="text-xs text-muted-foreground">
          {t("account.profile.description")}
        </p>
      </header>

      <div className="flex flex-col gap-5 rounded-lg border bg-muted/30 p-4 sm:flex-row sm:items-center">
        <div className="flex flex-col items-center gap-2">
          {user.avatarPath ? (
            <AvatarImage
              userId={user.id}
              avatarPath={user.avatarPath}
              name={name}
              email={user.email}
            />
          ) : (
            <span
              aria-hidden
              className={cn(
                "flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-xl font-semibold text-white shadow-sm",
                avatarColorClass(color ?? avatarColorKey(user.id)),
              )}
            >
              {userInitials(name, user.email)}
            </span>
          )}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            data-testid="avatar-photo-input"
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              void handlePhoto(event.target.files?.[0])
            }
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="avatar-photo-upload"
            disabled={uploading}
            onClick={() => photoInputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" />
            {uploading
              ? t("account.profile.avatarUploading")
              : t("account.profile.avatarUpload")}
          </Button>
          <p className="max-w-[12rem] text-center text-[10px] text-muted-foreground">
            {t("account.profile.avatarHint")}
          </p>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            {t("account.profile.colorLabel")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="avatar-color-auto"
              aria-label={t("account.profile.colorAuto")}
              aria-pressed={color === null}
              title={t("account.profile.colorAuto")}
              onClick={() => setColor(null)}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-foreground/40 text-foreground/70 transition-transform hover:scale-110",
                color === null &&
                  "ring-2 ring-ring ring-offset-2 ring-offset-background",
              )}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            </button>
            {AVATAR_COLOR_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                data-testid={`avatar-color-${key}`}
                aria-label={t("account.profile.color", { color: key })}
                aria-pressed={color === key}
                onClick={() => setColor(key)}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full text-white transition-transform hover:scale-110",
                  avatarColorClass(key),
                  color === key &&
                    "ring-2 ring-ring ring-offset-2 ring-offset-background",
                )}
              >
                {color === key ? (
                  <Check className="h-3.5 w-3.5" aria-hidden />
                ) : null}
              </button>
            ))}
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label
            htmlFor="account-display-name"
            className="text-xs font-medium text-muted-foreground"
          >
            {t("account.profile.nameLabel")}
          </label>
          <div className="flex gap-2">
            <Input
              id="account-display-name"
              data-testid="account-display-name"
              value={name}
              maxLength={DISPLAY_NAME_MAX}
              placeholder={t("account.profile.namePlaceholder")}
              onChange={(event) => setName(event.target.value)}
            />
            <Button
              type="submit"
              data-testid="account-profile-save"
              disabled={!dirty || saving}
            >
              {saving ? t("common.saving") : t("common.save")}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t("account.profile.nameHint", { max: DISPLAY_NAME_MAX })}
          </p>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="account-email"
            className="text-xs font-medium text-muted-foreground"
          >
            {t("account.profile.emailLabel")}
          </label>
          <div className="flex gap-2">
            <Input
              id="account-email"
              data-testid="account-email"
              value={user.email}
              disabled
              readOnly
            />
            <Button
              type="button"
              variant="outline"
              data-testid="account-email-change"
              onClick={() => setChangingEmail(true)}
            >
              {t("account.email.change")}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t("account.profile.emailHint")}
          </p>
        </div>
      </form>

      <EmailChangeDialog open={changingEmail} onOpenChange={setChangingEmail} />
    </section>
  );
}

/** The uploaded photo (TASK-47) — object URL via the authenticated fetch. */
function AvatarImage({
  userId,
  avatarPath,
}: {
  userId: string;
  avatarPath: string;
  name: string;
  email: string;
}) {
  const src = useAvatarObjectUrl(userId, avatarPath);
  return (
    <span
      aria-hidden
      className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full shadow-sm"
    >
      {src ? (
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <span className="h-full w-full animate-pulse rounded-full bg-muted" />
      )}
    </span>
  );
}
